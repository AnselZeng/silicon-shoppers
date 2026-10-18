import { llmStage, modelStage, type PipelineStage } from "@/lib/layout/pipeline"
import { cloneLayout, DEFAULT_LAYOUT } from "@/lib/layout/presets"
import type { LayoutConfig } from "@/lib/layout/types"
import type { ValidationReport } from "@/lib/layout/validate"
import { loadFixture, type FixtureEntry } from "@/lib/model/fixtures"
import type { ModelContext } from "@/lib/model/homepage"

/** A layout the shell can show: "default", or "<fixture id>:model" / "<fixture id>:llm". */
export interface Preview {
  id: string
  stage: PipelineStage
  label: string
  layout: LayoutConfig
  model: ModelContext | null
  report: ValidationReport
  note?: string
}

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
  report: { changes: [], fellBack: false },
})

export async function buildPreview(id: string, fixtures: FixtureEntry[]): Promise<Preview> {
  const { fixtureId, stage } = parsePreviewId(id)
  const entry = fixtures.find((item) => item.id === fixtureId)
  if (!entry) return DEFAULT_PREVIEW()
  const fixture = await loadFixture(entry)
  if (!fixture) return { ...DEFAULT_PREVIEW(), note: `could not load ${entry.doc}` }
  const model: ModelContext = { doc: fixture.doc, basketIds: entry.basket }
  if (stage === "llm" && fixture.llm !== null) {
    const result = llmStage(fixture.llm, model)
    return { id, stage, label: `${entry.label} · LLM layout`, model, ...result }
  }
  const result = modelStage(model)
  return {
    id: previewId(entry.id, "model"),
    stage: "model",
    label: `${entry.label} · model layout`,
    model,
    ...result,
    note: stage === "llm" ? "no LLM output for this fixture, showing the model layout" : undefined,
  }
}
