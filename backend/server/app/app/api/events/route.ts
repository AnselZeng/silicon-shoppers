// POST /api/events  { userId, sessionId, events: StoreEvent[] }  ->  rows in Snowflake EVENTS
// Sent in batches by lib/model/eventSink.ts (every few seconds and when the tab is hidden).
// The laptop's refresh job reads them, rescores the shopper and writes USER_LAYOUTS.
import { NextResponse } from "next/server";
import { snowflakeEnabled, sql } from "@/lib/server/snowflake";
import { STORE_EVENT_TYPES, type StoreEvent } from "@/lib/sim/protocol";

export const runtime = "nodejs";

const MAX_EVENTS = 200;
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;

export async function POST(req: Request) {
  if (!snowflakeEnabled()) return NextResponse.json({ ok: false, disabled: true });
  let body: { userId?: string; sessionId?: string; events?: StoreEvent[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const { userId, sessionId } = body;
  if (!userId || !ID.test(userId) || (sessionId && !ID.test(sessionId))) {
    return NextResponse.json({ ok: false, error: "bad ids" }, { status: 400 });
  }
  const types = new Set<string>(STORE_EVENT_TYPES);
  const events = (body.events ?? []).filter((e) => e && types.has(e.type) && Number.isFinite(e.timestamp)).slice(0, MAX_EVENTS);
  if (!events.length) return NextResponse.json({ ok: true, inserted: 0 });

  const binds: unknown[] = [];
  const values: string[] = [];
  for (const e of events) {
    const p = e.properties ?? {};
    const pid = p.productId ?? p.product_id ?? null;
    const ts = new Date(Math.min(e.timestamp, Date.now())).toISOString().replace("T", " ").replace("Z", "");
    values.push("(?, ?, ?, ?, ?, ?, ?, ?, ?)");
    binds.push(crypto.randomUUID(), userId, sessionId ?? null, e.type, ts, (e.route ?? "").slice(0, 300),
               pid === null ? null : String(pid), typeof p.color === "string" ? p.color : null, JSON.stringify(p));
  }
  try {
    await sql(
      `INSERT INTO EVENTS (EVENT_ID, USER_ID, SESSION_ID, TYPE, TS, ROUTE, PRODUCT_ID, COLOR, PROPERTIES)
       SELECT column1, column2, column3, column4, TO_TIMESTAMP_NTZ(column5), column6, column7, column8, PARSE_JSON(column9)
       FROM VALUES ${values.join(", ")}`,
      binds,
    );
    return NextResponse.json({ ok: true, inserted: events.length });
  } catch (err) {
    console.error("events insert failed", err);
    return NextResponse.json({ ok: false, error: "insert failed" }, { status: 502 });
  }
}
