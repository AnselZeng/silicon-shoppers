import type { StoreEvent } from "@/lib/sim/protocol"

export function describeStoreEvent(event: StoreEvent): string {
  const parts = Object.entries(event.properties)
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`)
  const detail = parts.join(" ")
  return detail ? `${event.type} ${detail}` : event.type
}
