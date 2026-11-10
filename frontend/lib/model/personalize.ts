"use client";

// Personalization wiring for the store.
// First paint: the shopper's stored document (Snowflake USER_LAYOUTS via /api/layout) -> setLayout.
// A v1 document (atelier.store_layout.v1) is converted to the store's v2 layout; an older HomepageDoc
// still goes through modelLayout. Every click: the OTTO session model re-decides browsing fields.
// A 60 s poll picks up the refreshed document. Without Snowflake the store keeps its defaults.
//
// Layers, applied in this order (later wins):
//   1. the stored document (purchase model + session decisions)
//   2. the nightly interest model's department, on the For You order
//   3. the shopper's persona, once it has earned a layout change (see resolvePersona)
//   4. what the shopper told the concierge, remembered across visits (/api/prefs)

import { fromStoreEvent, isStoreLayoutDoc, modelLayout, modelLayoutV1, type DecisionLogEntry }
  from "@/lib/model/adapter";
import {
  applyPersonaOverlay, canOverlay, LivePersonaTracker, resolvePersona,
  type ResolvedPersona, type StoredPersona,
} from "@/lib/model/livePersona";
import { getShopperId, queueEvent } from "@/lib/model/eventSink";
import type { LayoutConfig } from "@/lib/layout/types";
import { getProduct } from "@/lib/store/catalog";
import { applyChatIntent } from "@/lib/store/chatIntent";
import type { HomepageDoc } from "@/lib/model/homepage";
import { SessionTracker, type SessionDecisions, type SessionModel } from "@/lib/model/sessionStyle";
import { mergeStatements } from "@/lib/model/statements";
import type { StoreLayoutDoc } from "@/lib/model/storeLayout";
import { postSimMessage, type StoreEvent } from "@/lib/sim/protocol";
import { useStorefront } from "@/lib/store/storeState";

const POLL_MS = 60_000;

let home: HomepageDoc | StoreLayoutDoc | null = null;
let tracker: SessionTracker | null = null;
let liveTracker = new LivePersonaTracker();
let lastOverlayKey = "";
let trackerReady: Promise<void> | null = null;
let updatedAt: string | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
let lastSignature = "";
let lastLog: DecisionLogEntry[] = [];
let live = false;
let reported = "";
/** Nightly interest model: predicted department from Snowflake, or null. */
let interest: { department: string; confidence: number; trainedOn: string } | null = null;
/** What the shopper told the concierge, oldest first. Loaded from Snowflake, extended this visit. */
let stated: string[] = [];

/** True once this visit has applied a document from USER_LAYOUTS or the shopper's remembered statements. */
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

/** What the shopper has told the concierge, oldest first. */
export function getStatements(): string[] {
  return [...stated];
}

function storedPersona(): StoredPersona | null {
  if (!home || !isStoreLayoutDoc(home)) return null;
  const shopper = home.shopper;
  if (!shopper.persona) return null;
  return {
    personaId: shopper.persona_id,
    name: shopper.persona.name,
    confidence: shopper.confidence,
    reason: shopper.persona_reason ?? "",
  };
}

/** The one persona the terminal, the layout overlay and the concierge all use. */
export function getPersona(): ResolvedPersona | null {
  return resolvePersona(storedPersona(), liveTracker.current(tracker?.current().style));
}

function report(status: {
  state: "disabled" | "waiting" | "applied";
  persona?: string;
  confidence?: string;
  reason?: string;
  live?: boolean;
  updatedAt?: string | null;
}): void {
  const shopperId = getShopperId();
  const key = JSON.stringify({ shopperId, ...status });
  if (key === reported || typeof window === "undefined" || window.parent === window) return;
  reported = key;
  postSimMessage(window.parent, { type: "model_status", shopperId, ...status });
}

function reportPersona(): void {
  const persona = getPersona();
  if (persona) {
    report({
      state: "applied",
      persona: persona.name,
      confidence: persona.confidence,
      reason: persona.reason,
      live: persona.origin === "session",
      updatedAt,
    });
  } else if (home) {
    report(describe(home, updatedAt));
  }
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
  void loadStatements();
  if (!poll) poll = setInterval(() => void refreshLayout(), POLL_MS);
  liveTracker = new LivePersonaTracker();
}

async function refreshLayout(): Promise<void> {
  try {
    const res = (await fetch(`/api/layout?userId=${encodeURIComponent(getShopperId())}`).then((r) =>
      r.json(),
    )) as {
      homepage?: HomepageDoc | StoreLayoutDoc | null;
      updatedAt?: string | null;
      disabled?: boolean;
      interest?: { department: string; confidence: number; trainedOn: string } | null;
    };
    interest = res.interest ?? null;
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
    reportPersona();
  } catch {
    // no backend configured: defaults stay
  }
}

/** Statements from earlier visits. Applied on top of whatever the store shows once they arrive. */
async function loadStatements(): Promise<void> {
  try {
    const res = (await fetch(`/api/prefs?userId=${encodeURIComponent(getShopperId())}`).then((r) =>
      r.json(),
    )) as { statements?: unknown };
    const earlier = Array.isArray(res.statements)
      ? res.statements.filter((s): s is string => typeof s === "string" && s.length > 0)
      : [];
    if (!earlier.length) return;
    // anything said during this visit is newer than what was stored
    stated = mergeStatements(earlier, stated);
    reapplyStatements("What you told us");
  } catch {
    // no backend configured: nothing remembered
  }
}

/** The concierge acted on this statement: keep it so later refreshes do not undo it. */
export function rememberStatement(statement: string): void {
  stated = mergeStatements(stated, [statement]);
}

/**
 * The shopper asked to forget what they said. With a stored document the store is rebuilt from the
 * models right away (returns true); without one the current layout stays until the next change.
 */
export function forgetStatements(): boolean {
  stated = [];
  if (!home) return false;
  apply(tracker?.current().decisions);
  return true;
}

function reapplyStatements(presetName: string): void {
  if (home) {
    apply(tracker?.current().decisions);
    return;
  }
  const log: DecisionLogEntry[] = [];
  const next = withStatements(useStorefront.getState().layout, log);
  if (!log.length) return;
  live = true;
  lastLog = [...lastLog.filter((entry) => entry.key !== "stated_preference"), ...log];
  useStorefront.getState().setLayout(next, { presetName });
}

/** Re-applies each remembered statement, oldest first, so the newest one has the last word. */
function withStatements(layout: LayoutConfig, log: DecisionLogEntry[]): LayoutConfig {
  let out = layout;
  for (const statement of stated) {
    const applied = applyChatIntent(statement, out);
    if (!applied) continue;
    out = applied.layout;
    log.push({
      key: "stated_preference",
      value: applied.summary,
      reason: `You told the concierge: "${statement}"`,
      source: "Your own words",
      evidence: "remembered across visits",
    });
  }
  return out;
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

/** Feed one store event: upload it, let the session model react, update the persona. */
export function onStoreEvent(e: StoreEvent): void {
  queueEvent(e);
  liveTracker.add(e);
  const persona = getPersona();
  if (persona) reportPersona();
  const ev = fromStoreEvent(e);
  if (!ev || !tracker) return;
  const { decisions } = tracker.add(ev);
  const overlayKey = canOverlay(persona) ? `${persona.personaId}:${persona.confidence}` : "";
  if (home && (signature(decisions) !== lastSignature || overlayKey !== lastOverlayKey)) {
    lastOverlayKey = overlayKey;
    apply(decisions);
  } else if (!home && canOverlay(persona) && overlayKey !== lastOverlayKey) {
    // no stored document: this visit's persona still gets to rearrange the default store
    lastOverlayKey = overlayKey;
    const next = applyPersonaOverlay(useStorefront.getState().layout, persona);
    useStorefront.getState().setLayout(next, { presetName: `This visit · ${persona.name}` });
  }
}

function signature(decisions: SessionDecisions): string {
  return Object.values(decisions)
    .map((d) => (d.active ? String(d.value) : ""))
    .join("|");
}

function apply(session?: SessionDecisions): void {
  if (!home) return;
  const { layout, log } = isStoreLayoutDoc(home) ? modelLayoutV1(home, session) : modelLayout(home, session);
  // the nightly interest model: its predicted department leads the For You order
  if (interest && interest.confidence >= 0.5) {
    const dept = interest.department;
    const rank = (id: string) => (getProduct(id)?.department === dept ? 0 : 1);
    const sorted = [...layout.home.forYouIds].sort((a, b) => rank(a) - rank(b));
    if (sorted.join() !== layout.home.forYouIds.join()) {
      layout.home.forYouIds = sorted;
      log.push({
        key: "interest_department",
        value: dept,
        reason: `The nightly model predicts you shop ${dept} next (${Math.round(interest.confidence * 100)}% confidence, trained ${interest.trainedOn})`,
        source: "Store interest model (nightly retrain)",
        evidence: "learned from every shopper's live events",
      });
    }
  }
  const persona = getPersona();
  let final = layout;
  if (canOverlay(persona)) {
    final = applyPersonaOverlay(layout, persona);
    log.push({
      key: "persona",
      value: persona.name,
      reason: persona.reason,
      source: persona.origin === "stored" ? "Shopper persona (stored document)" : "Shopper persona (this visit)",
      evidence: persona.origin === "stored" ? "scored on your whole history" : `${liveTracker.stats().nEvents} events this visit`,
    });
  }
  final = withStatements(final, log);
  lastSignature = session ? signature(session) : "";
  lastLog = log;
  useStorefront.getState().setLayout(final, { presetName: session ? "Live session" : "H&M model" });
}
