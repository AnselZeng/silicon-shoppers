// GET /api/layout?userId=...  ->  { homepage: HomepageDoc | null, updatedAt, trending: [{productId, score}] }
// homepage is null for a shopper the refresh job hasn't scored yet: use the store defaults (DEFAULT_LAYOUT).
// Then: const { layout, ... } = modelLayout(homepage, liveDecisions)  (lib/model/adapter.ts).
import { NextResponse } from "next/server";
import { snowflakeEnabled, sql } from "@/lib/server/snowflake";

// Cache Components: route handlers run on the Node.js runtime and at request time by default.

const ID = /^[A-Za-z0-9_.:-]{1,80}$/;

function parse(v: unknown) {
  return typeof v === "string" ? JSON.parse(v) : v ?? null;
}

/** Snowflake rows come back uppercase or lowercase depending on the driver. */
function cell(row: Record<string, unknown>, name: string): unknown {
  if (name in row) return row[name];
  const found = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase());
  return found ? row[found] : undefined;
}

export async function GET(req: Request) {
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!snowflakeEnabled()) return NextResponse.json({ homepage: null, trending: [], disabled: true });
  if (!ID.test(userId)) return NextResponse.json({ error: "bad userId" }, { status: 400 });
  try {
    const [rows, trend] = await Promise.all([
      sql<Record<string, unknown>>(
        "SELECT HOMEPAGE, UPDATED_AT FROM USER_LAYOUTS WHERE USER_ID = ?", [userId]),
      sql<Record<string, unknown>>(
        "SELECT PRODUCT_ID, SCORE FROM TRENDING ORDER BY RANK LIMIT 12"),
    ]);
    const row = rows[0];
    return NextResponse.json({
      homepage: row ? parse(cell(row, "HOMEPAGE")) : null,
      updatedAt: row ? (cell(row, "UPDATED_AT") ?? null) : null,
      trending: trend.map((item) => ({ productId: cell(item, "PRODUCT_ID"), score: cell(item, "SCORE") })),
    });
  } catch (err) {
    console.error("layout read failed", err);
    return NextResponse.json({ homepage: null, trending: [], error: "read failed" }, { status: 502 });
  }
}
