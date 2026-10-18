// Types for sessionStyle.js (the live session model runtime, trained on OTTO; source of truth is
// session_model/web/sessionStyle.js on the `model` branch, verified against Python by check.mjs).

/** 0 = product click/view, 1 = add to bag, 2 = order */
export type SessionEventType = 0 | 1 | 2;

export interface SessionEvent {
  /** seconds since epoch */
  ts: number;
  /** product id (any stable number or string hash) */
  aid: number;
  type: SessionEventType;
}

export type StyleTarget =
  | "exploration"
  | "comparison"
  | "browsing_pace"
  | "click_to_cart"
  | "cart_to_order"
  | "decision_speed"
  | "multi_visit_research";

/** Percentile among OTTO shoppers: 0 = lowest, 1 = highest. */
export type SessionStyle = Record<StyleTarget, number>;

export interface SessionDecision<V = string | number> {
  value: V;
  /** false until the model is reliable for this many events and the visitor clearly fits a case */
  active: boolean;
  reason: string;
}

export interface SessionDecisions {
  grid_columns: SessionDecision<2 | 3 | 4>;
  compare_panel: SessionDecision<"on" | "off">;
  recently_viewed: SessionDecision<"prominent" | "default">;
  quick_add: SessionDecision<"on" | "off">;
  cart_reminder: SessionDecision<"on" | "off">;
  product_page: SessionDecision<"compact" | "standard" | "detailed">;
}

export interface SessionModel {
  version: number;
  features: string[];
  visit_gap_s: number;
  min_r2: number;
  policy: unknown[];
  targets: Record<StyleTarget, { trees: unknown[]; r2_by_events: Record<string, number> }>;
}

export interface SessionState {
  nEvents: number;
  style: SessionStyle;
  decisions: SessionDecisions;
}

export function sessionFeatures(events: (SessionEvent | [number, number, number])[], visitGapS?: number): number[];
export function predictStyle(model: SessionModel, x: number[]): SessionStyle;
export function decide(model: SessionModel, style: SessionStyle, nEvents: number): SessionDecisions;

export class SessionTracker {
  constructor(model: SessionModel);
  events: SessionEvent[];
  add(event: SessionEvent): SessionState;
  current(): SessionState;
}
