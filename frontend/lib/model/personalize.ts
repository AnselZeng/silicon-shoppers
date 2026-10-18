"use client";

// Personalization wiring for the store.
// First paint: the shopper's stored document (Snowflake USER_LAYOUTS via /api/layout) -> setLayout.
// A v1 document (atelier.store_layout.v1) is converted to the store's v2 layout; an older HomepageDoc
// still goes through modelLayout. Every click: the OTTO session model re-decides browsing fields.
// A 60 s poll picks up the laptop's refreshed document. Without Snowflake the store keeps its defaults.

import { fromStoreEvent, isStoreLayoutDoc, modelLayout, modelLayoutV1, type DecisionLogEntry }
  from "@/lib/model/adapter";
import { getShopperId, queueEvent } from "@/lib/model/eventSink";
import type { HomepageDoc } from "@/lib/model/homepage";
import { SessionTracker, type SessionDecisions, type SessionModel } from "@/lib/model/sessionStyle";
import type { StoreLayoutDoc } from "@/lib/model/storeLayout";
import { postSimMessage, type StoreEvent } from "@/lib/sim/protocol";
import { useStorefront } from "@/lib/store/storeState";

const POLL_MS = 60_000;

let home: HomepageDoc | StoreLayoutDoc | null = null;
let tracker: SessionTracker | null = null;
let trackerReady: Promise<void> | null = null;
let updatedAt: string | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
let lastSignature = "";
let lastLog: DecisionLogEntry[] = [];
let live = false;
let reported = "";

/** True once this visit has applied a document from USER_LAYOUTS. */
export function hasLiveLayout(): boolean {
  return live;
}

/** The most recent decision log (one entry per layout decision, with reason + source). */
export function getDecisionLog(): DecisionLogEntry[] {
  return lastLog;
}

/** The document currently applied to this shopper, or null when Snowflake has none. */
export function getShopperDoc(): HomepageDoc | StoreLayoutDoc | null {
  return home;
}

function report(status: {
  state: "disabled" | "waiting" | "applied";
  persona?: string;
  confidence?: string;
  reason?: string;
  updatedAt?: string | null;
}): void {
  const shopperId = getShopperId();
  const key = JSON.stringify({ shopperId, ...status });
  if (key === reported || typeof window === "undefined" || window.parent === window) return;
  reported = key;
  postSimMessage(window.parent, { type: "model_status", shopperId, ...status });
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
    )) as {
      homepage?: HomepageDoc | StoreLayoutDoc | null;
      updatedAt?: string | null;
      disabled?: boolean;
    };
    if (res.disabled) {
      report({ state: "disabled" });
      return;
    }
    if (!res.homepage) {
      report({ state: "waiting" });
      return;
    }
    if ((res.updatedAt ?? null) === updatedAt) return;
    home = res.homepage;
    updatedAt = res.updatedAt ?? null;
    live = true;
    apply(tracker?.current().decisions);
    report(describe(home, updatedAt));
  } catch {
    // no backend configured: defaults stay
  }
}

function describe(doc: HomepageDoc | StoreLayoutDoc, at: string | null): {
  state: "applied";
  persona?: string;
  confidence?: string;
  reason?: string;
  updatedAt: string | null;
} {
  if (isStoreLayoutDoc(doc)) {
    const shopper = doc.shopper;
    return {
      state: "applied",
      persona: shopper.persona?.name ?? shopper.label,
      confidence: shopper.confidence,
      reason: shopper.persona_reason,
      updatedAt: at,
    };
  }
  return { state: "applied", persona: doc.demo_id ?? doc.user_id, updatedAt: at };
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
  const { layout, log } = isStoreLayoutDoc(home) ? modelLayoutV1(home, live) : modelLayout(home, live);
  lastSignature = live ? signature(live) : "";
  lastLog = log;
  useStorefront.getState().setLayout(layout, { presetName: live ? "Live session" : "H&M model" });
}
