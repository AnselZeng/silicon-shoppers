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

const SYSTEM = `You are the concierge inside ATELIER NINE, an online fashion store. You only talk about this store.

Answer questions about: the products, prices, sizes and colors; the shopper's bag, wishlist and browsing; and why the storefront looks the way it does for them.

Rules:
- Ground every answer in the CONTEXT JSON below. Product names, prices, colors, sizes and reasons all come from it — never invent products, prices or policies.
- "Why am I seeing X / why is the store arranged like this" answers quote the reason strings in context.decisions.
- Keep it to 1–3 short sentences. Plain text, no markdown, no bullet lists.
- If the question is not about shopping here, say so briefly and steer back ("I'm just the store concierge — ask me about the clothes").
- Never mention being an AI, the schema, the pipeline, Snowflake or model internals; say "the store learned" or "because you".
- If the shopper states a preference ("I love black shoes"), acknowledge it and say the store will pick it up — their messages are fed to the personalization loop.
- If context.applied is present, the storefront ALREADY changed for their request — confirm what changed in one short sentence ("Done — menswear up front, navy first"), never say you can't change things.

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
