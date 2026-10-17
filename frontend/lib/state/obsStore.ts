"use client"

import { create } from "zustand"

export interface ObsCrumb {
  id: string
  ts: number
  type: string
  message: string
}

export interface ObsSpan {
  id: string
  name: string
  startTs: number
  endTs?: number
  status: "running" | "ok" | "error"
  data?: Record<string, string | number | boolean>
}

export interface ObsNote {
  id: string
  ts: number
  message: string
}

interface ObsState {
  crumbs: ObsCrumb[]
  spans: ObsSpan[]
  notes: ObsNote[]
  runId: string | null
  personaId: string | null
  seed: number | null
  addCrumb: (type: string, message: string) => void
  startSpan: (name: string, data?: ObsSpan["data"]) => string
  endSpan: (id: string, status: "ok" | "error") => void
  note: (message: string) => void
  setContext: (ctx: { runId: string; personaId: string; seed: number }) => void
  clear: () => void
}

let seq = 1
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

export const useObsStore = create<ObsState>((set) => ({
  crumbs: [],
  spans: [],
  notes: [],
  runId: null,
  personaId: null,
  seed: null,
  addCrumb: (type, message) =>
    set((state) => ({
      crumbs: [...state.crumbs, { id: nextId("crumb"), ts: Date.now(), type, message }].slice(-200),
    })),
  startSpan: (name, data) => {
    const id = nextId("span")
    set((state) => ({
      spans: [...state.spans, { id, name, startTs: Date.now(), status: "running", data }],
    }))
    return id
  },
  endSpan: (id, status) =>
    set((state) => ({
      spans: state.spans.map((span) =>
        span.id === id ? { ...span, status, endTs: Date.now() } : span,
      ),
    })),
  note: (message) =>
    set((state) => ({
      notes: [...state.notes, { id: nextId("note"), ts: Date.now(), message }].slice(-200),
    })),
  setContext: (ctx) => set({ runId: ctx.runId, personaId: ctx.personaId, seed: ctx.seed }),
  clear: () => set({ crumbs: [], spans: [], notes: [], runId: null, personaId: null, seed: null }),
}))
