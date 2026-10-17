"use client"

import { useEffect, useRef, useState } from "react"
import { LOG_COLORS, UI_CONFIG } from "@/config/ui"
import { formatClock } from "@/lib/utils"
import { runner } from "@/lib/sim/runner"
import { useLogStore } from "@/lib/state/logStore"
import { useSimStore } from "@/lib/state/simStore"

export function Terminal() {
  const lines = useLogStore((state) => state.lines)
  const origin = useLogStore((state) => state.origin)
  const speed = useSimStore((state) => state.speed)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState("")
  const [typed, setTyped] = useState(lines.length)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [lines.length, typed])

  useEffect(() => {
    if (speed !== UI_CONFIG.typewriterMaxSpeed) {
      setTyped(lines.length)
      return
    }
    if (lines.length === 0) {
      setTyped(0)
      return
    }
    setTyped(lines.length - 1)
    const last = lines[lines.length - 1]
    if (!last) return
    let index = 0
    const timer = window.setInterval(() => {
      index += 2
      if (index >= last.message.length) {
        window.clearInterval(timer)
        setTyped(lines.length)
      } else {
        setTyped(lines.length - 1 + index / Math.max(last.message.length, 1))
      }
    }, 16)
    return () => window.clearInterval(timer)
  }, [lines, speed])

  const revealCount = speed === 1 ? Math.floor(typed) : lines.length

  return (
    <div className="flex h-full min-h-28 flex-col bg-black/40 font-mono text-[11px]">
      <div className="min-h-0 flex-1 overflow-auto px-2 py-1">
        {lines.slice(0, revealCount).map((line) => (
          <div key={line.id} className="flex gap-2 leading-5">
            <span className="text-white/30">{formatClock(line.ts - origin)}</span>
            <span style={{ color: LOG_COLORS[line.source] }}>[{line.source}]</span>
            <span className="text-white/90">{line.message}</span>
          </div>
        ))}
        {speed === 1 && lines.length > revealCount ? (
          <div className="flex gap-2 leading-5">
            <span className="text-white/30">{formatClock((lines[revealCount]?.ts ?? origin) - origin)}</span>
            <span style={{ color: LOG_COLORS[lines[revealCount]?.source ?? "sim"] }}>
              [{lines[revealCount]?.source}]
            </span>
            <span className="text-white/90">
              {(lines[revealCount]?.message ?? "").slice(
                0,
                Math.floor(((typed % 1) || 1) * (lines[revealCount]?.message.length ?? 0)),
              )}
            </span>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
      <form
        className="flex border-t border-white/10"
        onSubmit={(event) => {
          event.preventDefault()
          runner.command(draft)
          setDraft("")
        }}
      >
        <span className="px-2 py-1 text-white/40">atelier-sim $</span>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-1 text-white outline-none"
          aria-label="Simulator command"
        />
      </form>
    </div>
  )
}
