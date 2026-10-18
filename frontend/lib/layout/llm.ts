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

export type LlmReply =
  | { ok: true; layout: unknown; model: string; cached: boolean; ms: number }
  | { ok: false; error: string }

/** Client side: asks /api/llm-layout for this shopper's layout. Never throws. */
export async function requestLlmLayout(doc: HomepageDoc, sentence = ""): Promise<LlmReply> {
  try {
    const res = await fetch("/api/llm-layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: llmInput(doc, sentence) }),
    })
    const body = (await res.json().catch(() => ({}))) as {
      layout?: unknown
      model?: string
      cached?: boolean
      ms?: number
      error?: string
    }
    if (!res.ok || body.error || body.layout === undefined) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` }
    }
    return { ok: true, layout: body.layout, model: body.model ?? "llm", cached: !!body.cached, ms: body.ms ?? 0 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" }
  }
}
