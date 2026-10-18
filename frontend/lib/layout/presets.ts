import type { LayoutConfig } from "@/lib/layout/types"
import { CATEGORIES } from "@/lib/store/types"

/**
 * House rulebook: stone, black, and the garment palette only.
 * A layout may change structure — nav, hero, home blocks, ads, sort, filters,
 * grid, checkout, and how a colorway is merchandised — not the brand colors.
 *
 * The house default is the v1 default migrated to v2 (see v1.test.ts).
 */

export const DEFAULT_LAYOUT: LayoutConfig = {
  version: 2,
  nav: {
    order: ["women", "men", "new_in", "sale", "collections"],
    highlight: null,
    department: null,
    searchEmphasized: false,
  },
  home: {
    blocks: [
      { type: "hero" },
      { type: "product_row", source: { kind: "new_in" }, limit: 8 },
      { type: "product_row", source: { kind: "bestsellers" }, limit: 8 },
      { type: "product_row", source: { kind: "sale" }, limit: 8 },
      { type: "category_tiles", categories: CATEGORIES.slice(0, 4) },
    ],
    heroSize: "full",
    forYouIds: [],
    basketIds: [],
  },
  listing: {
    defaultSort: "relevance",
    filterOrder: ["category", "size", "color", "price", "collection", "sale"],
    expandedFilters: ["category"],
    gridDensity: 3,
    colorMerchandising: "swatches",
    colorHighlight: [],
    categoryOrder: [...CATEGORIES],
    card: { priceStyle: "plain", showRating: false, badges: ["new", "sale"], quickView: "button" },
  },
  ads: {
    placements: [
      { slot: "top_strip", adIds: ["shipping"] },
      { slot: "hero", adIds: ["collection_women"] },
      { slot: "popup", adIds: ["newsletter"], trigger: "delay", triggerValue: 2200 },
    ],
  },
  copy: {},
  checkout: { variant: "click_to_pay", expressCheckout: false, showTrustBadges: false, loyaltyPrompt: false },
  concierge: { enabled: false, tone: "drops" },
  reasons: [],
}

export function cloneLayout(layout: LayoutConfig): LayoutConfig {
  return structuredClone(layout)
}
