import { cloneLayout, DEFAULT_LAYOUT } from "@/lib/layout/presets"
import type { LayoutConfig } from "@/lib/layout/types"
import type { HomepageDoc } from "@/lib/model/homepage"
import type { StoreEvent } from "@/lib/sim/protocol"
import type { Product } from "@/lib/store/types"

export function modelLayout(home: HomepageDoc, _sessionDecisions?: HomepageDoc["decisions"]): LayoutConfig {
  void home
  return cloneLayout(DEFAULT_LAYOUT)
}

export function rankCatalog(products: Product[]): Product[] {
  return [...products]
}

export function fromStoreEvent(event: StoreEvent): { type: string } {
  return { type: event.type }
}
