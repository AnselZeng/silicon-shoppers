"use client"

import { useEffect, useState } from "react"
import { UI_CONFIG } from "@/config/ui"
import { useStorefront } from "@/lib/store/storeState"

export function GhostCursor() {
  const cursor = useStorefront((state) => state.cursor)
  const speed = useStorefront((state) => state.cursorSpeed)
  const [framed, setFramed] = useState(false)
  useEffect(() => {
    setFramed(window.parent !== window)
  }, [])
  if (!framed || !cursor.visible) return null
  const ms = UI_CONFIG.cursorBaseMs / Math.max(speed, 0.5)
  return (
    <div
      className="pointer-events-none fixed z-[80]"
      style={{
        left: cursor.x,
        top: cursor.y,
        transition: `left ${ms}ms cubic-bezier(.2,.7,.2,1), top ${ms}ms cubic-bezier(.2,.7,.2,1)`,
      }}
    >
      <svg width="22" height="22" viewBox="0 0 22 22" style={{ transform: "translate(-2px, -2px)" }}>
        <path d="M2 2 L2 18 L7 13 L11 20 L14 19 L10 12 L18 12 Z" fill={cursor.color} stroke="#0c0c0d" strokeWidth="1" />
      </svg>
      {cursor.clicking ? (
        <span
          className="absolute top-0 left-0 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{ borderColor: cursor.color }}
        />
      ) : null}
    </div>
  )
}
