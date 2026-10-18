"use client"

import { useEffect, useState } from "react"
import type { AdPlacement } from "@/lib/layout/types"
import { useStorefront } from "@/lib/store/storeState"

/**
 * Whether an intrusive placement's trigger has fired. delay, scroll_depth and exit_intent
 * are measured from when the placement arrives (or the page loads); page_count counts
 * page views this session. The interstitial counts listing <-> product moves instead.
 */
export function useAdTrigger(placement: AdPlacement | undefined, armed: boolean): boolean {
  const trigger = placement?.trigger ?? "on_load"
  const value = placement?.triggerValue ?? 0
  const key = `${placement?.slot}:${placement?.adIds.join(",")}:${trigger}:${value}`
  const pagesViewed = useStorefront((state) => state.pagesViewed)
  const transitions = useStorefront((state) => state.transitions)
  const [fired, setFired] = useState<string | null>(null)

  useEffect(() => {
    if (!armed || !placement) return
    if (trigger === "delay") {
      const timer = window.setTimeout(() => setFired(key), value)
      return () => window.clearTimeout(timer)
    }
    if (trigger === "scroll_depth") {
      const check = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight
        const pct = max <= 8 ? 100 : (window.scrollY / max) * 100
        if (pct >= value) setFired(key)
      }
      window.addEventListener("scroll", check, { passive: true })
      return () => window.removeEventListener("scroll", check)
    }
    if (trigger === "exit_intent") {
      const onLeave = (event: MouseEvent) => {
        if (!event.relatedTarget && event.clientY <= 0) setFired(key)
      }
      document.addEventListener("mouseout", onLeave)
      return () => document.removeEventListener("mouseout", onLeave)
    }
  }, [armed, placement, trigger, value, key])

  if (!armed || !placement) return false
  if (placement.slot === "interstitial") return transitions >= (trigger === "page_count" ? value : 1)
  if (trigger === "on_load") return true
  if (trigger === "page_count") return pagesViewed >= value
  return fired === key
}
