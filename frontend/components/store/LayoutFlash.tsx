"use client"

import { useStorefront } from "@/lib/store/storeState"
import { cn } from "@/lib/utils"

/**
 * Outline and tag drawn over a block the last layout step changed ("New", "Moved up").
 * Keyed by the step nonce so the fade restarts on every step. The parent must be relative.
 */
export function LayoutFlash({ name, className, tagBelow = false }: { name: string; className?: string; tagBelow?: boolean }) {
  const tag = useStorefront((state) => state.layoutFlash.names[name])
  const nonce = useStorefront((state) => state.layoutFlash.nonce)
  if (!tag) return null
  return (
    <span key={nonce} aria-hidden className={cn("layout-flash pointer-events-none absolute inset-0 z-10", className)}>
      <span className={cn("layout-flash-tag", tagBelow ? "top-full left-0 mt-1" : "top-2 left-2")}>{tag}</span>
    </span>
  )
}
