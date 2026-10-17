"use client"

import { create } from "zustand"
import type { PersonaId } from "@/lib/personas/schema"
import { emptyScores } from "@/lib/sim/evidence"

export type SimStatus = "idle" | "running" | "paused" | "finished"
export type SimSpeed = 0.5 | 1 | 2 | 4
export type AspectChoice = "wide" | "classic"

export interface InferenceView {
  personaId: PersonaId | null
  probabilities: Record<PersonaId, number>
  classified: boolean
  eventCount: number
}

interface SimState {
  status: SimStatus
  speed: SimSpeed
  seed: number
  adaptive: boolean
  route: string
  showElementIds: boolean
  aspect: AspectChoice
  activePersonaId: string | null
  inference: InferenceView
  iframe: HTMLIFrameElement | null
  setStatus: (status: SimStatus) => void
  setSpeed: (speed: SimSpeed) => void
  setSeed: (seed: number) => void
  setAdaptive: (adaptive: boolean) => void
  setRoute: (route: string) => void
  setShowElementIds: (show: boolean) => void
  setAspect: (aspect: AspectChoice) => void
  setActivePersonaId: (id: string | null) => void
  setInference: (inference: InferenceView) => void
  setIframe: (iframe: HTMLIFrameElement | null) => void
}

export function isSimSpeed(value: number): value is SimSpeed {
  return value === 0.5 || value === 1 || value === 2 || value === 4
}

export const useSimStore = create<SimState>((set) => ({
  status: "idle",
  speed: 1,
  seed: 42,
  adaptive: true,
  route: "/store",
  showElementIds: false,
  aspect: "wide",
  activePersonaId: null,
  inference: {
    personaId: null,
    probabilities: emptyScores(),
    classified: false,
    eventCount: 0,
  },
  iframe: null,
  setStatus: (status) => set({ status }),
  setSpeed: (speed) => set({ speed }),
  setSeed: (seed) => set({ seed }),
  setAdaptive: (adaptive) => set({ adaptive }),
  setRoute: (route) => set({ route }),
  setShowElementIds: (show) => set({ showElementIds: show }),
  setAspect: (aspect) => set({ aspect }),
  setActivePersonaId: (id) => set({ activePersonaId: id }),
  setInference: (inference) => set({ inference }),
  setIframe: (iframe) => set({ iframe }),
}))
