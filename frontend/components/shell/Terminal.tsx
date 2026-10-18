"use client"

import { useEffect, useRef, useState } from "react"
import { LOG_COLORS } from "@/config/ui"
import { formatClock } from "@/lib/utils"
import { runner } from "@/lib/sim/runner"
import { useLogStore } from "@/lib/state/logStore"

export function Terminal() {
  const lines = useLogStore((state) => state.lines)
  const origin = useLogStore((state) => state.origin)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState("")

  // Scroll only the log itself; scrollIntoView would also scroll the clipped panes around it.
  useEffect(() => {
    const box = scrollRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [lines.length])

  return (
    <div className="flex h-full min-h-0 flex-col bg-black/40 font-mono text-[11px]">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-2 py-1">
        {lines.map((line) => (
          <div key={line.id} className="flex gap-2 leading-5">
            <span className="text-white/30">{formatClock(line.ts - origin)}</span>
            <span style={{ color: LOG_COLORS[line.source] }}>[{line.source}]</span>
            <span className="text-white/90">{line.message}</span>
          </div>
        ))}
      </div>
      <form
        className="flex border-t border-white/10"
        onSubmit={(event) => {
          event.preventDefault()
          runner.command(draft)
          setDraft("")
        }}
      >
        <span className="px-2 py-1 text-white/40">socal $</span>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          suppressHydrationWarning
          className="min-w-0 flex-1 bg-transparent py-1 text-white outline-none"
          aria-label="Shell command"
        />
      </form>
    </div>
  )
}
