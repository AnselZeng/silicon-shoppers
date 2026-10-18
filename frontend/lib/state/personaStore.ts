"use client"

import { create } from "zustand"
import { clonePersona, DEFAULT_PERSONAS, defaultPersonaById } from "@/lib/personas/defaults"
import { STORE_COLORS, type StoreColor } from "@/config/ui"
import {
  isPersonaId,
  PERSONA_LABEL,
  type Persona,
  type PersonaTraits,
} from "@/lib/personas/schema"

interface PersonaState {
  personas: Persona[]
  selectedId: string
  select: (id: string) => void
  updateTraits: (id: string, patch: Partial<PersonaTraits>) => void
  rename: (id: string, name: string) => void
  reset: () => void
  resetOne: (id: string) => void
  duplicate: (id: string) => string | null
  exportPersona: (id: string) => string
  importPersona: (raw: string) => { ok: true; id: string } | { ok: false; error: string }
}

function cloneList(list: Persona[]): Persona[] {
  return list.map((persona) => clonePersona(persona))
}

function isStoreColor(value: unknown): value is StoreColor {
  return typeof value === "string" && (STORE_COLORS as readonly string[]).includes(value)
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function shareOr(value: unknown, fallback: number): number {
  const raw = numberOr(value, fallback)
  return Math.min(100, Math.max(0, Math.round(raw)))
}

function basketOr(value: unknown, fallback: number): number {
  const raw = numberOr(value, fallback)
  return Math.min(20, Math.max(3, Math.round(raw)))
}

function menShareFromLegacy(traits: Record<string, unknown>, fallback: number): number {
  if (traits.preferredDepartment === "men") return 90
  if (traits.preferredDepartment === "women") return 10
  if (traits.preferredDepartment === "both") return 50
  return fallback
}

function priceLevelFromBudget(budget: unknown, fallback: number): number {
  if (typeof budget !== "number" || !Number.isFinite(budget)) return fallback
  const t = (budget - 20) / 380
  return Math.min(100, Math.max(0, Math.round(10 + t * 85)))
}

function asPersona(value: unknown): Persona | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== "string" || typeof record.name !== "string") return null
  if (typeof record.traits !== "object" || record.traits === null) return null
  const traits = record.traits as Record<string, unknown>
  const baseId =
    typeof record.baseId === "string" && isPersonaId(record.baseId)
      ? record.baseId
      : isPersonaId(record.id)
        ? record.id
        : "price_hunter"
  const template = defaultPersonaById(baseId)
  if (!template) return null
  const colors = Array.isArray(traits.colorPreference)
    ? traits.colorPreference.filter(isStoreColor)
    : template.traits.colorPreference
  return {
    id: record.id,
    name: record.name,
    baseId,
    isCustom: record.isCustom === true || !isPersonaId(record.id),
    traits: {
      menShare: shareOr(traits.menShare, menShareFromLegacy(traits, template.traits.menShare)),
      saleShare: shareOr(traits.saleShare, numberOr(traits.priceSensitivity, template.traits.saleShare)),
      newShare: shareOr(traits.newShare, numberOr(traits.noveltySeeking, template.traits.newShare)),
      priceLevel: shareOr(traits.priceLevel, priceLevelFromBudget(traits.maxBudget, template.traits.priceLevel)),
      colorPreference: colors,
      basketSize: basketOr(traits.basketSize, template.traits.basketSize),
    },
  }
}

export const usePersonaStore = create<PersonaState>((set, get) => ({
  personas: cloneList(DEFAULT_PERSONAS),
  selectedId: "price_hunter",
  select: (id) => set({ selectedId: id }),
  updateTraits: (id, patch) =>
    set((state) => ({
      personas: state.personas.map((persona) =>
        persona.id === id
          ? {
              ...persona,
              traits: {
                ...persona.traits,
                ...patch,
                colorPreference:
                  patch.colorPreference !== undefined
                    ? [...patch.colorPreference]
                    : persona.traits.colorPreference,
              },
            }
          : persona,
      ),
    })),
  rename: (id, name) =>
    set((state) => ({
      personas: state.personas.map((persona) => (persona.id === id ? { ...persona, name } : persona)),
    })),
  reset: () => set({ personas: cloneList(DEFAULT_PERSONAS), selectedId: "price_hunter" }),
  resetOne: (id) =>
    set((state) => {
      const fresh = defaultPersonaById(id)
      if (!fresh) {
        return {
          personas: state.personas.filter((persona) => persona.id !== id),
          selectedId: state.selectedId === id ? "price_hunter" : state.selectedId,
        }
      }
      return {
        personas: state.personas.map((persona) => (persona.id === id ? fresh : persona)),
      }
    }),
  duplicate: (id) => {
    const source = get().personas.find((persona) => persona.id === id)
    if (!source) return null
    const copy = clonePersona(source)
    copy.id = `${source.baseId}-copy-${Date.now().toString(36)}`
    copy.name = `${source.name} copy`
    copy.isCustom = true
    set((state) => ({ personas: [...state.personas, copy], selectedId: copy.id }))
    return copy.id
  },
  exportPersona: (id) => {
    const persona = get().personas.find((item) => item.id === id)
    return JSON.stringify(persona ?? null, null, 2)
  },
  importPersona: (raw) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return { ok: false, error: "That is not valid JSON." }
    }
    const persona = asPersona(parsed)
    if (!persona) return { ok: false, error: "JSON is missing persona id, name, or traits." }
    persona.isCustom = true
    if (get().personas.some((item) => item.id === persona.id)) {
      persona.id = `${persona.id}-import-${Date.now().toString(36)}`
    }
    if (!persona.name) persona.name = PERSONA_LABEL[persona.baseId]
    set((state) => ({ personas: [...state.personas, persona], selectedId: persona.id }))
    return { ok: true, id: persona.id }
  },
}))
