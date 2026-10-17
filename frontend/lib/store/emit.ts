import { postSimMessage, type EventValue, type StoreEventType } from "@/lib/sim/protocol"

const recent = new Map<string, number>()
const scrollMarks = new Set<number>()

export function resetEmitDedupe() {
  recent.clear()
  scrollMarks.clear()
}

export function takeScrollMark(percent: number): boolean {
  if (scrollMarks.has(percent)) return false
  scrollMarks.add(percent)
  return true
}

export function emitStoreEvent(
  type: StoreEventType,
  properties: Record<string, EventValue> = {},
) {
  if (typeof window === "undefined") return
  const event = {
    type,
    timestamp: Date.now(),
    route: window.location.pathname,
    properties,
  }
  const key = `${type}:${JSON.stringify(properties)}`
  const now = event.timestamp
  if (now - (recent.get(key) ?? 0) < 350) return
  recent.set(key, now)
  if (window.parent !== window) {
    postSimMessage(window.parent, { type: "store_event", event })
  }
}
