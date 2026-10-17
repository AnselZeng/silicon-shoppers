"use client"

import { useEffect, useRef } from "react"
import { UI_CONFIG } from "@/config/ui"
import { BrowserChrome } from "@/components/shell/BrowserChrome"
import { postSimMessage } from "@/lib/sim/protocol"
import { useSimStore, type AspectChoice } from "@/lib/state/simStore"

export function DemoScreen() {
  const aspect = useSimStore((state) => state.aspect)
  const setAspect = useSimStore((state) => state.setAspect)
  const showElementIds = useSimStore((state) => state.showElementIds)
  const setShow = useSimStore((state) => state.setShowElementIds)
  const setIframe = useSimStore((state) => state.setIframe)
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    setIframe(frameRef.current)
    return () => setIframe(null)
  }, [setIframe])

  function toggleIds() {
    const next = !showElementIds
    setShow(next)
    const frame = frameRef.current?.contentWindow
    if (frame) postSimMessage(frame, { type: "set_debug", showElementIds: next })
  }

  return (
    <div className="flex h-full flex-col bg-[#111113]">
      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-white/70">
        <span className="tracking-[0.16em] uppercase">Screen</span>
        {(["wide", "classic"] as AspectChoice[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setAspect(key)}
            className={`border px-2 py-1 ${aspect === key ? "border-white text-white" : "border-white/20"}`}
          >
            {key === "wide" ? "16:10" : "4:3"}
          </button>
        ))}
        <button type="button" onClick={toggleIds} className="ml-auto border border-white/20 px-2 py-1">
          {showElementIds ? "Hide IDs" : "Show IDs"}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-3 pb-3">
        <div
          className="flex h-full max-w-full flex-col overflow-hidden border border-white/10 bg-white shadow-2xl"
          style={{ aspectRatio: UI_CONFIG.demoAspectRatios[aspect], width: "auto", maxHeight: "100%" }}
        >
          <BrowserChrome />
          <iframe ref={frameRef} title="ATELIER NINE" src="/store" className="h-full w-full flex-1 bg-white" />
        </div>
      </div>
    </div>
  )
}
