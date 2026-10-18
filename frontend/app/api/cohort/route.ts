// GET /api/cohort -> the four personas and the table sizes the app user can read.
import { NextResponse } from "next/server"
import { snowflakeEnabled, sql } from "@/lib/server/snowflake"

function cell(row: Record<string, unknown>, name: string): unknown {
  if (name in row) return row[name]
  const found = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase())
  return found ? row[found] : undefined
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export async function GET() {
  if (!snowflakeEnabled()) {
    return NextResponse.json({ disabled: true, personas: [], events: 0, layouts: 0, catalog: 0, trending: 0 })
  }
  try {
    const [personas, counts] = await Promise.all([
      sql<Record<string, unknown>>(
        "SELECT PERSONA_ID, NAME, N_MEMBERS_HM, HIGH_CONF_SHARE FROM PERSONAS ORDER BY N_MEMBERS_HM DESC",
      ),
      sql<Record<string, unknown>>(
        `SELECT
           (SELECT COUNT(*) FROM EVENTS) AS EVENTS,
           (SELECT COUNT(*) FROM USER_LAYOUTS) AS LAYOUTS,
           (SELECT COUNT(*) FROM CATALOG) AS CATALOG,
           (SELECT COUNT(*) FROM TRENDING) AS TRENDING`,
      ),
    ])
    const totals = counts[0] ?? {}
    return NextResponse.json({
      personas: personas.map((row) => ({
        id: String(cell(row, "PERSONA_ID") ?? ""),
        name: String(cell(row, "NAME") ?? ""),
        members: num(cell(row, "N_MEMBERS_HM")),
        highConfidence: num(cell(row, "HIGH_CONF_SHARE")),
      })),
      events: num(cell(totals, "EVENTS")),
      layouts: num(cell(totals, "LAYOUTS")),
      catalog: num(cell(totals, "CATALOG")),
      trending: num(cell(totals, "TRENDING")),
    })
  } catch (err) {
    console.error("cohort read failed", err)
    return NextResponse.json({ error: "read failed" }, { status: 502 })
  }
}
