"use client"

import { useStorefront } from "@/lib/store/storeState"
import { cn } from "@/lib/utils"

const TAG_POSITION = {
  inside: "top-2 left-2",
  below: "top-full left-0 mt-1",
  right: "top-1/2 left-full ml-3 -translate-y-1/2",
} as const

/**
 * Box and tag on a block a layout step is changing ("Moving up", "New"). It appears before
 * the change and has its own view-transition name, so it stays on top and travels with
 * the block while the change plays. The parent must be relative.
 */
export function LayoutFlash({
  name,
  className,
  tag: position = "inside",
}: {
  name: string
  className?: string
  tag?: keyof typeof TAG_POSITION
}) {
  const tag = useStorefront((state) => state.layoutFlash.names[name])
  const leaving = useStorefront((state) => state.layoutFlash.leaving)
  if (!tag) return null
  return (
    <span
      aria-hidden
      className={cn("layout-flash pointer-events-none absolute inset-0 z-10", leaving && "is-leaving", className)}
      style={{ viewTransitionName: `flash-${name}` }}
    >
      <span className={cn("layout-flash-tag", TAG_POSITION[position])}>{tag}</span>
    </span>
  )
}
