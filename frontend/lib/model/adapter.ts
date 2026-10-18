import { cloneLayout, DEFAULT_LAYOUT } from "@/lib/layout/presets"
import type { LayoutConfig } from "@/lib/layout/types"
import type { HomepageDoc } from "@/lib/model/homepage"

export function modelLayout(doc: HomepageDoc, basketIds: string[] = []): LayoutConfig {
  void doc
  void basketIds
  return cloneLayout(DEFAULT_LAYOUT)
}
