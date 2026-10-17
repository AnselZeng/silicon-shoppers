"use client"

import { create } from "zustand"
import { UI_CONFIG } from "@/config/ui"
import type { LogSource } from "@/config/ui"

export interface LogLine {
  id: string
  ts: number
  source: LogSource
  message: string
}

interface LogState {
  lines: LogLine[]
  origin: number
  push: (source: LogSource, message: string) => void
  clear: () => void
  markOrigin: () => void
}

let seq = 1

export const useLogStore = create<LogState>((set) => ({
  lines: [],
  origin: Date.now(),
  push: (source, message) =>
    set((state) => {
      const line: LogLine = { id: `log-${seq}`, ts: Date.now(), source, message }
      seq += 1
      const lines = [...state.lines, line]
      if (lines.length > UI_CONFIG.terminalMaxLines) {
        lines.splice(0, lines.length - UI_CONFIG.terminalMaxLines)
      }
      return { lines }
    }),
  clear: () => set({ lines: [], origin: Date.now() }),
  markOrigin: () => set({ origin: Date.now() }),
}))
