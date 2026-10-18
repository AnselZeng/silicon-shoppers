import { llmStage, type PipelineStage } from "@/lib/layout/pipeline"
import { cloneLayout, DEFAULT_LAYOUT } from "@/lib/layout/presets"
import type { LayoutConfig } from "@/lib/layout/types"
import { validateLayout, type ValidationReport } from "@/lib/layout/validate"
import { modelLayout } from "@/lib/model/adapter"
import { loadFixture, type FixtureEntry } from "@/lib/model/fixtures"
import type { HomepageDoc, ModelContext } from "@/lib/model/homepage"

/**
 * What the shell shows: "default", "<fixture id>:model" or "<fixture id>:llm".
 * The model stage is the model's JSON only; the store stays on the house default.
 */
export interface Preview {
  id: string
  stage: PipelineStage
  label: string
  /** Layout sent to the store. */
  layout: LayoutConfig
  /** Model context the store's validator applies; null when the store shows the house default. */
  model: ModelContext | null
  /** The model's output and basket, for the panel. */
  doc: HomepageDoc | null
  basket: string[]
  report: ValidationReport
  note?: string
  /** On a Run: whether the LLM built the layout, or the model's rules after the LLM failed. */
  builtBy?: BuiltBy
}

export type BuiltBy =
  | { kind: "llm"; model: string; cached: boolean; ms: number; text: string }
  | { kind: "rules"; error: string; text: string }

export function previewId(fixtureId: string, stage: Exclude<PipelineStage, "default">): string {
  return `${fixtureId}:${stage}`
}

export function parsePreviewId(id: string): { fixtureId: string | null; stage: PipelineStage } {
  const [fixtureId, stage] = id.split(":")
  if (!fixtureId || id === "default") return { fixtureId: null, stage: "default" }
  return { fixtureId, stage: stage === "llm" ? "llm" : "model" }
}

const DEFAULT_PREVIEW = (): Preview => ({
  id: "default",
  stage: "default",
  label: "House default",
  layout: cloneLayout(DEFAULT_LAYOUT),
  model: null,
  doc: null,
  basket: [],
  report: { changes: [], fellBack: false },
})

export async function buildPreview(id: string, fixtures: FixtureEntry[]): Promise<Preview> {
  if (id.startsWith("shopper:")) return buildShopperPreview(id.slice("shopper:".length), fixtures)
  const { fixtureId, stage } = parsePreviewId(id)
  const entry = fixtures.find((item) => item.id === fixtureId)
  if (!entry) return DEFAULT_PREVIEW()
  const fixture = await loadFixture(entry)
  if (!fixture) return { ...DEFAULT_PREVIEW(), note: `could not load ${entry.doc}` }
  const model: ModelContext = { doc: fixture.doc, basketIds: entry.basket }
  if (stage === "llm" && fixture.llm !== null) {
    const result = llmStage(fixture.llm, model)
    return { id, stage, label: `${entry.label} · LLM layout`, model, doc: fixture.doc, basket: entry.basket, ...result }
  }
  return {
    ...DEFAULT_PREVIEW(),
    id: previewId(entry.id, "model"),
    stage: "model",
    label: `${entry.label} · model output`,
    doc: fixture.doc,
    basket: entry.basket,
    note: stage === "llm" ? "no LLM output for this fixture, showing the model output" : undefined,
  }
}

/** One Run: the model's document, then a layout the store can show. */
async function buildShopperPreview(fixtureId: string, fixtures: FixtureEntry[]): Promise<Preview> {
  const entry = fixtures.find((item) => item.id === fixtureId)
  if (!entry) return DEFAULT_PREVIEW()
  const fixture = await loadFixture(entry)
  if (!fixture) return { ...DEFAULT_PREVIEW(), note: `could not load ${entry.doc}` }
  const model: ModelContext = { doc: fixture.doc, basketIds: entry.basket }
  const result =
    fixture.llm !== null ? llmStage(fixture.llm, model) : validateLayout(modelLayout(fixture.doc).layout, { model })
  return {
    id: `shopper:${entry.id}`,
    stage: "llm",
    label: entry.label,
    model,
    doc: fixture.doc,
    basket: entry.basket,
    ...result,
  }
}
