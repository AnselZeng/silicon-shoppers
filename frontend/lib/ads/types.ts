import type { GarmentType } from "@/lib/store/types"

export const AD_SLOT_IDS = [
  "top_strip",
  "hero",
  "listing_banner",
  "grid_tile",
  "popup",
  "interstitial",
  "sticky_footer",
] as const

export type AdSlotId = (typeof AD_SLOT_IDS)[number]

export const AD_KINDS = [
  "sale",
  "new_drop",
  "collection",
  "category",
  "newsletter",
  "shipping",
  "loyalty",
] as const

export type AdKind = (typeof AD_KINDS)[number]

export const AD_TRIGGERS = ["on_load", "delay", "scroll_depth", "exit_intent", "page_count"] as const
export type AdTrigger = (typeof AD_TRIGGERS)[number]

export type HMGarmentGroup = "cat_garment_upper_body" | "cat_garment_lower_body" | "cat_garment_full_body"

export interface HouseAdSpec {
  kind: AdKind
  department: "women" | "men" | "all"
  /** Category ads only. */
  hmCategory?: HMGarmentGroup
  headline: string
  body?: string
  cta: string
  /** Internal route. Department ads already point at their department. */
  href: string
  visual: "garment" | "pattern" | "type_only"
  /** Drawing used when visual is "garment". */
  garment?: GarmentType
  slots: AdSlotId[]
  /** Guideline text for the LLM, in the model's feature names. */
  suits?: string
}

export const INTRUSIVE_SLOTS: readonly AdSlotId[] = ["popup", "interstitial", "sticky_footer"]

/** Drop order when a layout has more than MAX_INTRUSIVE intrusive placements. */
export const INTRUSIVE_DROP_ORDER: readonly AdSlotId[] = ["interstitial", "popup", "sticky_footer"]

export const MAX_INTRUSIVE = 2

/** How many ads a placement in each slot may rotate through. */
export const SLOT_MAX_ADS: Record<AdSlotId, number> = {
  top_strip: 3,
  hero: 3,
  listing_banner: 1,
  grid_tile: 2,
  popup: 1,
  interstitial: 1,
  sticky_footer: 1,
}

export const SLOT_FORMAT: Record<AdSlotId, "static" | "carousel" | "dismissible"> = {
  top_strip: "carousel",
  hero: "carousel",
  listing_banner: "static",
  grid_tile: "static",
  popup: "dismissible",
  interstitial: "dismissible",
  sticky_footer: "dismissible",
}

/** Frequency caps. Counted per session; a new session (reset) clears them. */
export const SLOT_CAP: Record<AdSlotId, "none" | "once_per_session" | "until_dismissed"> = {
  top_strip: "none",
  hero: "none",
  listing_banner: "none",
  grid_tile: "none",
  popup: "once_per_session",
  interstitial: "once_per_session",
  sticky_footer: "until_dismissed",
}

export const SLOT_DESCRIPTION: Record<AdSlotId, string> = {
  top_strip: "Thin bar above the header, every page. Rotates when it has 2–3 ads.",
  hero: "Home hero, home page only. Rotates when it has 2–3 ads.",
  listing_banner: "Banner above the product grid on listing pages.",
  grid_tile: "Ad card inside a listing grid (listings only, up to 2).",
  popup: "Modal, any page. Dismissible, once per session.",
  interstitial: "Full-screen overlay between a listing and a product page. Dismissible, once per session.",
  sticky_footer: "Fixed bar at the bottom of every page. Dismissible, stays closed once dismissed.",
}

export const TRIGGER_DEFAULTS: Record<"popup" | "interstitial" | "sticky_footer", { trigger: AdTrigger; triggerValue?: number }> = {
  popup: { trigger: "delay", triggerValue: 2200 },
  interstitial: { trigger: "page_count", triggerValue: 1 },
  sticky_footer: { trigger: "scroll_depth", triggerValue: 25 },
}

export const TRIGGER_RANGE: Record<Exclude<AdTrigger, "on_load" | "exit_intent">, [number, number]> = {
  delay: [0, 30000],
  scroll_depth: [10, 100],
  page_count: [1, 10],
}

export function isIntrusiveSlot(slot: AdSlotId): boolean {
  return INTRUSIVE_SLOTS.includes(slot)
}
