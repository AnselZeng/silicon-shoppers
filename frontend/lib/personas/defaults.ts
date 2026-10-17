import { PERSONA_LABEL, type Persona, type PersonaTraits } from "@/lib/personas/schema"

const priceHunter: PersonaTraits = {
  preferredDepartment: "women",
  priceSensitivity: 88,
  maxBudget: 75,
  colorPreference: ["black", "navy", "grey"],
  noveltySeeking: 20,
}

const trendSeeker: PersonaTraits = {
  preferredDepartment: "women",
  priceSensitivity: 30,
  maxBudget: 160,
  colorPreference: ["black", "burgundy", "camel"],
  noveltySeeking: 90,
}

const missionShopper: PersonaTraits = {
  preferredDepartment: "men",
  priceSensitivity: 45,
  maxBudget: 140,
  colorPreference: ["black", "navy"],
  noveltySeeking: 15,
}

const brandLoyalist: PersonaTraits = {
  preferredDepartment: "both",
  priceSensitivity: 28,
  maxBudget: 220,
  colorPreference: ["black", "cream", "navy"],
  noveltySeeking: 18,
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
