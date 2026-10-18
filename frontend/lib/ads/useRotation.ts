"use client"

import { useEffect, useState } from "react"

/** Index into a carousel of `count` items, advancing every `ms`. Resets when `key` changes. */
export function useRotation(count: number, key: string, ms = 5000): [number, (index: number) => void] {
  const [state, setState] = useState({ key, index: 0 })
  const index = state.key === key && state.index < count ? state.index : 0
  useEffect(() => {
    if (count < 2) return
    const timer = window.setInterval(() => {
      setState((current) => ({ key, index: ((current.key === key ? current.index : 0) + 1) % count }))
    }, ms)
    return () => window.clearInterval(timer)
  }, [count, key, ms])
  return [index, (next: number) => setState({ key, index: next })]
}
