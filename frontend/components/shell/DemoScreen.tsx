"use client"

import { useEffect, useRef, useState } from "react"
import { UI_CONFIG } from "@/config/ui"
import { BrowserChrome } from "@/components/shell/BrowserChrome"
import { useSimStore, type ViewportChoice } from "@/lib/state/simStore"

const VIEWS: { id: ViewportChoice; label: string }[] = [
  { id: "web", label: "Web" },
  { id: "mobile", label: "Mobile" },
]

export function DemoScreen() {
  const viewport = useSimStore((state) => state.viewport)
  const setViewport = useSimStore((state) => state.setViewport)
  const setIframe = useSimStore((state) => state.setIframe)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const web = UI_CONFIG.demoViewports.web

  useEffect(() => {
    setIframe(frameRef.current)
    return () => setIframe(null)
  }, [setIframe, viewport])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = () => {
      const style = getComputedStyle(stage)
      const availW = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const availH = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      const next = Math.min(1, availW / web.width, availH / web.height)
      setScale(Number.isFinite(next) && next > 0 ? next : 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [web.width, web.height])

  return (
    <div className="flex h-full flex-col bg-[#141416]">
      <div className="flex items-center gap-2 px-4 py-2 text-[11px] text-white/70">
        <span className="tracking-[0.16em] uppercase">Screen</span>
        {VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => setViewport(view.id)}
            className={`border px-2 py-1 ${viewport === view.id ? "border-white text-white" : "border-white/20"}`}
          >
            {view.label}
          </button>
        ))}
      </div>
      <div ref={stageRef} className="flex min-h-0 w-full min-w-0 flex-1 items-center justify-center overflow-hidden px-6 py-5">
        {viewport === "web" ? (
          <div style={{ width: web.width * scale, height: web.height * scale }}>
            <div
              className="flex origin-top-left flex-col overflow-hidden rounded-xl bg-white shadow-[0_28px_80px_rgba(0,0,0,0.55)] ring-1 ring-black/50"
              style={{ width: web.width, height: web.height, transform: `scale(${scale})` }}
            >
              <BrowserChrome mode="web" />
              <iframe ref={frameRef} title="ATELIER NINE" src="/store" className="min-h-0 w-full flex-1 bg-white" />
            </div>
          </div>
        ) : (
          <div className="flex h-[min(844px,100%)] w-[min(402px,100%)] min-w-0 flex-col rounded-[2.5rem] bg-[#1c1c1e] p-[10px] shadow-[0_28px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/15">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] bg-white">
              <BrowserChrome mode="mobile" />
              <iframe ref={frameRef} title="ATELIER NINE" src="/store" className="min-h-0 w-full min-w-0 flex-1 bg-white" />
              <div className="flex h-5 shrink-0 items-center justify-center bg-[#f4f1ea]">
                <span className="h-1 w-28 rounded-full bg-neutral-900/80" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
