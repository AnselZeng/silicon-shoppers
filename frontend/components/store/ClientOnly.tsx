"use client"

import { useSyncExternalStore, type ReactNode } from "react"

const subscribe = () => () => undefined

export function ClientOnly({ children }: { children: ReactNode }) {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  if (!ready) return null
  return children
}
