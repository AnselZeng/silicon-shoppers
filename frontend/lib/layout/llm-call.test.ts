import { afterEach, describe, expect, test, vi } from "vitest"
import { POST } from "@/app/api/llm-layout/route"
import { geminiSchema, llmInput, llmPrompt, type LlmEvent } from "@/lib/layout/llm"
import { llmStage } from "@/lib/layout/pipeline"
import { generateLayout, llmProvider, missingKeyMessage } from "@/lib/server/llm"
import { fixtureLlm, fixtureModel } from "@/lib/testing/fixtures"

const model = fixtureModel("fixture-men-sale")

function keys(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((item) => keys(item, out))
  else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      out.add(key)
      if (key === "properties") Object.values(value as object).forEach((child) => keys(child, out))
      else keys(value, out)
    }
  }
  return out
}

/** A server-sent event stream that delivers `text` in a few pieces, shaped by `chunk`. */
function sse(text: string, chunk: (piece: string) => unknown) {
  const pieces = text.match(/[\s\S]{1,500}/g) ?? []
  const body = pieces.map((piece) => `data: ${JSON.stringify(chunk(piece))}\n\n`).join("") + "data: [DONE]\n\n"
  return new Response(body, { headers: { "content-type": "text/event-stream" } })
}

function apiError(message: string, status: number) {
  return new Response(JSON.stringify({ error: { message } }), { status, headers: { "content-type": "application/json" } })
}

function geminiReply(text: string, status = 200) {
  if (status !== 200) return apiError(text, status)
  return sse(text, (piece) => ({ candidates: [{ content: { parts: [{ text: piece }] } }] }))
}

describe("what the LLM reads", () => {
  test("the input leaves out product tiles and shopper ids", () => {
    const input = llmInput({ ...model.doc, user_id: "u-123", customer_key: 7 }, "  gym clothes  ")
    const text = JSON.stringify(input)
    expect(input.ranked_products).toBe(model.doc.store_products?.length)
    expect(input.shopper_said).toBe("gym clothes")
    expect(text).not.toContain("u-123")
    expect(text).not.toContain("customer_key")
    expect(text).not.toContain("for_you\":[")
    expect(text).not.toContain("product_id")
  })

  test("the prompt mentions the sentence only when there is one", () => {
    expect(llmPrompt(llmInput(model.doc))).not.toContain("What the shopper said")
    expect(llmPrompt(llmInput(model.doc, "under $60"))).toContain('"under $60"')
  })

  test("the schema uses only keywords Gemini accepts", () => {
    const used = keys(geminiSchema())
    for (const banned of ["$schema", "const", "oneOf", "propertyNames"]) expect(used.has(banned), banned).toBe(false)
    const copy = (geminiSchema() as { properties: { copy: { properties: { adOverrides: { properties: object } } } } })
      .properties.copy.properties.adOverrides
    expect(Object.keys(copy.properties)).toContain("sale_men")
  })
})

function nebiusReply(content: string, status = 200) {
  if (status !== 200) return apiError(content, status)
  return sse(content, (piece) => ({ choices: [{ delta: { content: piece }, finish_reason: null }] }))
}

function useKeys(keys: { nebius?: string; gemini?: string; provider?: string; cache?: boolean }) {
  vi.stubEnv("NEBIUS_API_KEY", keys.nebius ?? "")
  vi.stubEnv("GEMINI_API_KEY", keys.gemini ?? "")
  vi.stubEnv("LLM_PROVIDER", keys.provider ?? "")
  vi.stubEnv("LLM_CACHE", keys.cache ? "on" : "")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("provider choice", () => {
  test("Nebius first, Gemini otherwise, LLM_PROVIDER forces one", () => {
    useKeys({})
    expect(llmProvider()).toBeNull()
    expect(missingKeyMessage()).toContain("NEBIUS_API_KEY or GEMINI_API_KEY")
    useKeys({ gemini: "g" })
    expect(llmProvider()).toBe("gemini")
    useKeys({ nebius: "n", gemini: "g" })
    expect(llmProvider()).toBe("nebius")
    useKeys({ nebius: "n", gemini: "g", provider: "gemini" })
    expect(llmProvider()).toBe("gemini")
    useKeys({ gemini: "g", provider: "nebius" })
    expect(llmProvider()).toBeNull()
    expect(missingKeyMessage()).toBe("NEBIUS_API_KEY is not set (LLM_PROVIDER=nebius)")
  })
})

describe("generateLayout with Nebius", () => {
  test("sends DeepSeek in JSON mode, parses a fenced answer, and caches the same input with LLM_CACHE=on", async () => {
    useKeys({ nebius: "nebius-key", cache: true })
    const fetch = vi.fn(async () => nebiusReply("```json\n" + JSON.stringify(fixtureLlm("fixture-men-sale")) + "\n```"))
    vi.stubGlobal("fetch", fetch)
    const input = llmInput(model.doc, "nebius cache test")
    const pieces: string[] = []
    const first = await generateLayout(input, (piece) => pieces.push(piece))
    expect(first.cached).toBe(false)
    expect(first.model).toBe("deepseek-ai/DeepSeek-V4-Flash-0731")
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.join("")).toBe(first.text)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.tokenfactory.nebius.com/v1/chat/completions")
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer nebius-key")
    const sent = JSON.parse(String(init.body)) as { model: string; stream: boolean; response_format: unknown; messages: { role: string; content: string }[] }
    expect(sent.model).toBe("deepseek-ai/DeepSeek-V4-Flash-0731")
    expect(sent.stream).toBe(true)
    expect(sent.response_format).toEqual({ type: "json_object" })
    expect((sent as unknown as { chat_template_kwargs: unknown }).chat_template_kwargs).toEqual({ thinking: false })
    expect(sent.messages[0].content).toContain("Output schema (JSON Schema)")
    expect(llmStage(first.layout, model).report.fellBack).toBe(false)
    const replayed: string[] = []
    const second = await generateLayout(input, (piece) => replayed.push(piece))
    expect(second.cached).toBe(true)
    expect(replayed.join("")).toBe(first.text)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test("throws a readable error on an API error or invalid JSON", async () => {
    useKeys({ nebius: "nebius-key" })
    vi.stubGlobal("fetch", vi.fn(async () => nebiusReply("model not found", 404)))
    await expect(generateLayout(llmInput(model.doc, "nebius error"))).rejects.toThrow("Nebius 404: model not found")
    vi.stubGlobal("fetch", vi.fn(async () => nebiusReply("{not json")))
    await expect(generateLayout(llmInput(model.doc, "nebius bad json"))).rejects.toThrow("Nebius returned invalid JSON")
  })
})

test("without LLM_CACHE every call goes to the LLM", async () => {
  useKeys({ nebius: "nebius-key" })
  const fetch = vi.fn(async () => nebiusReply(JSON.stringify(fixtureLlm("fixture-men-sale"))))
  vi.stubGlobal("fetch", fetch)
  const input = llmInput(model.doc, "no cache")
  expect((await generateLayout(input)).cached).toBe(false)
  expect((await generateLayout(input)).cached).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(2)
})

describe("generateLayout with Gemini", () => {
  test("parses the answer, sends the key in a header, and caches the same input with LLM_CACHE=on", async () => {
    useKeys({ gemini: "test-key", cache: true })
    const fetch = vi.fn(async () => geminiReply(JSON.stringify(fixtureLlm("fixture-men-sale"))))
    vi.stubGlobal("fetch", fetch)
    const input = llmInput(model.doc, "cache test")
    const first = await generateLayout(input)
    expect(first.cached).toBe(false)
    expect(first.model).toBe("gemini-3.5-flash")
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain("/models/gemini-3.5-flash:streamGenerateContent?alt=sse")
    expect(url).not.toContain("test-key")
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key")
    expect(llmStage(first.layout, model).report.fellBack).toBe(false)
    expect((await generateLayout(input)).cached).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test("throws a readable error on an API error or invalid JSON", async () => {
    useKeys({ gemini: "test-key" })
    vi.stubGlobal("fetch", vi.fn(async () => geminiReply("quota exceeded", 429)))
    await expect(generateLayout(llmInput(model.doc, "error"))).rejects.toThrow("Gemini 429: quota exceeded")
    vi.stubGlobal("fetch", vi.fn(async () => geminiReply("{not json")))
    await expect(generateLayout(llmInput(model.doc, "bad json"))).rejects.toThrow("Gemini returned invalid JSON")
  })
})

describe("POST /api/llm-layout", () => {
  const post = (body: unknown) =>
    POST(new Request("http://localhost/api/llm-layout", { method: "POST", body: JSON.stringify(body) }))

  test("answers 503 without a key", async () => {
    useKeys({})
    const res = await post({ input: llmInput(model.doc) })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain("NEBIUS_API_KEY")
  })

  test("rejects a bad body", async () => {
    useKeys({ gemini: "test-key" })
    expect((await post({ input: { nope: true } })).status).toBe(400)
  })

  test("streams the text as NDJSON, then the layout", async () => {
    useKeys({ nebius: "nebius-key" })
    const answer = JSON.stringify(fixtureLlm("fixture-women-new"))
    vi.stubGlobal("fetch", vi.fn(async () => nebiusReply(answer)))
    const res = await post({ input: llmInput(model.doc, "route stream") })
    expect(res.headers.get("content-type")).toContain("application/x-ndjson")
    const events = (await res.text()).trim().split("\n").map((line) => JSON.parse(line) as LlmEvent)
    const deltas = events.filter((event) => event.type === "delta")
    expect(deltas.length).toBeGreaterThan(1)
    expect(deltas.map((event) => event.text).join("")).toBe(answer)
    expect(events.at(-1)).toMatchObject({ type: "done", layout: fixtureLlm("fixture-women-new"), cached: false })
  })

  test("reports an LLM failure as an error event", async () => {
    useKeys({ gemini: "test-key" })
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal("fetch", vi.fn(async () => geminiReply("server down", 500)))
    const res = await post({ input: llmInput(model.doc, "route error") })
    expect(JSON.parse((await res.text()).trim())).toEqual({ type: "error", error: "Gemini 500: server down" })
  })
})
