import type {
  CHECKOUT_VARIANTS,
  COLOR_MERCHANDISING,
  CONCIERGE_TONES,
} from "@/lib/layout/enums"
import type { FilterSectionId } from "@/lib/layout/schema"

export type {
  AdPlacement,
  CopyConfig,
  FilterSectionId,
  HomeBlock,
  HomeConfig,
  LayoutConfig,
  LayoutFieldPath,
  LayoutReason,
  ListingConfig,
  LlmLayout,
  NavConfig,
  ProductSource,
} from "@/lib/layout/schema"
export { FILTER_SECTION_IDS } from "@/lib/layout/schema"

export type CheckoutVariant = (typeof CHECKOUT_VARIANTS)[number]
export type ConciergeTone = (typeof CONCIERGE_TONES)[number]

/** How one garment is shown. The palette stays the house colors. */
export type ColorMerchandising = (typeof COLOR_MERCHANDISING)[number]

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
    detail: "Visa plus SoCal Atelier points.",
  },
}
