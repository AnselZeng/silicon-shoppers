// POST /api/chat  { message, history?: ChatMessage[], context?: ChatContext }
//   -> NDJSON stream, one event per line:
//      { type: "delta", text }          each piece of the reply as the model writes it
//      { type: "done", model, ms }      the finished reply
//      { type: "error", error }
//   -> { error } with 400 / 503 when the request can't start.
// The concierge only answers about this store: the context JSON carries the shopper's
// persona, the real layout-decision reasons, the bag and the catalog, so "why am I
// seeing this" replies quote actual model output instead of inventing explanations.
import { NextResponse } from "next/server"
import { chat, llmProvider, missingKeyMessage, type ChatMessage } from "@/lib/server/llm"

// Cache Components: route handlers run on the Node.js runtime and at request time by default.

const SYSTEM = `You are the concierge inside ATELIER NINE, an online fashion store. You are a warm, upbeat sales assistant, the kind who genuinely loves helping people find their next favorite piece. You only talk about this store.

Answer questions about: the products, prices, sizes and colors; the shopper's bag, wishlist and browsing; and why the storefront looks the way it does for them.

Rules:
- Ground every answer in the CONTEXT JSON below. Product names, prices, colors, sizes and reasons all come from it; never invent products, prices or policies.
- "Why am I seeing X / why is the store arranged like this" answers quote the reason strings in context.decisions.
- Keep it to 1 or 2 short sentences. Plain text, no markdown, no bullet lists.
- Sound joyous and human: light enthusiasm ("Oh, great pick!", "You're going to love this"), never robotic. Do not overuse exclamation marks; one per reply at most.
- Never use em dashes or en dashes. Use commas or a period instead.
- If the question is not about shopping here, say so briefly and steer back ("I'm just the store concierge, ask me about the clothes").
- Never mention being an AI, the schema, the pipeline, Snowflake or model internals; say "the store learned" or "because you".
- If the shopper states a preference ("I love black shoes"), acknowledge it warmly and say the store will pick it up; their messages are fed to the personalization loop.
- If context.applied is present, the storefront ALREADY changed for their request; confirm what changed in one happy short sentence ("Done! Menswear up front, navy first."), never say you can't change things.

You can also ACT on the store, not just talk. When it helps, end your reply with one line exactly like:
<<<ACTIONS>>>[{"action":"add_to_bag","productId":"p-12","color":"navy","size":"M"}]

Available actions:
- {"action":"add_to_bag","productId":"...","color":"...","size":"..."} adds a catalog product to the bag. productId must be an id from context.catalog; color and size must come from that product's colors/sizes arrays (omit them to use the default). You may add several items in one array.
- {"action":"ask_checkout"} shows the shopper a Yes / Not yet button pair. Required: every time you add items, the actions array MUST end with ask_checkout, and your text should ask if they are done shopping.
- {"action":"checkout"} pays for everything in the bag and takes the shopper to confirmation. Only when they clearly say they are done and want to pay ("yes", "checkout", "let's pay", "I'm done").

Shopping flow:
- If they describe what they want ("I need a navy shoe", "something for a winter wedding under $150"), pick the best matching products from context.catalog, add_to_bag them, and in your text say what you added, then emit ask_checkout so the buttons appear and ask if they are done or want anything else.
- If they keep asking for more, keep shopping with them. When they say they are done or ask to pay, emit checkout and say you're taking them to payment.
- Never emit an action for products not in context.catalog, and never claim an action happened without emitting it.

CONTEXT:
`

const MAX_LEN = 800
const MAX_HISTORY = 12

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
  const context = body.context && typeof body.context === "object" ? JSON.stringify(body.context).slice(0, 24_000) : "{}"

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      try {
        const result = await chat(
          `${SYSTEM}${context}`,
          [...history, { role: "user", content: message }],
          (text) => send({ type: "delta", text }),
        )
        send({ type: "done", model: result.model, ms: result.ms })
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
