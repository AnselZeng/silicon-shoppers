"use client"

import { useLogStore } from "@/lib/state/logStore"
import { useObsStore } from "@/lib/state/obsStore"

export function hasSentryDsn(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN)
}

export function withSpan<T>(
  name: string,
  fn: () => T,
  data?: Record<string, string | number | boolean>,
): T {
  const id = useObsStore.getState().startSpan(name, data)
  if (!hasSentryDsn() && (name === "layout.apply" || name.startsWith("visa."))) {
    useLogStore.getState().push("sentry", `local stub · span ${name}`)
  }
  try {
    const result = fn()
    useObsStore.getState().endSpan(id, "ok")
    return result
  } catch (error) {
    useObsStore.getState().endSpan(id, "error")
    throw error
  }
}
