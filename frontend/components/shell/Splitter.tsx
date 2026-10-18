"use client"

import { useCallback, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react"

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Sizes set this visit; also the only copy when storage is blocked. */
const memory = new Map<string, number>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function readStored(key: string, fallback: number): number {
  const set = memory.get(key)
  if (set !== undefined) return set
  try {
    const value = Number(window.localStorage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : fallback
  } catch {
    return fallback
  }
}

/**
 * A size remembered per browser. The server render and first paint use `initial`, then the stored
 * size applies. Falls back to `initial` when storage is empty or blocked.
 */
export function useStoredSize(key: string, initial: number) {
  const size = useSyncExternalStore(
    subscribe,
    () => readStored(key, initial),
    () => initial,
  )
  const save = useCallback(
    (next: number) => {
      memory.set(key, next)
      try {
        window.localStorage.setItem(key, String(next))
      } catch {
        // storage blocked: the size still applies for this visit
      }
      listeners.forEach((listener) => listener())
    },
    [key],
  )
  return [size, save] as const
}

/**
 * A drag handle between two panes. `axis="x"` is a vertical bar that resizes widths, `axis="y"` a
 * horizontal bar that resizes heights. The parent owns the size; this reports the new one in the
 * same unit, from the pointer's movement in px times `unitPerPx`.
 * Pointer capture keeps the drag going over the store iframe. Double-click resets, arrows nudge.
 */
export function Splitter({
  axis,
  size,
  min,
  max,
  initial,
  unitPerPx = () => 1,
  invert = false,
  step = 1,
  label,
  onChange,
}: {
  axis: "x" | "y"
  size: number
  min: number
  max: number
  initial: number
  /** How many size units one px of pointer movement is worth (e.g. 100 / container width for %). */
  unitPerPx?: () => number
  /** True when dragging toward the end shrinks the pane (a pane below or right of the bar). */
  invert?: boolean
  step?: number
  label: string
  onChange: (size: number) => void
}) {
  const drag = useRef<{ start: number; size: number; perPx: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const position = (event: PointerEvent) => (axis === "x" ? event.clientX : event.clientY)

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { start: position(event), size, perPx: unitPerPx() }
    setDragging(true)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current) return
    const delta = (position(event) - current.start) * current.perPx * (invert ? -1 : 1)
    onChange(clamp(current.size + delta, min, max))
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    drag.current = null
    setDragging(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const back = axis === "x" ? "ArrowLeft" : "ArrowUp"
    const forward = axis === "x" ? "ArrowRight" : "ArrowDown"
    if (event.key !== back && event.key !== forward) return
    event.preventDefault()
    const direction = (event.key === forward ? 1 : -1) * (invert ? -1 : 1)
    onChange(clamp(size + direction * step, min, max))
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(size)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onChange(clamp(initial, min, max))}
      onKeyDown={onKeyDown}
      className={`group relative z-10 shrink-0 touch-none outline-none select-none ${
        axis === "x" ? "-mx-1 w-2 cursor-col-resize" : "-my-1 h-2 cursor-row-resize"
      }`}
    >
      <span
        className={`absolute bg-white/10 transition-colors group-hover:bg-white/40 group-focus-visible:bg-white/60 ${
          dragging ? "bg-white/60" : ""
        } ${axis === "x" ? "inset-y-0 left-1/2 w-px -translate-x-1/2" : "inset-x-0 top-1/2 h-px -translate-y-1/2"}`}
      />
    </div>
  )
}
