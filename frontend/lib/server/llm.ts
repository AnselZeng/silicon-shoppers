// Server-only LLM call for the shopper's layout (app/api/llm-layout). Two providers:
//
//   nebius  DeepSeek on Nebius Token Factory (OpenAI-compatible, JSON mode)
//   gemini  Google Gemini (structured output with the layout JSON Schema)
//
// Env (.env.local / Vercel; never NEXT_PUBLIC_):
//   NEBIUS_API_KEY=...            Nebius Token Factory key
//   NEBIUS_MODEL=...              optional, default deepseek-ai/DeepSeek-V4-Flash-0731
//   GEMINI_API_KEY=...            free key from aistudio.google.com/apikey
//   GEMINI_MODEL=...              optional, default gemini-3.5-flash
//   LLM_PROVIDER=nebius|gemini    optional; otherwise the first provider with a key, Nebius first
// Without a key the route answers with an error and Run falls back to the model's rules.
// Server-only: import this from route handlers, never from client components.
import { createHash } from "node:crypto"
import { designGuideline } from "@/lib/layout/guideline"
import { geminiSchema, llmPrompt, type LlmInput } from "@/lib/layout/llm"

type Provider = "nebius" | "gemini"

const KEY_ENV: Record<Provider, string> = { nebius: "NEBIUS_API_KEY", gemini: "GEMINI_API_KEY" }

/** The provider Run uses, or null when no key is set. */
export function llmProvider(): Provider | null {
  const forced = process.env.LLM_PROVIDER
  if (forced === "nebius" || forced === "gemini") return process.env[KEY_ENV[forced]] ? forced : null
  if (process.env.NEBIUS_API_KEY) return "nebius"
  if (process.env.GEMINI_API_KEY) return "gemini"
  return null
}

/** Why there's no provider, for the route's error. */
export function missingKeyMessage(): string {
  const forced = process.env.LLM_PROVIDER
  if (forced === "nebius" || forced === "gemini") return `${KEY_ENV[forced]} is not set (LLM_PROVIDER=${forced})`
  return "no LLM key is set (NEBIUS_API_KEY or GEMINI_API_KEY)"
}

export function llmModel(provider: Provider): string {
  return provider === "nebius"
    ? process.env.NEBIUS_MODEL || "deepseek-ai/DeepSeek-V4-Flash-0731"
    : process.env.GEMINI_MODEL || "gemini-3.5-flash"
}

export interface LlmLayout {
  layout: unknown
  model: string
  cached: boolean
  ms: number
}

/** Same input, same answer: temperature 0 plus this cache keeps reruns instant and saves quota. */
const cache = new Map<string, unknown>()
const CACHE_MAX = 100

/** Parses the model's text as JSON, allowing a ```json fence around it. */
function parseJson(text: string, label: string, finish: string | undefined): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`${label} returned invalid JSON (finish reason ${finish ?? "unknown"})`)
  }
}

interface ChatResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[]
  error?: { message?: string } | string
  detail?: string
}

async function callNebius(model: string, prompt: string): Promise<unknown> {
  const res = await fetch("https://api.tokenfactory.nebius.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.NEBIUS_API_KEY ?? ""}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      // DeepSeek V4 thinks before answering by default: ~5k reasoning tokens, ~35s, and it can run out
      // of output tokens before writing the JSON. Off, it answers in ~6s with the same schema.
      chat_template_kwargs: { thinking: false },
      messages: [
        // The guideline ends with the output JSON Schema; JSON mode doesn't enforce it, the validator does.
        { role: "system", content: `${designGuideline()}\n\nAnswer with a single JSON object matching the output schema.` },
        { role: "user", content: prompt },
      ],
    }),
  })
  const body = (await res.json().catch(() => ({}))) as ChatResponse
  if (!res.ok) {
    const message = typeof body.error === "string" ? body.error : (body.error?.message ?? body.detail ?? res.statusText)
    throw new Error(`Nebius ${res.status}: ${message}`)
  }
  const choice = body.choices?.[0]
  const text = choice?.message?.content ?? ""
  if (!text && choice?.finish_reason === "length") throw new Error("Nebius ran out of output tokens before answering")
  if (!text) throw new Error(`Nebius returned no text (finish reason ${choice?.finish_reason ?? "unknown"})`)
  return parseJson(text, "Nebius", choice?.finish_reason)
}

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
  error?: { message?: string }
}

async function callGemini(model: string, prompt: string): Promise<unknown> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: designGuideline() }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseJsonSchema: geminiSchema(),
        },
      }),
    },
  )
  const body = (await res.json().catch(() => ({}))) as GenerateResponse
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${body.error?.message ?? res.statusText}`)
  if (body.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt: ${body.promptFeedback.blockReason}`)
  const candidate = body.candidates?.[0]
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("")
  if (!text) throw new Error(`Gemini returned no text (finish reason ${candidate?.finishReason ?? "unknown"})`)
  return parseJson(text, "Gemini", candidate?.finishReason)
}

/** Asks the configured LLM for a layout. Throws with a readable message on any failure. No timeout: it waits. */
export async function generateLayout(input: LlmInput): Promise<LlmLayout> {
  const provider = llmProvider()
  if (!provider) throw new Error(missingKeyMessage())
  const model = llmModel(provider)
  const prompt = llmPrompt(input)
  const key = createHash("sha256").update(`${provider}\n${model}\n${prompt}`).digest("hex")
  if (cache.has(key)) return { layout: cache.get(key), model, cached: true, ms: 0 }

  const started = Date.now()
  const layout = provider === "nebius" ? await callNebius(model, prompt) : await callGemini(model, prompt)
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
  cache.set(key, layout)
  return { layout, model, cached: false, ms: Date.now() - started }
}
