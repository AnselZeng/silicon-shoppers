// Server-only LLM call for the shopper's layout (app/api/llm-layout). Two providers:
//
//   nebius  DeepSeek on Nebius Token Factory (OpenAI-compatible, JSON mode)
//   gemini  Google Gemini (structured output with the layout JSON Schema)
//
// Env (.env.local / Vercel; never NEXT_PUBLIC_):
//   NEBIUS_API_KEY=...            Nebius Token Factory key
//   NEBIUS_MODEL=...              optional, default deepseek-ai/DeepSeek-V4.1-Flash-1017
//   GEMINI_API_KEY=...            free key from aistudio.google.com/apikey
//   GEMINI_MODEL=...              optional, default gemini-3.5-flash
//   LLM_PROVIDER=nebius|gemini    optional; otherwise the first provider with a key, Nebius first
//   LLM_CACHE=on                  optional; reuse the answer for the same input (off for demos, so every Run streams live)
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
    ? process.env.NEBIUS_MODEL || "deepseek-ai/DeepSeek-V4.1-Flash-1017"
    : process.env.GEMINI_MODEL || "gemini-3.5-flash"
}

export interface LlmLayout {
  layout: unknown
  model: string
  cached: boolean
  ms: number
  /** The model's raw text, as it streamed in. */
  text: string
}

/** Called with each piece of text as the model writes it. */
export type OnDelta = (text: string) => void

/** With LLM_CACHE=on, the same input reuses the answer: reruns are instant and save quota. */
const cache = new Map<string, { layout: unknown; text: string }>()
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

/** Yields the JSON payload of each `data:` line of a server-sent event stream. */
async function* sseData(res: Response): AsyncGenerator<unknown> {
  if (!res.body) return
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    buffer += value ?? ""
    const lines = buffer.split(/\r?\n/)
    buffer = done ? "" : (lines.pop() ?? "")
    for (const line of lines) {
      if (!line.startsWith("data:")) continue
      const data = line.slice(5).trim()
      if (!data || data === "[DONE]") continue
      yield JSON.parse(data)
    }
    if (done) return
  }
}

interface ErrorBody {
  error?: { message?: string } | string
  detail?: string
}

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as ErrorBody
  return typeof body.error === "string" ? body.error : (body.error?.message ?? body.detail ?? res.statusText)
}

interface ChatChunk extends ErrorBody {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[]
}

async function streamNebius(model: string, prompt: string, onDelta: OnDelta): Promise<{ text: string; finish?: string }> {
  const res = await fetch("https://api.tokenfactory.nebius.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.NEBIUS_API_KEY ?? ""}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      stream: true,
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
  if (!res.ok) throw new Error(`Nebius ${res.status}: ${await errorMessage(res)}`)
  let text = ""
  let finish: string | undefined
  for await (const data of sseData(res)) {
    const chunk = data as ChatChunk
    if (chunk.error) throw new Error(`Nebius: ${typeof chunk.error === "string" ? chunk.error : chunk.error.message}`)
    const choice = chunk.choices?.[0]
    const piece = choice?.delta?.content ?? ""
    if (piece) {
      text += piece
      onDelta(piece)
    }
    if (choice?.finish_reason) finish = choice.finish_reason
  }
  if (!text && finish === "length") throw new Error("Nebius ran out of output tokens before answering")
  if (!text) throw new Error(`Nebius returned no text (finish reason ${finish ?? "unknown"})`)
  return { text, finish }
}

interface GenerateChunk extends ErrorBody {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}

async function streamGemini(model: string, prompt: string, onDelta: OnDelta): Promise<{ text: string; finish?: string }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
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
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await errorMessage(res)}`)
  let text = ""
  let finish: string | undefined
  for await (const data of sseData(res)) {
    const chunk = data as GenerateChunk
    if (chunk.error) throw new Error(`Gemini: ${typeof chunk.error === "string" ? chunk.error : chunk.error.message}`)
    if (chunk.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt: ${chunk.promptFeedback.blockReason}`)
    const candidate = chunk.candidates?.[0]
    for (const part of candidate?.content?.parts ?? []) {
      if (part.thought || !part.text) continue
      text += part.text
      onDelta(part.text)
    }
    if (candidate?.finishReason) finish = candidate.finishReason
  }
  if (!text) throw new Error(`Gemini returned no text (finish reason ${finish ?? "unknown"})`)
  return { text, finish }
}

// ---------------------------------------------------------------- concierge chat
//
// Same providers, but plain text (not JSON mode) with a shopping-only system prompt.
// The client sends the shopper's context (persona, decision reasons, bag, catalog) so
// "why am I seeing this" answers quote the real reasons instead of guessing.

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatReply {
  text: string;
  model: string;
  ms: number;
}

async function chatNebius(model: string, system: string, messages: ChatMessage[], onDelta: OnDelta): Promise<string> {
  const res = await fetch("https://api.tokenfactory.nebius.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.NEBIUS_API_KEY ?? ""}` },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 1024,
      stream: true,
      chat_template_kwargs: { thinking: false },
      messages: [{ role: "system", content: system }, ...messages],
    }),
  })
  if (!res.ok) throw new Error(`Nebius ${res.status}: ${await errorMessage(res)}`)
  let text = ""
  let finish: string | undefined
  for await (const data of sseData(res)) {
    const chunk = data as ChatChunk
    if (chunk.error) throw new Error(`Nebius: ${typeof chunk.error === "string" ? chunk.error : chunk.error.message}`)
    const choice = chunk.choices?.[0]
    const piece = choice?.delta?.content ?? ""
    if (piece) {
      text += piece
      onDelta(piece)
    }
    if (choice?.finish_reason) finish = choice.finish_reason
  }
  if (!text) throw new Error(`Nebius returned no text (finish reason ${finish ?? "unknown"})`)
  return text
}

async function chatGemini(model: string, system: string, messages: ChatMessage[], onDelta: OnDelta): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
      }),
    },
  )
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await errorMessage(res)}`)
  let text = ""
  let finish: string | undefined
  for await (const data of sseData(res)) {
    const chunk = data as GenerateChunk
    if (chunk.error) throw new Error(`Gemini: ${typeof chunk.error === "string" ? chunk.error : chunk.error.message}`)
    if (chunk.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt: ${chunk.promptFeedback.blockReason}`)
    const candidate = chunk.candidates?.[0]
    for (const part of candidate?.content?.parts ?? []) {
      if (part.thought || !part.text) continue
      text += part.text
      onDelta(part.text)
    }
    if (candidate?.finishReason) finish = candidate.finishReason
  }
  if (!text) throw new Error(`Gemini returned no text (finish reason ${finish ?? "unknown"})`)
  return text
}

// ---------------------------------------------------------------- concierge chat with tools
//
// Nebius only (OpenAI-style tool calling). The model may call tools for several rounds; each
// round streams. A round that ends in tool calls was the model thinking out loud ("let me
// look that up"), so the caller is told to drop whatever text it streamed.

interface ToolChunk extends ErrorBody {
  choices?: {
    delta?: {
      content?: string | null
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
    }
    finish_reason?: string | null
  }[]
}

export interface ToolHooks {
  /** Reply text as the model writes it. */
  onDelta: OnDelta
  /** The round ended in tool calls: text streamed since the last drop was not the reply. */
  onDrop: () => void
  /** Runs one tool call and returns its JSON-serializable result. */
  runTool: (name: string, args: Record<string, unknown>) => unknown
}

export interface ToolChatReply extends ChatReply {
  /** Model calls made, including the one that wrote the reply. */
  rounds: number
}

/** True when the configured provider can call tools. */
export function toolsAvailable(): boolean {
  return llmProvider() === "nebius"
}

const MAX_TOOL_ROUNDS = 5

/**
 * A concierge reply where the model may call `tools` first. Returns the text of the last round.
 * Throws with a readable message on any failure; nothing has been streamed if the first call fails.
 */
export async function chatWithTools(
  system: string,
  messages: ChatMessage[],
  tools: readonly unknown[],
  hooks: ToolHooks,
): Promise<ToolChatReply> {
  if (!toolsAvailable()) throw new Error("tool calling needs the Nebius provider")
  const model = llmModel("nebius")
  const started = Date.now()
  const convo: unknown[] = [{ role: "system", content: system }, ...messages]
  for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
    const res = await fetch("https://api.tokenfactory.nebius.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.NEBIUS_API_KEY ?? ""}` },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 1024,
        stream: true,
        chat_template_kwargs: { thinking: false },
        messages: convo,
        tools,
        // the last round must answer in words
        tool_choice: round === MAX_TOOL_ROUNDS ? "none" : "auto",
      }),
    })
    if (!res.ok) throw new Error(`Nebius ${res.status}: ${await errorMessage(res)}`)
    let text = ""
    const calls: { id: string; name: string; args: string }[] = []
    for await (const data of sseData(res)) {
      const chunk = data as ToolChunk
      if (chunk.error) throw new Error(`Nebius: ${typeof chunk.error === "string" ? chunk.error : chunk.error.message}`)
      const delta = chunk.choices?.[0]?.delta
      const piece = delta?.content ?? ""
      if (piece) {
        text += piece
        hooks.onDelta(piece)
      }
      for (const part of delta?.tool_calls ?? []) {
        const at = part.index ?? calls.length
        calls[at] ??= { id: "", name: "", args: "" }
        if (part.id) calls[at].id = part.id
        if (part.function?.name) calls[at].name += part.function.name
        if (part.function?.arguments) calls[at].args += part.function.arguments
      }
    }
    const asked = calls.filter((call) => call && call.name)
    if (!asked.length) return { text, model, ms: Date.now() - started, rounds: round }
    hooks.onDrop()
    convo.push({
      role: "assistant",
      content: text,
      tool_calls: asked.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.args || "{}" } })),
    })
    for (const call of asked) {
      let result: unknown
      try {
        const args = JSON.parse(call.args || "{}") as unknown
        result = hooks.runTool(call.name, args && typeof args === "object" ? (args as Record<string, unknown>) : {})
      } catch {
        result = { ok: false, error: "the arguments were not valid JSON" }
      }
      convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }
  throw new Error("Nebius kept calling tools without answering")
}

/**
 * Streams a concierge reply to `onDelta`. `system` is the shopping-scope prompt and context block
 * built by the route. Throws with a readable message on any failure.
 */
export async function chat(system: string, messages: ChatMessage[], onDelta: OnDelta = () => {}): Promise<ChatReply> {
  const provider = llmProvider()
  if (!provider) throw new Error(missingKeyMessage())
  const model = llmModel(provider)
  const started = Date.now()
  const text =
    provider === "nebius"
      ? await chatNebius(model, system, messages, onDelta)
      : await chatGemini(model, system, messages, onDelta)
  return { text, model, ms: Date.now() - started }
}

/**
 * Asks the configured LLM for a layout, streaming its text to `onDelta` as it's written.
 * Throws with a readable message on any failure. No timeout: it waits.
 */
export async function generateLayout(input: LlmInput, onDelta: OnDelta = () => {}): Promise<LlmLayout> {
  const provider = llmProvider()
  if (!provider) throw new Error(missingKeyMessage())
  const model = llmModel(provider)
  const prompt = llmPrompt(input)
  const key = createHash("sha256").update(`${provider}\n${model}\n${prompt}`).digest("hex")
  const useCache = process.env.LLM_CACHE === "on"
  const hit = useCache ? cache.get(key) : undefined
  if (hit) {
    onDelta(hit.text)
    return { ...hit, model, cached: true, ms: 0 }
  }

  const started = Date.now()
  const label = provider === "nebius" ? "Nebius" : "Gemini"
  const { text, finish } =
    provider === "nebius" ? await streamNebius(model, prompt, onDelta) : await streamGemini(model, prompt, onDelta)
  const layout = parseJson(text, label, finish)
  if (useCache) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
    cache.set(key, { layout, text })
  }
  return { layout, text, model, cached: false, ms: Date.now() - started }
}
