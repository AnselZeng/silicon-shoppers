"use client"

// Live provisional personas: the browser port of backend/server/personas.py
// `live_stats` + `assign_live`. The store event stream feeds the tracker on
// every interaction; once there is enough behaviour (MIN_EVENTS and a minimum
// score) a persona is named, with low/medium/high confidence that rises with
// evidence. The OTTO session model's predicted browsing style nudges the
// scores, so the persona is model-informed, not only rule counts.
//
// When confidence reaches "medium" the persona is allowed to touch the layout
// through applyPersonaOverlay — changes apply only when confidence warrants.

import type { AdId } from "@/lib/ads/catalog"
import type { StoreColor } from "@/config/ui"
import type { NavItemId } from "@/lib/layout/enums"
import type { LayoutConfig } from "@/lib/layout/types"
import type { SessionStyle } from "@/lib/model/sessionStyle"
import type { StoreEvent } from "@/lib/sim/protocol"
import { getProduct, PRODUCTS } from "@/lib/store/catalog"

export type LivePersonaId = "price_hunter" | "trend_seeker" | "mission_shopper" | "brand_loyalist"

export interface LivePersona {
  personaId: LivePersonaId
  name: string
  confidence: "low" | "medium" | "high"
  reason: string
  score: number
}

export interface LiveStats {
  nEvents: number
  nViews: number
  nAdds: number
  nSorts: number
  nFilters: number
  nSearches: number
  saleAdds: number
  newAdds: number
  cheapAdds: number
  collAdds: number
  colorAdds: number
  topColor: StoreColor | null
  topCollection: string | null
  priceSort: number
  newestSort: number
  saleFilter: number
  searchRate: number
  directness: number
  repeatViews: number
}

const MIN_EVENTS = 5
const MIN_SCORE = 0.2

const PERSONAS: Record<LivePersonaId, { name: string; description: string }> = {
  price_hunter: {
    name: "Price Hunter",
    description: "Looks for deals first: sale items, low prices, markdowns.",
  },
  trend_seeker: {
    name: "Trend Seeker",
    description: "Shops what is new: recent drops and less-common picks.",
  },
  mission_shopper: {
    name: "Mission Shopper",
    description: "Shops with a goal: fewer trips, a focused basket.",
  },
  brand_loyalist: {
    name: "Brand Loyalist",
    description: "Comes back for the same things: rebuys and a steady palette.",
  },
}

const PRICE_MEDIAN = median(PRODUCTS.map((p) => p.price))

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function prop(event: StoreEvent, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = event.properties[key]
    if (typeof value === "string" && value) return value
  }
  return null
}

function productId(event: StoreEvent): string | null {
  return prop(event, "productId", "product_id")
}

/** Accumulates one shopper's store events into live_stats. */
export class LivePersonaTracker {
  private nEvents = 0
  private nViews = 0
  private nAdds = 0
  private nWishlist = 0
  private nSearches = 0
  private sorts: string[] = []
  private filters: string[] = []
  private viewedIds: string[] = []
  private addedIds: string[] = []

  add(event: StoreEvent): void {
    this.nEvents += 1
    if (event.type === "product_viewed" || event.type === "quickview_opened") {
      this.nViews += 1
      const id = productId(event)
      if (id) this.viewedIds.push(id)
    } else if (event.type === "add_to_bag") {
      this.nAdds += 1
      const id = productId(event)
      if (id) this.addedIds.push(id)
    } else if (event.type === "add_to_wishlist") {
      this.nWishlist += 1
    } else if (event.type === "sort_changed") {
      const value = prop(event, "value", "sort")
      if (value) this.sorts.push(value)
    } else if (event.type === "filter_applied") {
      const value = prop(event, "type", "filter", "section")
      if (value) this.filters.push(value)
    } else if (event.type === "search_performed") {
      this.nSearches += 1
    }
  }

  stats(): LiveStats {
    const added = this.addedIds.map((id) => getProduct(id)).filter((p) => p != null)
    const nAdd = added.length
    const counts = (values: (string | undefined)[]): Map<string, number> => {
      const m = new Map<string, number>()
      for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1)
      return m
    }
    const topShare = (m: Map<string, number>): [string | null, number] => {
      let best: string | null = null
      let n = 0
      for (const [k, v] of m) if (v > n) { best = k; n = v }
      return [best, nAdd ? n / nAdd : 0]
    }
    const [topColl, collShare] = topShare(counts(added.map((p) => p!.collection)))
    const [topColor, colorShare] = topShare(counts(added.flatMap((p) => p!.colors)))
    const viewCounts = counts(this.viewedIds)
    const repeats = [...viewCounts.values()].filter((c) => c > 1).length
    const viewsPerAdd = this.nViews / Math.max(this.nAdds, 1)
    const nSorts = this.sorts.length
    const nFilt = this.filters.length
    return {
      nEvents: this.nEvents,
      nViews: this.nViews,
      nAdds: this.nAdds,
      nSorts,
      nFilters: nFilt,
      nSearches: this.nSearches,
      saleAdds: nAdd ? added.filter((p) => p!.salePrice != null).length / nAdd : 0,
      newAdds: nAdd ? added.filter((p) => p!.isNew).length / nAdd : 0,
      cheapAdds: nAdd ? added.filter((p) => p!.price <= PRICE_MEDIAN).length / nAdd : 0,
      collAdds: collShare,
      colorAdds: colorShare,
      topColor: topColor as StoreColor | null,
      topCollection: topColl,
      priceSort: nSorts ? this.sorts.filter((s) => s === "price_asc").length / nSorts : 0,
      newestSort: nSorts ? this.sorts.filter((s) => s === "newest").length / nSorts : 0,
      saleFilter: nFilt ? this.filters.filter((f) => f === "sale").length / nFilt : 0,
      searchRate: Math.min(1, this.nSearches / 3),
      // views-per-add is undefined before the first add; without it a passive browser looks mission-like
      directness: this.nAdds ? Math.min(1, 3 / (1 + viewsPerAdd)) : 0,
      repeatViews: viewCounts.size ? repeats / viewCounts.size : 0,
    }
  }

  /** The provisional persona, or null when there is too little behaviour to name one. */
  current(style?: SessionStyle | null): LivePersona | null {
    const s = this.stats()
    if (s.nEvents < MIN_EVENTS) return null
    const scores: Record<LivePersonaId, number> = {
      price_hunter: 0.4 * s.saleAdds + 0.2 * s.cheapAdds + 0.25 * s.priceSort + 0.15 * s.saleFilter,
      trend_seeker: 0.6 * s.newAdds + 0.4 * s.newestSort,
      mission_shopper: 0.45 * s.searchRate + 0.3 * s.directness + 0.25 * Math.min(1, s.nFilters / 3),
      brand_loyalist: 0.45 * s.repeatViews + 0.3 * s.collAdds + 0.25 * s.colorAdds,
    }
    // the OTTO session model's predicted style nudges the rule scores
    if (style) {
      scores.trend_seeker += 0.15 * Math.max(0, style.exploration - 0.5)
      scores.brand_loyalist += 0.15 * Math.max(0, style.multi_visit_research - 0.5)
    }
    const order = (Object.keys(scores) as LivePersonaId[]).sort((a, b) => scores[b] - scores[a])
    const [pid, margin] = [order[0], scores[order[0]] - scores[order[1]]]
    if (scores[pid] < MIN_SCORE) return null
    const evidence = Math.min(1, s.nEvents / 30)
    const confidence = margin >= 0.25 && evidence >= 0.5 ? "high" : margin >= 0.12 ? "medium" : "low"
    return { personaId: pid, name: PERSONAS[pid].name, confidence, reason: liveReason(pid, s), score: scores[pid] }
  }
}

function liveReason(pid: LivePersonaId, s: LiveStats): string {
  const bits: string[] = []
  if (s.nAdds) {
    bits.push(`${s.nAdds} bag add${s.nAdds > 1 ? "s" : ""}`)
    if (s.saleAdds > 0) bits.push(`${Math.round(s.saleAdds * 100)}% of them on sale`)
    if (s.newAdds > 0) bits.push(`${Math.round(s.newAdds * 100)}% of them new in`)
  }
  if (s.nSorts) {
    if (s.priceSort > 0) bits.push(`sorted by price ${Math.round(s.nSorts * s.priceSort)}x`)
    if (s.newestSort > 0) bits.push(`sorted by newest ${Math.round(s.nSorts * s.newestSort)}x`)
  }
  if (s.nSearches) bits.push(`${s.nSearches} search${s.nSearches > 1 ? "es" : ""}`)
  if (s.repeatViews > 0) bits.push(`revisited ${Math.round(s.repeatViews * 100)}% of viewed products`)
  return bits.join("; ") || `${s.nEvents} events so far`
}

// ---------------------------------------------------------------- layout overlay

function heroAd(layout: LayoutConfig, ad: AdId): void {
  const placement = layout.ads.placements.find((p) => p.slot === "hero")
  if (placement) placement.adIds = [ad]
}

function navFront(layout: LayoutConfig, ids: NavItemId[]): void {
  const order = layout.nav.order.filter((id) => !ids.includes(id))
  layout.nav.order = [...ids.filter((id) => layout.nav.order.includes(id)), ...order]
}

function rowFirst(layout: LayoutConfig, kind: string): void {
  const blocks = layout.home.blocks
  const idx = blocks.findIndex((b) => b.type === "product_row" && b.source.kind === kind)
  if (idx > 1) {
    const [row] = blocks.splice(idx, 1)
    blocks.splice(1, 0, row)
  }
}

function saleHero(dept: string | null): AdId {
  return dept === "men" ? "sale_men" : dept === "women" ? "sale_women" : "offer_all"
}

/**
 * What a provisional persona is allowed to change once it has earned it
 * (confidence >= medium). Conservative: reorder and re-emphasize, never hide.
 */
export function applyPersonaOverlay(layout: LayoutConfig, persona: LivePersona): LayoutConfig {
  const out = structuredClone(layout)
  const dept = out.nav.department
  switch (persona.personaId) {
    case "price_hunter":
      navFront(out, ["sale"])
      out.nav.highlight = "sale"
      out.listing.defaultSort = "price_asc"
      out.listing.card = { ...out.listing.card, priceStyle: "sale_emphasis" }
      if (!out.listing.card.badges.includes("sale")) out.listing.card.badges = [...out.listing.card.badges, "sale"]
      out.listing.filterOrder = ["price", "sale", ...out.listing.filterOrder.filter((f) => f !== "price" && f !== "sale")]
      rowFirst(out, "sale")
      heroAd(out, saleHero(dept))
      break
    case "trend_seeker":
      navFront(out, ["new_in"])
      out.nav.highlight = "new_in"
      out.listing.defaultSort = "newest"
      if (!out.listing.card.badges.includes("new")) out.listing.card.badges = [...out.listing.card.badges, "new"]
      rowFirst(out, "new_in")
      heroAd(out, dept === "men" ? "new_men" : "new_women")
      break
    case "brand_loyalist":
      navFront(out, ["collections"])
      out.nav.highlight = "collections"
      rowFirst(out, "buy_again")
      break
    case "mission_shopper":
      navFront(out, ["for_you"])
      rowFirst(out, "for_you")
      break
  }
  return out
}
