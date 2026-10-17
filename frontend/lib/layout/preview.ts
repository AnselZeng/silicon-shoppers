import { cloneLayout, DEFAULT_LAYOUT } from "@/lib/layout/presets"
import type { LayoutConfig } from "@/lib/layout/types"

/** The storefront the shell should show for a preview id. */
export function previewLayout(preview: string): { layout: LayoutConfig; presetName: string | null } {
  void preview
  return { layout: cloneLayout(DEFAULT_LAYOUT), presetName: null }
}
