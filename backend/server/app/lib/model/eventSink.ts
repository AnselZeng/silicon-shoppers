// Browser side of the Snowflake loop: a stable anonymous shopper id, and batched event uploads.
//
// Wire-up (one line in lib/sim/tracker.ts, inside emitStoreEvent, after the event object is built):
//     queueEvent(event);
// and on store load:
//     const res = await fetch(`/api/layout?userId=${getShopperId()}`).then((r) => r.json());
//     // res.homepage: HomepageDoc | null  ->  modelLayout(res.homepage, liveDecisions) when present
import type { StoreEvent } from "@/lib/sim/protocol";

const KEY_USER = "atelier_shopper_id";
const KEY_SESSION = "atelier_session_id";
const FLUSH_MS = 4000;

let queue: StoreEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function rid(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9-]/g, "");
}

/** Same id across visits on this browser (a "profile" picker can call setShopperId instead). */
export function getShopperId(): string {
  try {
    let id = localStorage.getItem(KEY_USER);
    if (!id) {
      id = `web-${rid()}`;
      localStorage.setItem(KEY_USER, id);
    }
    return id;
  } catch {
    return "web-anonymous";
  }
}

export function setShopperId(id: string) {
  try { localStorage.setItem(KEY_USER, id); } catch { /* private mode */ }
}

function sessionId(): string {
  try {
    let id = sessionStorage.getItem(KEY_SESSION);
    if (!id) {
      id = `s-${rid()}`;
      sessionStorage.setItem(KEY_SESSION, id);
    }
    return id;
  } catch {
    return "s-unknown";
  }
}

export function flushEvents(useBeacon = false) {
  if (typeof window === "undefined" || !queue.length) return;
  const body = JSON.stringify({ userId: getShopperId(), sessionId: sessionId(), events: queue.splice(0, 200) });
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
  } else {
    fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true })
      .catch(() => { /* offline: drop, the demo keeps working */ });
  }
}

export function queueEvent(e: StoreEvent) {
  if (typeof window === "undefined") return;
  queue.push(e);
  if (!timer) {
    timer = setTimeout(() => { timer = null; flushEvents(); }, FLUSH_MS);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => flushEvents(true));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushEvents(true); });
}
