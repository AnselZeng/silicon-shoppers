// GET /api/layout?userId=...  ->  { homepage: HomepageDoc | null, updatedAt, trending: [{productId, score}] }
// homepage is null for a shopper the refresh job hasn't scored yet: use the store defaults (DEFAULT_LAYOUT).
// Then: const { layout, ... } = modelLayout(homepage, liveDecisions)  (lib/model/adapter.ts).
import { NextResponse } from "next/server";
import { snowflakeEnabled, sql } from "@/lib/server/snowflake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_.:-]{1,80}$/;

function parse(v: unknown) {
  return typeof v === "string" ? JSON.parse(v) : v ?? null;
}

export async function GET(req: Request) {
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!snowflakeEnabled()) return NextResponse.json({ homepage: null, trending: [], disabled: true });
  if (!ID.test(userId)) return NextResponse.json({ error: "bad userId" }, { status: 400 });
  try {
    const [rows, trend] = await Promise.all([
      sql<{ HOMEPAGE: unknown; UPDATED_AT: string }>(
        "SELECT HOMEPAGE, UPDATED_AT FROM USER_LAYOUTS WHERE USER_ID = ?", [userId]),
      sql<{ PRODUCT_ID: string; SCORE: number }>(
        "SELECT PRODUCT_ID, SCORE FROM TRENDING ORDER BY RANK LIMIT 12"),
    ]);
    return NextResponse.json({
      homepage: rows.length ? parse(rows[0].HOMEPAGE) : null,
      updatedAt: rows[0]?.UPDATED_AT ?? null,
      trending: trend.map((t) => ({ productId: t.PRODUCT_ID, score: t.SCORE })),
    });
  } catch (err) {
    console.error("layout read failed", err);
    return NextResponse.json({ homepage: null, trending: [], error: "read failed" }, { status: 502 });
  }
}
