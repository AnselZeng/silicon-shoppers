import { forYouIds } from "@/lib/model/adapter"
import type { ModelContext } from "@/lib/model/homepage"
import { modelCategoryOrder } from "@/lib/model/policy"
import { validateLayout, type ValidationResult } from "@/lib/layout/validate"

/**
 * Code, not the LLM, copies data into a layout: the model's ranked products, the basket and the
 * model's category order. Run on LLM output before validation. Leaves non-objects alone so the
 * validator can reject them.
 */
export function withModelData(raw: unknown, model: ModelContext): unknown {
  if (typeof raw !== "object" || raw === null) return raw
  const config = JSON.parse(JSON.stringify(raw)) as Record<string, Record<string, unknown> | unknown>
  const home = (typeof config.home === "object" && config.home !== null ? config.home : {}) as Record<string, unknown>
  home.forYouIds = forYouIds(model.doc, model.basketIds)
  home.basketIds = [...model.basketIds]
  config.home = home
  if (typeof config.listing === "object" && config.listing !== null) {
    ;(config.listing as Record<string, unknown>).categoryOrder = modelCategoryOrder(model.doc)
  }
  return config
}

/** default: the house store. model: the model's JSON only (the store doesn't change). llm: the LLM's layout. */
export type PipelineStage = "default" | "model" | "llm"

/** LLM output -> copied data -> validator. A broken config falls back to the house default. */
export function llmStage(raw: unknown, model: ModelContext): ValidationResult {
  return validateLayout(withModelData(raw, model), { model })
}
