// POST /api/llm-layout  { input: LlmInput }
//   -> a stream of NDJSON events (lib/layout/llm.ts LlmEvent), one per line:
//      { type: "delta", text }                        each piece of text as the model writes it
//      { type: "done", layout, model, cached, ms }    the parsed layout
//      { type: "error", error }                       the call failed after streaming started
//   -> { error } with 400 / 503 when the request can't start (bad body, no key)
// The LLM (lib/server/llm.ts: Nebius DeepSeek or Gemini) designs the shopper's layout from the model's trimmed document.
// The client runs the answer through llmStage() and falls back to modelLayout() on any error.
import { NextResponse } from "next/server"
import { isLlmInput, type LlmEvent } from "@/lib/layout/llm"
import { generateLayout, llmModel, llmProvider, missingKeyMessage } from "@/lib/server/llm"

// Cache Components: route handlers run on the Node.js runtime and at request time by default.

export async function POST(req: Request) {
  const provider = llmProvider()
  if (!provider) return NextResponse.json({ error: missingKeyMessage() }, { status: 503 })
  let body: { input?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 })
  }
  const input = body.input
  if (!isLlmInput(input)) return NextResponse.json({ error: "bad input" }, { status: 400 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: LlmEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      try {
        const result = await generateLayout(input, (text) => send({ type: "delta", text }))
        send({ type: "done", layout: result.layout, model: result.model, cached: result.cached, ms: result.ms })
      } catch (err) {
        console.error(`llm layout failed (${llmModel(provider)})`, err)
        send({ type: "error", error: err instanceof Error ? err.message : "LLM call failed" })
      }
      controller.close()
    },
  })
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform" },
  })
}
