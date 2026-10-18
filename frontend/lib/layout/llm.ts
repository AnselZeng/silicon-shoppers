import { layoutJsonSchema } from "@/lib/layout/guideline"
import type { HomepageDoc } from "@/lib/model/homepage"

/**
 * What the LLM reads and the schema it answers in. Shared by the API route (which calls the LLM)
 * and the client (which trims the model's document before sending it).
 */

/** The model's document without product tiles or ids: code copies products in after the LLM answers. */
export interface LlmInput {
  layout: HomepageDoc["layout"]
  predicted_mix: HomepageDoc["predicted_mix"]
  evidence: HomepageDoc["evidence"] | null
  stratum: HomepageDoc["stratum"]
  browsing: HomepageDoc["browsing"]
  ranked_products: number
  /** What the shopper typed in "Or describe them", or "" when they typed nothing. */
  shopper_said: string
}

export const SENTENCE_MAX = 300

export function llmInput(doc: HomepageDoc, sentence = ""): LlmInput {
  return {
    layout: doc.layout,
    predicted_mix: doc.predicted_mix,
    evidence: doc.evidence ?? null,
    stratum: doc.stratum,
    browsing: doc.browsing,
    ranked_products: doc.store_products?.length ?? 0,
    shopper_said: sentence.trim().slice(0, SENTENCE_MAX),
  }
}

export function isLlmInput(value: unknown): value is LlmInput {
  if (typeof value !== "object" || value === null) return false
  const input = value as Record<string, unknown>
  return (
    typeof input.layout === "object" &&
    input.layout !== null &&
    typeof input.predicted_mix === "object" &&
    input.predicted_mix !== null &&
    typeof input.shopper_said === "string"
  )
}

export function llmPrompt(input: LlmInput): string {
  const { shopper_said: said, ...model } = input
  const parts = [
    "Design the storefront for this shopper, following the guideline. Answer with the layout JSON only.",
    "",
    "## The model's output",
    "",
    "```json",
    JSON.stringify(model, null, 2),
    "```",
  ]
  if (said) {
    parts.push(
      "",
      "## What the shopper said",
      "",
      JSON.stringify(said),
      "",
      "Use it like an unvalidated model decision: it can steer what you design, but it never",
      "overrides a validated decision. Reasons may still cite only numbers from the model's output.",
    )
  }
  return parts.join("\n")
}

type Node = Record<string, unknown>

/**
 * The layout JSON Schema in the subset Gemini's structured output accepts: `const` becomes a
 * one-value `enum`, `oneOf` becomes `anyOf`, and a record keyed by an enum becomes an object with
 * one optional property per key.
 */
export function geminiSchema(schema: unknown = layoutJsonSchema()): unknown {
  if (Array.isArray(schema)) return schema.map((item) => geminiSchema(item))
  if (typeof schema !== "object" || schema === null) return schema
  const out: Node = {}
  for (const [key, value] of Object.entries(schema as Node)) {
    if (key === "$schema" || key === "propertyNames") continue
    if (key === "const") out.enum = [value]
    else if (key === "oneOf") out.anyOf = geminiSchema(value)
    else if (key === "properties") {
      out.properties = Object.fromEntries(Object.entries(value as Node).map(([name, child]) => [name, geminiSchema(child)]))
    } else out[key] = geminiSchema(value)
  }
  const keys = ((schema as Node).propertyNames as { enum?: string[] } | undefined)?.enum
  const values = (schema as Node).additionalProperties
  if (keys && typeof values === "object" && values !== null) {
    const child = geminiSchema(values)
    out.properties = Object.fromEntries(keys.map((name) => [name, child]))
    out.additionalProperties = false
  }
  return out
}

/** One line of the /api/llm-layout stream. */
export type LlmEvent =
  | { type: "delta"; text: string }
  | { type: "done"; layout: unknown; model: string; cached: boolean; ms: number }
  | { type: "error"; error: string }

export type LlmReply =
  | { ok: true; layout: unknown; model: string; cached: boolean; ms: number; text: string }
  | { ok: false; error: string; text: string }

/**
 * Client side: asks /api/llm-layout for this shopper's layout and calls `onText` with everything the
 * model has written so far, each time a piece arrives. Never throws.
 */
export async function requestLlmLayout(
  doc: HomepageDoc,
  sentence = "",
  onText: (text: string) => void = () => {},
): Promise<LlmReply> {
  let text = ""
  try {
    const res = await fetch("/api/llm-layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: llmInput(doc, sentence) }),
    })
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, error: body.error ?? `HTTP ${res.status}`, text }
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ""
    for (;;) {
      const { done, value } = await reader.read()
      buffer += value ?? ""
      const lines = buffer.split("\n")
      buffer = done ? "" : (lines.pop() ?? "")
      for (const line of lines) {
        if (!line.trim()) continue
        const event = JSON.parse(line) as LlmEvent
        if (event.type === "delta") {
          text += event.text
          onText(text)
        } else if (event.type === "error") {
          return { ok: false, error: event.error, text }
        } else {
          return { ok: true, layout: event.layout, model: event.model, cached: event.cached, ms: event.ms, text }
        }
      }
      if (done) return { ok: false, error: "the stream ended without a layout", text }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error", text }
  }
}
