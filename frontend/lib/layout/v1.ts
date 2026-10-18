import type { AdId } from "@/lib/ads/catalog"
import type { AdPlacement, FilterSectionId, HomeBlock, LayoutConfig } from "@/lib/layout/schema"
import type { SortOption } from "@/lib/personas/schema"
import { CATEGORIES } from "@/lib/store/types"
import type { CheckoutVariant, ColorMerchandising, ConciergeTone } from "@/lib/layout/types"

/** The flat v1 layout (19 fields). Kept only to migrate old configs. */

export type HeroVariantV1 = "editorial" | "discount_banner" | "new_drop_banner" | "collection_banner"
export type PopupVariantV1 = "newsletter" | "new_drop"
export type HomeSectionIdV1 = "new_in" | "bestsellers" | "sale_picks" | "collections"

export interface LayoutConfigV1 {
  defaultSort: SortOption
  filterOrder: FilterSectionId[]
  expandedFilters: FilterSectionId[]
  heroVariant: HeroVariantV1
  popupEnabled: boolean
  popupVariant: PopupVariantV1
  gridDensity: 2 | 3 | 4
  homeSectionOrder: HomeSectionIdV1[]
  showSaleBadgesProminently: boolean
  quickViewEmphasis: boolean
  searchEmphasized: boolean
  heroMinimized: boolean
  checkoutVariant: CheckoutVariant
  expressCheckout: boolean
  showTrustBadges: boolean
  conciergeEnabled: boolean
  conciergeTone: ConciergeTone
  loyaltyPrompt: boolean
  colorMerchandising: ColorMerchandising
}

export const V1_DEFAULT_LAYOUT: LayoutConfigV1 = {
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

/** v1 heroes were womenswear; editorial and collection both become the collection ad. */
const HERO_AD: Record<HeroVariantV1, AdId> = {
  editorial: "collection_women",
  discount_banner: "sale_women",
  new_drop_banner: "new_women",
  collection_banner: "collection_women",
}

/** v1 derived the promo strip from the hero; editorial showed the shipping line. */
const STRIP_AD: Record<HeroVariantV1, AdId> = {
  editorial: "shipping",
  discount_banner: "sale_women",
  new_drop_banner: "new_women",
  collection_banner: "collection_women",
}

const POPUP_AD: Record<PopupVariantV1, AdId> = {
  newsletter: "newsletter",
  new_drop: "new_women",
}

function sectionBlock(section: HomeSectionIdV1): HomeBlock {
  switch (section) {
    case "new_in":
      return { type: "product_row", source: { kind: "new_in" }, limit: 8 }
    case "bestsellers":
      return { type: "product_row", source: { kind: "bestsellers" }, limit: 8 }
    case "sale_picks":
      return { type: "product_row", source: { kind: "sale" }, limit: 8 }
    case "collections":
      return { type: "category_tiles", categories: CATEGORIES.slice(0, 4) }
  }
}

export function looksLikeV1(value: unknown): value is LayoutConfigV1 {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.heroVariant === "string" && Array.isArray(record.homeSectionOrder)
}

export function migrateV1(v1: LayoutConfigV1): LayoutConfig {
  const placements: AdPlacement[] = [
    { slot: "top_strip", adIds: [STRIP_AD[v1.heroVariant]] },
    { slot: "hero", adIds: [HERO_AD[v1.heroVariant]] },
    // v1 also drew the hero, compact, above every listing
    { slot: "listing_banner", adIds: [HERO_AD[v1.heroVariant]] },
  ]
  if (v1.popupEnabled) {
    placements.push({ slot: "popup", adIds: [POPUP_AD[v1.popupVariant]], trigger: "delay", triggerValue: 2200 })
  }
  return {
    version: 2,
    nav: {
      order: ["women", "men", "new_in", "sale", "collections"],
      highlight: null,
      department: null,
      searchEmphasized: v1.searchEmphasized,
    },
    home: {
      blocks: [{ type: "hero" }, ...v1.homeSectionOrder.map(sectionBlock)],
      heroSize: v1.heroMinimized ? "compact" : "full",
      forYouIds: [],
      basketIds: [],
    },
    listing: {
      defaultSort: v1.defaultSort,
      filterOrder: [...v1.filterOrder],
      expandedFilters: [...v1.expandedFilters],
      gridDensity: v1.gridDensity,
      colorMerchandising: v1.colorMerchandising,
      colorHighlight: [],
      categoryOrder: [...CATEGORIES],
      card: {
        priceStyle: v1.showSaleBadgesProminently ? "sale_emphasis" : "plain",
        showRating: false,
        badges: ["new", "sale"],
        quickView: v1.quickViewEmphasis ? "emphasized" : "button",
      },
    },
    ads: { placements },
    copy: {},
    checkout: {
      variant: v1.checkoutVariant,
      expressCheckout: v1.expressCheckout,
      showTrustBadges: v1.showTrustBadges,
      loyaltyPrompt: v1.loyaltyPrompt,
    },
    concierge: { enabled: v1.conciergeEnabled, tone: v1.conciergeTone },
    reasons: [],
  }
}
