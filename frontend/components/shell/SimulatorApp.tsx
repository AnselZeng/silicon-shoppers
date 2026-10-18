"use client"

import { useEffect, useRef } from "react"
import { UI_CONFIG } from "@/config/ui"
import { DemoScreen } from "@/components/shell/DemoScreen"
import { PersonaPanel } from "@/components/shell/PersonaPanel"
import { Splitter, useStoredSize } from "@/components/shell/Splitter"
import { runner } from "@/lib/sim/runner"

const LEFT = { initial: 35, min: 20, max: 60 }

export function SimulatorApp() {
  const shellRef = useRef<HTMLDivElement>(null)
  const [leftPct, setLeftPct] = useStoredSize("shell.leftPct", LEFT.initial)
  useEffect(() => {
    const onMessage = (event: MessageEvent) => runner.handleMessage(event)
    window.addEventListener("message", onMessage)
    void runner.loadFixtures()
    return () => window.removeEventListener("message", onMessage)
  }, [])

  return (
    <>
      <div className="flex min-h-screen items-center justify-center bg-[#0c0c0d] px-6 text-center text-white min-[1280px]:hidden">
        <div className="max-w-sm">
          <p className="text-[10px] tracking-[0.28em] text-white/50 uppercase">SoCal Atelier</p>
          <h1 className="mt-3 font-serif text-3xl">Best viewed on desktop</h1>
          <p className="mt-3 text-sm text-white/70">
            The demo shell needs at least {UI_CONFIG.minWidthPx}px. The store itself still opens on its own.
          </p>
          <a href="/store" className="mt-6 inline-block text-sm underline">
            Open the store
          </a>
        </div>
      </div>
      <div ref={shellRef} className="dark hidden h-screen min-w-[1280px] bg-[#0c0c0d] text-white min-[1280px]:flex">
        <div className="h-full min-w-0 shrink-0 overflow-hidden" style={{ width: `${leftPct}%` }}>
          <PersonaPanel />
        </div>
        <Splitter
          axis="x"
          label="Resize the left panel"
          size={leftPct}
          min={LEFT.min}
          max={LEFT.max}
          initial={LEFT.initial}
          step={2}
          unitPerPx={() => 100 / (shellRef.current?.clientWidth || 1)}
          onChange={setLeftPct}
        />
        <div className="h-full min-w-0 flex-1">
          <DemoScreen />
        </div>
      </div>
    </>
  )
}
