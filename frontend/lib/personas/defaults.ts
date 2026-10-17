import { PERSONA_LABEL, type Persona, type PersonaTraits } from "@/lib/personas/schema"

const priceHunter: PersonaTraits = {
  preferredDepartment: "women",
  defaultSortPreference: "price_asc",
  firstFilterUsed: "sale",
  priceSensitivity: 88,
  maxBudget: 75,
  popupTolerance: 10,
  bannerClickRate: 55,
  bannerTrigger: "discount",
  scrollDepth: 85,
  productsViewedBeforeDecision: 8,
  imageVsTextAttention: 35,
  readsReviews: true,
  usesSearch: 25,
  usesWishlist: 20,
  colorPreference: ["black", "navy", "grey"],
  sizePreference: "M",
  noveltySeeking: 20,
  brandCollectionLoyalty: 15,
  sessionPatience: 22,
  addToCartThreshold: 55,
  device: "desktop",
}

const trendSeeker: PersonaTraits = {
  preferredDepartment: "women",
  defaultSortPreference: "newest",
  firstFilterUsed: "color",
  priceSensitivity: 30,
  maxBudget: 160,
  popupTolerance: 78,
  bannerClickRate: 70,
  bannerTrigger: "new_drop",
  scrollDepth: 60,
  productsViewedBeforeDecision: 6,
  imageVsTextAttention: 88,
  readsReviews: false,
  usesSearch: 20,
  usesWishlist: 45,
  colorPreference: ["black", "burgundy", "camel"],
  sizePreference: "S",
  noveltySeeking: 90,
  brandCollectionLoyalty: 25,
  sessionPatience: 24,
  addToCartThreshold: 50,
  device: "desktop",
}

const missionShopper: PersonaTraits = {
  preferredDepartment: "men",
  defaultSortPreference: "relevance",
  firstFilterUsed: "size",
  priceSensitivity: 45,
  maxBudget: 140,
  popupTolerance: 5,
  bannerClickRate: 8,
  bannerTrigger: "any",
  scrollDepth: 35,
  productsViewedBeforeDecision: 3,
  imageVsTextAttention: 25,
  readsReviews: true,
  usesSearch: 92,
  usesWishlist: 10,
  colorPreference: ["black", "navy"],
  sizePreference: "M",
  noveltySeeking: 15,
  brandCollectionLoyalty: 20,
  sessionPatience: 12,
  addToCartThreshold: 40,
  device: "desktop",
}

const brandLoyalist: PersonaTraits = {
  preferredDepartment: "both",
  defaultSortPreference: "bestsellers",
  firstFilterUsed: "collection",
  priceSensitivity: 28,
  maxBudget: 220,
  popupTolerance: 72,
  bannerClickRate: 62,
  bannerTrigger: "collection",
  scrollDepth: 48,
  productsViewedBeforeDecision: 4,
  imageVsTextAttention: 42,
  readsReviews: true,
  usesSearch: 18,
  usesWishlist: 74,
  colorPreference: ["black", "cream", "navy"],
  sizePreference: "M",
  noveltySeeking: 18,
  brandCollectionLoyalty: 86,
  sessionPatience: 58,
  addToCartThreshold: 48,
  device: "desktop",
}

export const DEFAULT_PERSONAS: Persona[] = [
  {
    id: "price_hunter",
    name: PERSONA_LABEL.price_hunter,
    baseId: "price_hunter",
    isCustom: false,
    traits: priceHunter,
  },
  {
    id: "trend_seeker",
    name: PERSONA_LABEL.trend_seeker,
    baseId: "trend_seeker",
    isCustom: false,
    traits: trendSeeker,
  },
  {
    id: "mission_shopper",
    name: PERSONA_LABEL.mission_shopper,
    baseId: "mission_shopper",
    isCustom: false,
    traits: missionShopper,
  },
  {
    id: "brand_loyalist",
    name: PERSONA_LABEL.brand_loyalist,
    baseId: "brand_loyalist",
    isCustom: false,
    traits: brandLoyalist,
  },
]

export function clonePersona(persona: Persona): Persona {
  return {
    ...persona,
    traits: {
      ...persona.traits,
      colorPreference: [...persona.traits.colorPreference],
    },
  }
}

export function defaultPersonaById(id: string): Persona | undefined {
  const found = DEFAULT_PERSONAS.find((persona) => persona.id === id)
  return found ? clonePersona(found) : undefined
}
