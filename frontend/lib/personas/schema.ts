import type { StoreColor } from "@/config/ui"

export const PERSONA_IDS = [
  "price_hunter",
  "trend_seeker",
  "mission_shopper",
  "brand_loyalist",
] as const

export type PersonaId = (typeof PERSONA_IDS)[number]

export type DepartmentPref = "women" | "men" | "both"
export type SortOption =
  | "relevance"
  | "newest"
  | "price_asc"
  | "price_desc"
  | "bestsellers"
export type FirstFilter =
  | "sale"
  | "color"
  | "size"
  | "category"
  | "collection"
  | "none"
export type BannerTrigger = "discount" | "new_drop" | "collection" | "any"

export interface PersonaTraits {
  preferredDepartment: DepartmentPref
  defaultSortPreference: SortOption
  firstFilterUsed: FirstFilter
  priceSensitivity: number
  maxBudget: number
  popupTolerance: number
  bannerClickRate: number
  bannerTrigger: BannerTrigger
  scrollDepth: number
  productsViewedBeforeDecision: number
  imageVsTextAttention: number
  readsReviews: boolean
  usesSearch: number
  usesWishlist: number
  colorPreference: StoreColor[]
  sizePreference: string
  noveltySeeking: number
  brandCollectionLoyalty: number
  sessionPatience: number
  addToCartThreshold: number
  device: "desktop"
}

export interface Persona {
  id: string
  name: string
  baseId: PersonaId
  isCustom: boolean
  traits: PersonaTraits
}

export const PERSONA_LABEL: Record<PersonaId, string> = {
  price_hunter: "Price Hunter",
  trend_seeker: "Trend Seeker",
  mission_shopper: "Mission Shopper",
  brand_loyalist: "Brand Loyalist",
}

export const SORT_OPTIONS: SortOption[] = [
  "relevance",
  "newest",
  "price_asc",
  "price_desc",
  "bestsellers",
]

export const SORT_LABEL: Record<SortOption, string> = {
  relevance: "Relevance",
  newest: "Newest",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  bestsellers: "Bestsellers",
}

export function isPersonaId(value: string): value is PersonaId {
  return (PERSONA_IDS as readonly string[]).includes(value)
}
