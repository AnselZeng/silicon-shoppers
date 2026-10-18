// POST /api/llm-layout  { input: LlmInput }  ->  { layout, model, cached, ms } | { error }
// The LLM (lib/server/llm.ts: Nebius DeepSeek or Gemini) designs the shopper's layout from the model's trimmed document (lib/layout/llm.ts).
// The client runs the answer through llmStage() and falls back to modelLayout() on any error.
import { NextResponse } from "next/server"
import { isLlmInput } from "@/lib/layout/llm"
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
  if (!isLlmInput(body.input)) return NextResponse.json({ error: "bad input" }, { status: 400 })
  try {
    return NextResponse.json(await generateLayout(body.input))
  } catch (err) {
    console.error(`llm layout failed (${llmModel(provider)})`, err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "LLM call failed" }, { status: 502 })
  }
}
