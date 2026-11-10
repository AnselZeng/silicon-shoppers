// POST /api/chat  { message, history?: ChatMessage[], context?: ChatContext }
//   -> NDJSON stream, one event per line:
//      { type: "delta", text }          each piece of the reply as the model writes it
//      { type: "reset" }                drop the text so far: the model was thinking out loud before a tool call
//      { type: "tool", name, detail }   a tool the model called, for the terminal
//      { type: "done", model, ms }      the finished reply
//      { type: "error", error }
//   -> { error } with 400 / 503 when the request can't start.
// The concierge only answers about this store: the context JSON carries the shopper's
// persona, the real layout-decision reasons and the bag, so "why am I seeing this" replies
// quote actual model output instead of inventing explanations.
//
// Products come from the server's own catalog, never from the request. With Nebius the model
// looks them up and acts through tools (lib/server/chatTools.ts); the validated actions are
// appended to the reply as the <<<ACTIONS>>> line the browser already reads. Other providers,
// or CHAT_TOOLS=off, get the catalog in the prompt and write that line themselves.
import { NextResponse } from "next/server"
import { bagFrom, catalogForPrompt, CHAT_TOOLS, MarkerGate, ToolSession } from "@/lib/server/chatTools"
import { chat, chatWithTools, llmProvider, missingKeyMessage, toolsAvailable, type ChatMessage } from "@/lib/server/llm"

// Cache Components: route handlers run on the Node.js runtime and at request time by default.

const RULES = `You are the concierge inside SoCal Atelier, an online fashion store. You are a warm, upbeat sales assistant, the kind who genuinely loves helping people find their next favorite piece. You only talk about this store.

Answer questions about: the products, prices, sizes and colors; the shopper's bag, wishlist and browsing; and why the storefront looks the way it does for them.

Rules:
- Ground every answer in the CONTEXT JSON below and in the store's catalog. Product names, prices, colors, sizes and reasons all come from them; never invent products, prices or policies.
- "Why am I seeing X / why is the store arranged like this" answers quote the reason strings in context.decisions.
- Keep it to 1 or 2 short sentences. Plain text, no markdown, no bullet lists.
- Sound joyous and human: light enthusiasm ("Oh, great pick!", "You're going to love this"), never robotic. Do not overuse exclamation marks; one per reply at most.
- Never use em dashes or en dashes. Use commas or a period instead.
- If the question is not about shopping here, say so briefly and steer back ("I'm just the store concierge, ask me about the clothes"). Shopping-flow phrases ("next order", "another one", "more?") ARE shopping, never deflect them.
- context.order is their last COMPLETED order. Those items are paid for already. Never offer to add them, name them as still payable, or take payment for them again. If they want another order, ask what to grab next.
- Never mention being an AI, the schema, the pipeline, Snowflake or model internals; say "the store learned" or "because you".
- If the shopper states a preference ("I love black shoes"), acknowledge it warmly and say the store will pick it up; their messages are fed to the personalization loop.
- context.remembered lists what the shopper told you on this and earlier visits. The store already re-applies it; if they ask what you remember, tell them from that list.
- If context.applied is present, the storefront ALREADY changed for their request; confirm what changed in one happy short sentence ("Done! Menswear up front, navy first."), never say you can't change things.
`

const ACT_WITH_MARKER = `
You can also ACT on the store, not just talk. When it helps, end your reply with one line exactly like:
<<<ACTIONS>>>[{"action":"add_to_bag","productId":"p-12","color":"navy","size":"M"}]

Available actions:
- {"action":"add_to_bag","productId":"...","color":"...","size":"..."} adds a catalog product to the bag. productId must be an id from CATALOG; color and size must come from that product's colors/sizes arrays (omit them to use the default). You may add several items in one array.
- {"action":"ask_checkout"} shows the shopper a Yes / Not yet button pair. Required: every time you add items, the actions array MUST end with ask_checkout, and your text should ask if they are done shopping.
- {"action":"checkout"} pays for everything in the bag and takes the shopper to confirmation. Only when they clearly say they are done and want to pay ("yes", "checkout", "let's pay", "I'm done").

Shopping flow:
- Only add_to_bag (or say you added) when the shopper asks for a SPECIFIC item to buy: "buy", "add", "get me the X", "I'll take the X", "the navy tee in M". Browsing asks — "show me", "I need more sale stuff", "any men's deals?", "what navy things do you have" — mean show, not add: name one or two real catalog matches and ask which they'd like, with NO add action.
- If they describe what they want ("I need a navy shoe", "something for a winter wedding under $150"), pick the best matching products from CATALOG, add_to_bag them, and in your text say what you added, then emit ask_checkout so the buttons appear and ask if they are done or want anything else.
- If they keep asking for more, keep shopping with them. When they say they are done or ask to pay, emit checkout and say you're taking them to payment.
- Never emit an action for products not in CATALOG, and never claim an action happened without emitting it.
- CRITICAL: words alone do nothing. Saying "I added it" without the add_to_bag action leaves the bag empty; saying "taking you to payment" without the checkout action charges nothing. If your text describes an act, the same reply MUST end with the <<<ACTIONS>>> line for it.
`

const ACT_WITH_TOOLS = `
You look things up and act on the store through tools. Words alone do nothing.
- search_products: the store's catalog. Call it before you name, recommend or add any product. Product names, prices, colors and sizes come only from its results.
- check_bag: what is in the bag right now.
- add_to_bag: adds one product. Call it only when the shopper asks to buy a SPECIFIC item: "buy", "add", "get me the X", "I'll take the X", "the navy tee in M". Use an id from search_products. Call it once per item.
- checkout: call it only when the shopper clearly says they are done and want to pay ("yes", "checkout", "let's pay", "I'm done").

Shopping flow:
- Browsing asks ("show me", "I need more sale stuff", "any men's deals?", "what navy things do you have") mean show, not add: search, name one or two matches with their prices, and ask which they'd like. Do not call add_to_bag.
- If they describe what they want to buy ("I need a navy shoe", "buy me something for a winter wedding under $150"), search, add the best match, say what you added, and ask if they are done shopping or want anything else. The store shows Yes / Not yet buttons.
- If add_to_bag or checkout returns ok false, nothing happened. Tell the shopper what it said and offer what it suggests. Never say an item was added or paid for unless the tool returned ok true in this reply.
- Do not announce that you are searching. Call the tool, then answer.
- Never write <<<ACTIONS>>> or JSON in your reply.
`

const MAX_LEN = 800
const MAX_HISTORY = 12
const MAX_CONTEXT = 12_000

/** The shopper's context as the browser sent it, minus its copy of the catalog. */
function contextJson(context: unknown): string {
  if (!context || typeof context !== "object") return "{}"
  const rest = { ...(context as Record<string, unknown>) }
  delete rest.catalog
  return JSON.stringify(rest).slice(0, MAX_CONTEXT)
}

export async function POST(req: Request) {
  const provider = llmProvider()
  if (!provider) return NextResponse.json({ error: missingKeyMessage() }, { status: 503 })
  let body: { message?: unknown; history?: unknown; context?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 })
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_LEN) : ""
  if (!message) return NextResponse.json({ error: "empty message" }, { status: 400 })
  const history: ChatMessage[] = (Array.isArray(body.history) ? body.history : [])
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof m === "object" &&
        ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
        typeof (m as ChatMessage).content === "string",
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_LEN) }))
  const context = contextJson(body.context)
  const messages: ChatMessage[] = [...history, { role: "user", content: message }]
  const useTools = toolsAvailable() && process.env.CHAT_TOOLS !== "off"

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sent = 0
      const send = (event: Record<string, unknown>) => {
        sent += 1
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }
      const withMarker = async () => {
        const result = await chat(
          `${RULES}${ACT_WITH_MARKER}\nCONTEXT:\n${context}\n\nCATALOG:\n${JSON.stringify(catalogForPrompt())}`,
          messages,
          (text) => send({ type: "delta", text }),
        )
        send({ type: "done", model: result.model, ms: result.ms })
      }
      const withTools = async () => {
        const session = new ToolSession(bagFrom(body.context))
        const newGate = () => new MarkerGate((text) => send({ type: "delta", text }))
        let gate = newGate()
        const result = await chatWithTools(`${RULES}${ACT_WITH_TOOLS}\nCONTEXT:\n${context}`, messages, CHAT_TOOLS, {
          onDelta: (piece) => gate.push(piece),
          onDrop: () => {
            if (gate.sentAny()) send({ type: "reset" })
            gate = newGate()
          },
          runTool: (name, args) => {
            const out = session.run(name, args)
            send({ type: "tool", name, detail: session.calls.at(-1)?.detail ?? "" })
            return out
          },
        })
        gate.flush()
        // The model acted but wrote nothing: say only what the tools confirmed.
        if (!gate.sentAny() && session.fallbackText()) send({ type: "delta", text: session.fallbackText() })
        const actions = session.finalActions()
        if (actions.length) {
          send({ type: "delta", text: `\n<<<ACTIONS>>>${JSON.stringify(actions)}` })
        } else if (gate.markerTail()) {
          // It wrote the action line by hand instead of calling a tool; the browser validates it as before.
          send({ type: "delta", text: gate.markerTail() })
        }
        send({ type: "done", model: result.model, ms: result.ms, tools: session.calls.length })
      }
      try {
        if (useTools) {
          try {
            await withTools()
          } catch (err) {
            // Nothing reached the shopper yet (the provider refused the tool request): answer the old way.
            if (sent > 0) throw err
            console.error("chat with tools failed, retrying without", err)
            await withMarker()
          }
        } else {
          await withMarker()
        }
      } catch (err) {
        console.error("chat failed", err)
        send({ type: "error", error: err instanceof Error ? err.message : "LLM call failed" })
      }
      controller.close()
    },
  })
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform" },
  })
}
