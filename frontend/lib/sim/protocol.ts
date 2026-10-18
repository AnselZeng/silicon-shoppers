import type { ModelContext } from "@/lib/model/homepage"
import type { SortOption } from "@/lib/personas/schema"

export const SIM_SOURCE = "atelier-nine-sim" as const

export const STORE_EVENT_TYPES = [
  "page_view",
  "sort_changed",
  "filter_applied",
  "filter_removed",
  "product_viewed",
  "quickview_opened",
  "add_to_bag",
  "add_to_wishlist",
  "ad_shown",
  "ad_clicked",
  "ad_dismissed",
  "search_performed",
  "scroll_depth",
  "checkout_started",
  "payment_completed",
  "concierge_query",
  "loyalty_awarded",
] as const

export type StoreEventType = (typeof STORE_EVENT_TYPES)[number]

export type EventValue = string | number | boolean | null

export interface StoreEvent {
  type: StoreEventType
  timestamp: number
  route: string
  properties: Record<string, EventValue>
}

export type ParentPayload =
  /** layout is validated inside the store; model lets the validator apply the model policy and fall back. */
  | { type: "set_layout"; layout: unknown; model?: ModelContext | null; presetName?: string; immediate?: boolean }
  | { type: "reset" }

export type StorePayload =
  | { type: "store_event"; event: StoreEvent }
  | { type: "store_ready" }

export interface SimEnvelope<T> {
  source: typeof SIM_SOURCE
  payload: T
}

export function envelope<T>(payload: T): SimEnvelope<T> {
  return { source: SIM_SOURCE, payload }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function readEnvelope(data: unknown): { payload: ParentPayload | StorePayload } | null {
  if (!isRecord(data)) return null
  if (data.source !== SIM_SOURCE) return null
  if (!isRecord(data.payload)) return null
  if (typeof data.payload.type !== "string") return null
  return { payload: data.payload as ParentPayload | StorePayload }
}

export function isParentPayload(payload: ParentPayload | StorePayload): payload is ParentPayload {
  return payload.type === "set_layout" || payload.type === "reset"
}

export function isStorePayload(payload: ParentPayload | StorePayload): payload is StorePayload {
  return payload.type === "store_event" || payload.type === "store_ready"
}

export function postSimMessage(target: Window, payload: ParentPayload | StorePayload) {
  target.postMessage(envelope(payload), window.location.origin)
}

export type { SortOption }
