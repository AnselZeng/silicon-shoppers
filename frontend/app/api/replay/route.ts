// GET /api/replay?userId=...&events=200  ->  { events: ReplayEvent[], layouts: ReplayLayout[] }
// Reads back what the store wrote: the shopper's EVENTS rows and every layout version in
// USER_LAYOUTS_HISTORY, oldest first. The shell's `replay` command prints them as one timeline.
import { NextResponse } from "next/server"
import { snowflakeEnabled, sql } from "@/lib/server/snowflake"
import type { ReplayEvent, ReplayLayout } from "@/lib/sim/replay"

// Cache Components: route handlers run on the Node.js runtime and at request time by default.

const ID = /^[A-Za-z0-9_.:-]{1,80}$/
const MAX_EVENTS = 500
const MAX_LAYOUTS = 30
const TS = "YYYY-MM-DD HH24:MI:SS.FF3"

function parse(v: unknown): unknown {
  return typeof v === "string" ? JSON.parse(v) : (v ?? null)
}

/** Snowflake rows come back uppercase or lowercase depending on the driver. */
function cell(row: Record<string, unknown>, name: string): unknown {
  if (name in row) return row[name]
  const found = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase())
  return found ? row[found] : undefined
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams
  const userId = params.get("userId") ?? ""
  if (!snowflakeEnabled()) return NextResponse.json({ events: [], layouts: [], disabled: true })
  if (!ID.test(userId)) return NextResponse.json({ error: "bad userId" }, { status: 400 })
  const wanted = Number(params.get("events") ?? 200)
  const limit = Number.isFinite(wanted) ? Math.min(Math.max(Math.trunc(wanted), 1), MAX_EVENTS) : 200
  try {
    const [eventRows, layoutRows] = await Promise.all([
      sql<Record<string, unknown>>(
        `SELECT TYPE, TO_VARCHAR(TS, '${TS}') AS TS, PROPERTIES FROM EVENTS WHERE USER_ID = ? ORDER BY TS DESC LIMIT ${limit}`,
        [userId],
      ),
      sql<Record<string, unknown>>(
        `SELECT TO_VARCHAR(UPDATED_AT, '${TS}') AS TS, RUN_ID, N_EVENTS, HOMEPAGE FROM USER_LAYOUTS_HISTORY
         WHERE USER_ID = ? ORDER BY UPDATED_AT DESC LIMIT ${MAX_LAYOUTS}`,
        [userId],
      ),
    ])
    const events: ReplayEvent[] = eventRows.reverse().map((row) => ({
      ts: String(cell(row, "TS")),
      type: String(cell(row, "TYPE")),
      properties: (parse(cell(row, "PROPERTIES")) ?? {}) as ReplayEvent["properties"],
    }))
    const layouts: ReplayLayout[] = layoutRows.reverse().map((row) => {
      const doc = (parse(cell(row, "HOMEPAGE")) ?? {}) as {
        shopper?: { persona?: { name?: string } | null; confidence?: string }
        layout?: Record<string, { value?: unknown }>
      }
      return {
        ts: String(cell(row, "TS")),
        runId: String(cell(row, "RUN_ID") ?? ""),
        nEvents: Number(cell(row, "N_EVENTS") ?? 0),
        persona: doc.shopper?.persona?.name ?? null,
        confidence: doc.shopper?.confidence ?? null,
        decisions: Object.fromEntries(Object.entries(doc.layout ?? {}).map(([key, d]) => [key, d?.value ?? null])),
      }
    })
    return NextResponse.json({ events, layouts })
  } catch (err) {
    console.error("replay read failed", err)
    return NextResponse.json({ events: [], layouts: [], error: "read failed" }, { status: 502 })
  }
}
