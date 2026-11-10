// GET /api/prefs?userId=...  ->  { statements: string[] }   oldest first
// What this shopper told the concierge on earlier visits ("more men friendly", "navy first"),
// read back from their concierge_layout events so the store re-applies it on the next visit.
import { NextResponse } from "next/server"
import { statementsFrom, type StatementEvent } from "@/lib/model/statements"
import { snowflakeEnabled, sql } from "@/lib/server/snowflake"

// Cache Components: route handlers run on the Node.js runtime and at request time by default.

const ID = /^[A-Za-z0-9_.:-]{1,80}$/
const MAX_EVENTS = 40

/** Snowflake rows come back uppercase or lowercase depending on the driver. */
function cell(row: Record<string, unknown>, name: string): unknown {
  if (name in row) return row[name]
  const found = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase())
  return found ? row[found] : undefined
}

export async function GET(req: Request) {
  const userId = new URL(req.url).searchParams.get("userId") ?? ""
  if (!snowflakeEnabled()) return NextResponse.json({ statements: [], disabled: true })
  if (!ID.test(userId)) return NextResponse.json({ error: "bad userId" }, { status: 400 })
  try {
    const rows = await sql<Record<string, unknown>>(
      `SELECT PROPERTIES FROM EVENTS WHERE USER_ID = ? AND TYPE = 'concierge_layout' ORDER BY TS DESC LIMIT ${MAX_EVENTS}`,
      [userId],
    )
    const events = rows
      .map((row) => {
        const value = cell(row, "PROPERTIES")
        return (typeof value === "string" ? JSON.parse(value) : (value ?? {})) as StatementEvent
      })
      .reverse()
    return NextResponse.json({ statements: statementsFrom(events) })
  } catch (err) {
    console.error("prefs read failed", err)
    return NextResponse.json({ statements: [], error: "read failed" }, { status: 502 })
  }
}
