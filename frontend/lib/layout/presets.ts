import type { LayoutConfig } from "@/lib/layout/types"

/**
 * House rulebook: stone, black, and the garment palette only.
 * A layout may change structure — hero, section order, sort, filters,
 * grid, checkout, and how a colorway is merchandised — not the brand colors.
 */

export const DEFAULT_LAYOUT: LayoutConfig = {
  defaultSort: "relevance",
  filterOrder: ["category", "size", "color", "price", "collection", "sale"],
  expandedFilters: ["category"],
  heroVariant: "editorial",
  popupEnabled: true,
  popupVariant: "newsletter",
  gridDensity: 3,
  homeSectionOrder: ["new_in", "bestsellers", "sale_picks", "collections"],
  showSaleBadgesProminently: false,
  quickViewEmphasis: false,
  searchEmphasized: false,
  heroMinimized: false,
  checkoutVariant: "click_to_pay",
  expressCheckout: false,
  showTrustBadges: false,
  conciergeEnabled: false,
  conciergeTone: "drops",
  loyaltyPrompt: false,
  colorMerchandising: "swatches",
}

export function cloneLayout(layout: LayoutConfig): LayoutConfig {
  return {
    ...layout,
    filterOrder: [...layout.filterOrder],
    expandedFilters: [...layout.expandedFilters],
    homeSectionOrder: [...layout.homeSectionOrder],
  }
}
