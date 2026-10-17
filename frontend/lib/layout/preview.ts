import { cloneLayout, DEFAULT_LAYOUT, PERSONA_LAYOUTS } from "@/lib/layout/presets"
import type { LayoutConfig } from "@/lib/layout/types"
import { PERSONA_LABEL, type Persona } from "@/lib/personas/schema"

/**
 * The storefront a shopper should see right now.
 * Persona ids map to layout presets today. A later model can replace this
 * function without changing the page.
 */
export function previewLayout(
  preview: string,
  personas: Persona[],
): { layout: LayoutConfig; presetName: string | null } {
  if (preview === "default") {
    return { layout: cloneLayout(DEFAULT_LAYOUT), presetName: null }
  }
  const persona = personas.find((item) => item.id === preview)
  if (!persona) return { layout: cloneLayout(DEFAULT_LAYOUT), presetName: null }
  return {
    layout: cloneLayout(PERSONA_LAYOUTS[persona.baseId]),
    presetName: PERSONA_LABEL[persona.baseId],
  }
}
