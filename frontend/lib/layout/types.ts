import type { SortOption } from "@/lib/personas/schema"

export const FILTER_SECTION_IDS = [
  "sale",
  "price",
  "size",
  "color",
  "category",
  "collection",
] as const

export type FilterSectionId = (typeof FILTER_SECTION_IDS)[number]

export type HeroVariant =
  | "editorial"
  | "discount_banner"
  | "new_drop_banner"
  | "collection_banner"

export type PopupVariant = "newsletter" | "new_drop"

export type HomeSectionId = "new_in" | "bestsellers" | "sale_picks" | "collections"

export type CheckoutVariant = "guest_fast" | "click_to_pay" | "saved_card" | "loyalty_pay"

export type ConciergeTone = "deals" | "drops" | "mission" | "loyalty"

/** How one garment is shown. The palette stays the house colors. */
export type ColorMerchandising = "swatches" | "hover_preview" | "split_colors" | "color_locked"

export interface LayoutConfig {
  defaultSort: SortOption
  filterOrder: FilterSectionId[]
  expandedFilters: FilterSectionId[]
  heroVariant: HeroVariant
  popupEnabled: boolean
  popupVariant: PopupVariant
  gridDensity: 2 | 3 | 4
  homeSectionOrder: HomeSectionId[]
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

export const FILTER_LABEL: Record<FilterSectionId, string> = {
  sale: "Sale",
  price: "Price",
  size: "Size",
  color: "Color",
  category: "Category",
  collection: "Collection",
}

export const CHECKOUT_COPY: Record<CheckoutVariant, { title: string; detail: string }> = {
  guest_fast: {
    title: "Guest express",
    detail: "No account. Pay and go.",
  },
  click_to_pay: {
    title: "Click to Pay",
    detail: "Visa Unified Checkout on this device.",
  },
  saved_card: {
    title: "Saved Visa",
    detail: "Card on file for this demo session.",
  },
  loyalty_pay: {
    title: "Loyalty pay",
    detail: "Visa plus Atelier Nine points.",
  },
}
