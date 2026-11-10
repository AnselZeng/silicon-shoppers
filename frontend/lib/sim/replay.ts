// Session replay: a shopper's stored events and every layout version the refresh loop wrote
// for them, merged into one timeline. The terminal's `replay` command prints it.

import type { LogSource } from "@/config/ui"
import { describeStoreEvent } from "@/lib/sim/tracker"
import type { EventValue, StoreEventType } from "@/lib/sim/protocol"

/** One row of EVENTS. `ts` is "YYYY-MM-DD HH:MM:SS.mmm" (UTC). */
export interface ReplayEvent {
  ts: string
  type: string
  properties: Record<string, EventValue>
}

/** One row of USER_LAYOUTS_HISTORY, reduced to what a reader needs. */
export interface ReplayLayout {
  ts: string
  runId: string
  nEvents: number
  persona: string | null
  confidence: string | null
  /** Layout decision key -> its value in this version. */
  decisions: Record<string, unknown>
}

export interface ReplayLine {
  ts: string
  source: LogSource
  message: string
}

const MAX_CHANGES = 4

function show(value: unknown): string {
  if (Array.isArray(value)) return value.slice(0, 3).join("/")
  if (value === null || value === undefined) return "none"
  return typeof value === "object" ? JSON.stringify(value) : String(value)
}

/** Decisions whose value differs from the previous version, as "key value -> value". */
export function layoutChanges(before: ReplayLayout | null, after: ReplayLayout): string[] {
  if (!before) return []
  return Object.keys(after.decisions)
    .filter((key) => JSON.stringify(after.decisions[key]) !== JSON.stringify(before.decisions[key]))
    .map((key) => `${key} ${show(before.decisions[key])} -> ${show(after.decisions[key])}`)
}

/** Events and layout versions in time order. A layout written at the same instant follows its events. */
export function replayLines(events: ReplayEvent[], layouts: ReplayLayout[]): ReplayLine[] {
  const lines: (ReplayLine & { order: number })[] = events.map((event) => ({
    ts: event.ts,
    source: event.type.startsWith("concierge_") ? "llm" : "tracker",
    message: describeStoreEvent({
      type: event.type as StoreEventType,
      timestamp: 0,
      route: "",
      properties: event.properties,
    }),
    order: 0,
  }))
  layouts.forEach((layout, index) => {
    const who = layout.persona ? `${layout.persona} (${layout.confidence ?? "low"})` : "no persona yet"
    const changes = layoutChanges(index > 0 ? layouts[index - 1] : null, layout)
    const more = changes.length > MAX_CHANGES ? ` +${changes.length - MAX_CHANGES} more` : ""
    const detail =
      index === 0 ? "first layout" : changes.length ? `${changes.slice(0, MAX_CHANGES).join(" | ")}${more}` : "no decision changed"
    lines.push({
      ts: layout.ts,
      source: "layout",
      message: `layout v${index + 1} · ${who} · ${layout.nEvents} events seen · ${detail}`,
      order: 1,
    })
  })
  return lines
    .sort((a, b) => a.ts.localeCompare(b.ts) || a.order - b.order)
    .map(({ ts, source, message }) => ({ ts, source, message }))
}
