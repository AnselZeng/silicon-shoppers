"use client"

import { create } from "zustand"

export type ViewportChoice = "web" | "mobile"

interface SimState {
  route: string
  viewport: ViewportChoice
  layoutPreview: string
  iframe: HTMLIFrameElement | null
  setRoute: (route: string) => void
  setViewport: (viewport: ViewportChoice) => void
  setLayoutPreview: (preview: string) => void
  setIframe: (iframe: HTMLIFrameElement | null) => void
}

export const useSimStore = create<SimState>((set) => ({
  route: "/store",
  viewport: "web",
  layoutPreview: "default",
  iframe: null,
  setRoute: (route) => set({ route }),
  setViewport: (viewport) => set({ viewport }),
  setLayoutPreview: (layoutPreview) => set({ layoutPreview }),
  setIframe: (iframe) => set({ iframe }),
}))
