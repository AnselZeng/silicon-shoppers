"use client";

// Personalization wiring for the store.
// First paint: the shopper's stored HomepageDoc (Snowflake USER_LAYOUTS via /api/layout) -> setLayout.
// Every click: the OTTO session model in the browser re-decides browsing-driven fields
// (grid density, quick add, compare panel, Recently Viewed, cart reminder, product page).
// A 60 s poll picks up the laptop's refreshed document (it rescores shoppers about every 2 min).
// Without Snowflake env vars or the model file the store simply keeps its defaults.

import { fromStoreEvent, modelLayout, type DecisionLogEntry } from "@/lib/model/adapter";
import { getShopperId, queueEvent } from "@/lib/model/eventSink";
import type { HomepageDoc } from "@/lib/model/homepage";
import { SessionTracker, type SessionDecisions, type SessionModel } from "@/lib/model/sessionStyle";
import { useStorefront } from "@/lib/store/storeState";
import type { StoreEvent } from "@/lib/sim/protocol";

const POLL_MS = 60_000;

let home: HomepageDoc | null = null;
let tracker: SessionTracker | null = null;
let trackerReady: Promise<void> | null = null;
let updatedAt: string | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
let lastSignature = "";
let lastLog: DecisionLogEntry[] = [];

/** The most recent decision log (one entry per layout decision, with reason + source). */
export function getDecisionLog(): DecisionLogEntry[] {
  return lastLog;
}

/** First-paint fetch, session-model load and the refresh poll. Call once on store mount. */
export function initPersonalization(): void {
  if (typeof window === "undefined") return;
  if (!trackerReady) {
    trackerReady = fetch("/model/session_model.json")
      .then((r) => (r.ok ? (r.json() as Promise<SessionModel>) : null))
      .then((m) => {
        if (m) tracker = new SessionTracker(m);
      })
      .catch(() => undefined);
  }
  void refreshLayout();
  if (!poll) poll = setInterval(() => void refreshLayout(), POLL_MS);
}

async function refreshLayout(): Promise<void> {
  try {
    const res = (await fetch(`/api/layout?userId=${encodeURIComponent(getShopperId())}`).then((r) =>
      r.json(),
    )) as { homepage?: HomepageDoc | null; updatedAt?: string | null };
    if (!res.homepage || (res.updatedAt ?? null) === updatedAt) return;
    home = res.homepage;
    updatedAt = res.updatedAt ?? null;
    apply(tracker?.current().decisions);
  } catch {
    // no backend configured: defaults stay
  }
}

/** Feed one store event: upload it for the slow loop and let the live model react. */
export function onStoreEvent(e: StoreEvent): void {
  queueEvent(e);
  const ev = fromStoreEvent(e);
  if (!ev || !tracker) return;
  const { decisions } = tracker.add(ev);
  if (home && signature(decisions) !== lastSignature) apply(decisions);
}

function signature(decisions: SessionDecisions): string {
  return Object.values(decisions)
    .map((d) => (d.active ? String(d.value) : ""))
    .join("|");
}

function apply(live?: SessionDecisions): void {
  if (!home) return;
  const { layout, log } = modelLayout(home, live);
  lastSignature = live ? signature(live) : "";
  lastLog = log;
  useStorefront.getState().setLayout(layout, live ? "Live session" : "H&M model");
}
