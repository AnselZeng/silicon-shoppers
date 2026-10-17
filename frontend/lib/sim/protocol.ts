import type { LayoutConfig } from "@/lib/layout/types"
import type { SortOption } from "@/lib/personas/schema"

export const SIM_SOURCE = "atelier-nine-sim" as const

export type AgentAction =
  | { type: "navigate"; href: string }
  | { type: "click"; agentId: string }
  | { type: "scrollTo"; percent: number }
  | { type: "type"; agentId: string; text: string }
  | { type: "hover"; agentId: string }
  | { type: "wait"; ms: number }

export const STORE_EVENT_TYPES = [
  "page_view",
  "sort_changed",
  "filter_applied",
  "filter_removed",
  "product_viewed",
  "quickview_opened",
  "add_to_bag",
  "add_to_wishlist",
  "popup_shown",
  "popup_dismissed",
  "popup_clicked",
  "banner_clicked",
  "search_performed",
  "scroll_depth",
  "checkout_started",
  "payment_completed",
  "concierge_query",
  "loyalty_awarded",
  "session_end",
] as const

export type StoreEventType = (typeof STORE_EVENT_TYPES)[number]

export type EventValue = string | number | boolean | null

export interface StoreEvent {
  type: StoreEventType
  timestamp: number
  route: string
  properties: Record<string, EventValue>
}

export interface VisibleElement {
  agentId: string
  rect: { x: number; y: number; w: number; h: number }
  productId?: string
  price?: number
  color?: string
  isNew?: boolean
  onSale?: boolean
  collection?: string
  name?: string
  sort?: string
  filters?: string
  banner?: string
  popup?: string
  checkout?: string
  count?: string
  text?: string
}

export interface PageState {
  route: string
  scrollPercent: number
  elements: VisibleElement[]
}

export type ParentPayload =
  | { type: "agent_action"; action: AgentAction }
  | { type: "set_layout"; layout: LayoutConfig; presetName?: string }
  | { type: "reset" }
  | { type: "cursor_config"; color: string; speed: number }
  | { type: "set_debug"; showElementIds: boolean }

export type StorePayload =
  | { type: "store_event"; event: StoreEvent }
  | { type: "page_state"; state: PageState }
  | { type: "action_done"; ok: boolean; error?: string }
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
  return (
    payload.type === "agent_action" ||
    payload.type === "set_layout" ||
    payload.type === "reset" ||
    payload.type === "cursor_config" ||
    payload.type === "set_debug"
  )
}

export function isStorePayload(payload: ParentPayload | StorePayload): payload is StorePayload {
  return (
    payload.type === "store_event" ||
    payload.type === "page_state" ||
    payload.type === "action_done" ||
    payload.type === "store_ready"
  )
}

export function postSimMessage(target: Window, payload: ParentPayload | StorePayload) {
  target.postMessage(envelope(payload), window.location.origin)
}

export type { SortOption }
