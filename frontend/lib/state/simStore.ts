"use client"

import { create } from "zustand"
import type { Preview } from "@/lib/layout/preview"
import type { FixtureEntry } from "@/lib/model/fixtures"

export type ViewportChoice = "web" | "tablet" | "mobile"

interface SimState {
  route: string
  viewport: ViewportChoice
  layoutPreview: string
  preview: Preview | null
  fixtures: FixtureEntry[]
  iframe: HTMLIFrameElement | null
  /** Stage of the layout swap playing in the store, or null when it has settled. */
  layoutProgress: { index: number; total: number } | null
  /** Bumped when the store reports a Snowflake layout, so the panel refetches it. */
  liveRevision: number
  /** True while a Run waits for the LLM's layout. */
  llmPending: boolean
  /** What the LLM has written so far on the current Run, as it streams in. */
  llmText: string
  setRoute: (route: string) => void
  setViewport: (viewport: ViewportChoice) => void
  setLayoutPreview: (preview: string) => void
  setPreview: (preview: Preview | null) => void
  setFixtures: (fixtures: FixtureEntry[]) => void
  setIframe: (iframe: HTMLIFrameElement | null) => void
  setLayoutProgress: (progress: { index: number; total: number } | null) => void
  noteLive: () => void
  setLlmPending: (pending: boolean) => void
  setLlmText: (text: string) => void
}

export const useSimStore = create<SimState>((set) => ({
  route: "/store",
  viewport: "web",
  layoutPreview: "default",
  preview: null,
  fixtures: [],
  iframe: null,
  layoutProgress: null,
  liveRevision: 0,
  llmPending: false,
  llmText: "",
  setRoute: (route) => set({ route }),
  setViewport: (viewport) => set({ viewport }),
  setLayoutPreview: (layoutPreview) => set({ layoutPreview }),
  setPreview: (preview) => set({ preview }),
  setFixtures: (fixtures) => set({ fixtures }),
  setIframe: (iframe) => set({ iframe }),
  setLayoutProgress: (layoutProgress) => set({ layoutProgress }),
  noteLive: () => set((state) => ({ liveRevision: state.liveRevision + 1 })),
  setLlmPending: (llmPending) => set({ llmPending }),
  setLlmText: (llmText) => set({ llmText }),
}))
