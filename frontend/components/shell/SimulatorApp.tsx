"use client"

import { useEffect } from "react"
import { UI_CONFIG } from "@/config/ui"
import { DemoScreen } from "@/components/shell/DemoScreen"
import { PersonaPanel } from "@/components/shell/PersonaPanel"
import { PipelineLog } from "@/components/shell/PipelineLog"
import { runner } from "@/lib/sim/runner"

export function SimulatorApp() {
  useEffect(() => {
    const onMessage = (event: MessageEvent) => runner.handleMessage(event)
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  return (
    <>
      <div className="flex min-h-screen items-center justify-center bg-[#0c0c0d] px-6 text-center text-white min-[1280px]:hidden">
        <div className="max-w-sm">
          <p className="text-[10px] tracking-[0.28em] text-white/50 uppercase">Atelier Nine</p>
          <h1 className="mt-3 font-serif text-3xl">Best viewed on desktop</h1>
          <p className="mt-3 text-sm text-white/70">
            The demo shell needs at least {UI_CONFIG.minWidthPx}px. The store itself still opens on its own.
          </p>
          <a href="/store" className="mt-6 inline-block text-sm underline">
            Open the store
          </a>
        </div>
      </div>
      <div className="dark hidden h-screen min-w-[1280px] bg-[#0c0c0d] text-white min-[1280px]:flex">
        <div className="flex h-full w-[35%] min-w-0 flex-col border-r border-white/10">
          <div className="h-[55%] min-h-0 overflow-hidden">
            <PersonaPanel />
          </div>
          <div className="h-[45%] min-h-0 overflow-hidden border-t border-white/10">
            <PipelineLog />
          </div>
        </div>
        <div className="h-full w-[65%] min-w-0">
          <DemoScreen />
        </div>
      </div>
    </>
  )
}
