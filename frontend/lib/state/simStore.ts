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
  setRoute: (route: string) => void
  setViewport: (viewport: ViewportChoice) => void
  setLayoutPreview: (preview: string) => void
  setPreview: (preview: Preview | null) => void
  setFixtures: (fixtures: FixtureEntry[]) => void
  setIframe: (iframe: HTMLIFrameElement | null) => void
  setLayoutProgress: (progress: { index: number; total: number } | null) => void
}

export const useSimStore = create<SimState>((set) => ({
  route: "/store",
  viewport: "web",
  layoutPreview: "default",
  preview: null,
  fixtures: [],
  iframe: null,
  layoutProgress: null,
  setRoute: (route) => set({ route }),
  setViewport: (viewport) => set({ viewport }),
  setLayoutPreview: (layoutPreview) => set({ layoutPreview }),
  setPreview: (preview) => set({ preview }),
  setFixtures: (fixtures) => set({ fixtures }),
  setIframe: (iframe) => set({ iframe }),
  setLayoutProgress: (layoutProgress) => set({ layoutProgress }),
}))
