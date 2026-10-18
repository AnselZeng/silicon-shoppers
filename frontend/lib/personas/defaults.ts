import { PERSONA_LABEL, type Persona, type PersonaTraits } from "@/lib/personas/schema"

const priceHunter: PersonaTraits = {
  menShare: 90,
  saleShare: 70,
  newShare: 10,
  priceLevel: 25,
  colorPreference: ["black", "navy", "grey"],
  basketSize: 12,
}

const trendSeeker: PersonaTraits = {
  menShare: 5,
  saleShare: 10,
  newShare: 75,
  priceLevel: 70,
  colorPreference: ["black", "burgundy", "camel"],
  basketSize: 14,
}

const missionShopper: PersonaTraits = {
  menShare: 50,
  saleShare: 20,
  newShare: 30,
  priceLevel: 50,
  colorPreference: [],
  basketSize: 3,
}

const brandLoyalist: PersonaTraits = {
  menShare: 0,
  saleShare: 55,
  newShare: 30,
  priceLevel: 15,
  colorPreference: ["black", "white", "navy"],
  basketSize: 11,
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
