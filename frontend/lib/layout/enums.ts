import { COLOR_HEX, type StoreColor } from "@/config/ui"

export { AD_IDS, type AdId } from "@/lib/ads/catalog"

export const NAV_ITEM_IDS = ["women", "men", "new_in", "sale", "collections", "for_you"] as const
export type NavItemId = (typeof NAV_ITEM_IDS)[number]

/** Sources of the model's own home rows. Their relative order is a validated model decision. */
export const MODEL_SECTIONS = ["new_in", "sale", "bestsellers", "buy_again"] as const
export type ModelSection = (typeof MODEL_SECTIONS)[number]

/** Decisions in HomepageDoc.layout that a reason can cite. */
export const MODEL_DECISION_KEYS = [
  "landing_department",
  "category_order",
  "section_order",
  "default_sort",
  "color_highlight",
  "price_filter_first",
  "filter_order",
  "hero",
  "popups",
  "grid_columns",
] as const
export type ModelDecisionKey = (typeof MODEL_DECISION_KEYS)[number]

export const REASON_CLASSES = ["Tested", "Estimated", "Assumed", "Based on your settings"] as const

export const STORE_COLOR_IDS = Object.keys(COLOR_HEX) as [StoreColor, ...StoreColor[]]

export const COLOR_MERCHANDISING = ["swatches", "hover_preview", "split_colors", "color_locked"] as const
export const CHECKOUT_VARIANTS = ["guest_fast", "click_to_pay", "saved_card", "loyalty_pay"] as const
export const CONCIERGE_TONES = ["deals", "drops", "mission", "loyalty"] as const
export const CARD_BADGES = ["new", "sale", "bestseller"] as const
export const UNDER_PRICE_MAX = [50, 100, 150] as const

/** Copy limits, in characters. */
export const COPY_LIMITS = {
  intro: 200,
  story: 400,
  headline: 40,
  cta: 20,
  rowTitle: 32,
  reason: 120,
} as const

export const HOME_BLOCKS_MIN = 3
export const HOME_BLOCKS_MAX = 8
export const NAV_ITEMS_MIN = 3
export const NAV_ITEMS_MAX = 6
export const TILES_MIN = 3
export const TILES_MAX = 6
export const FOR_YOU_MAX = 24
export const COLOR_HIGHLIGHT_MAX = 3
