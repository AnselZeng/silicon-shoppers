import type { StoreColor } from "@/config/ui"

export const PERSONA_IDS = [
  "price_hunter",
  "trend_seeker",
  "mission_shopper",
  "brand_loyalist",
] as const

export type PersonaId = (typeof PERSONA_IDS)[number]

export type DepartmentPref = "women" | "men" | "both"

/** Shopping traits a persona keeps. The persona builder turns these into a basket. */
export interface PersonaTraits {
  preferredDepartment: DepartmentPref
  priceSensitivity: number
  maxBudget: number
  noveltySeeking: number
  colorPreference: StoreColor[]
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

export const SORT_OPTIONS = [
  "relevance",
  "newest",
  "price_asc",
  "price_desc",
  "bestsellers",
] as const

export type SortOption = (typeof SORT_OPTIONS)[number]

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
