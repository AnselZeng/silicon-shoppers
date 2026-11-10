import { describe, expect, it } from "vitest"

import { applyPersonaOverlay, LivePersonaTracker } from "@/lib/model/livePersona"
import { DEFAULT_LAYOUT } from "@/lib/layout/presets"
import { PRODUCTS } from "@/lib/store/catalog"
import type { StoreEvent, StoreEventType } from "@/lib/sim/protocol"

function ev(type: StoreEventType, properties: Record<string, string | number | boolean> = {}): StoreEvent {
  return { type, timestamp: 0, route: "/store", properties }
}

function feed(tracker: LivePersonaTracker, events: StoreEvent[]): void {
  for (const e of events) tracker.add(e)
}

const saleProduct = PRODUCTS.find((p) => p.salePrice != null)!
const newProduct = PRODUCTS.find((p) => p.isNew)!
const priceyProduct = [...PRODUCTS].sort((a, b) => b.price - a.price)[0]

describe("LivePersonaTracker", () => {
  it("names no persona before MIN_EVENTS", () => {
    const t = new LivePersonaTracker()
    feed(t, [
      ev("add_to_bag", { productId: saleProduct.id }),
      ev("sort_changed", { value: "price_asc" }),
      ev("product_viewed", { productId: saleProduct.id }),
    ])
    expect(t.current()).toBeNull()
  })

  it("names a Price Hunter from sale adds and price sorting", () => {
    const t = new LivePersonaTracker()
    feed(t, [
      ev("add_to_bag", { productId: saleProduct.id }),
      ev("add_to_bag", { productId: saleProduct.id }),
      ev("add_to_bag", { productId: saleProduct.id }),
      ev("sort_changed", { value: "price_asc" }),
      ev("sort_changed", { value: "price_asc" }),
      ev("filter_applied", { type: "sale" }),
    ])
    const lp = t.current()
    expect(lp?.personaId).toBe("price_hunter")
    expect(lp?.name).toBe("Price Hunter")
    expect(lp?.reason).toContain("sale")
  })

  it("names a Trend Seeker from new-in adds and newest sorting", () => {
    const t = new LivePersonaTracker()
    feed(t, [
      ev("add_to_bag", { productId: newProduct.id }),
      ev("add_to_bag", { productId: newProduct.id }),
      ev("sort_changed", { value: "newest" }),
      ev("sort_changed", { value: "newest" }),
      ev("product_viewed", { productId: newProduct.id }),
    ])
    expect(t.current()?.personaId).toBe("trend_seeker")
  })

  it("names a Mission Shopper from searches, filters and direct adds", () => {
    const t = new LivePersonaTracker()
    feed(t, [
      ev("search_performed", { q: "navy trousers" }),
      ev("search_performed", { q: "black pant" }),
      ev("filter_applied", { type: "size" }),
      ev("filter_applied", { type: "color" }),
      ev("add_to_bag", { productId: priceyProduct.id }),
      ev("search_performed", { q: "wool coat" }),
    ])
    expect(t.current()?.personaId).toBe("mission_shopper")
  })

  it("names a Brand Loyalist from repeat views and color concentration", () => {
    const t = new LivePersonaTracker()
    feed(t, [
      ev("product_viewed", { productId: saleProduct.id }),
      ev("product_viewed", { productId: saleProduct.id }),
      ev("product_viewed", { productId: saleProduct.id }),
      ev("add_to_bag", { productId: saleProduct.id }),
      ev("add_to_bag", { productId: saleProduct.id }),
    ])
    expect(t.current()?.personaId).toBe("brand_loyalist")
  })

  it("returns null when behaviour matches no persona", () => {
    const t = new LivePersonaTracker()
    feed(t, [
      ev("page_view"),
      ev("scroll_depth", { value: 0.5 }),
      ev("product_viewed", { productId: saleProduct.id }),
      ev("product_viewed", { productId: newProduct.id }),
      ev("product_viewed", { productId: priceyProduct.id }),
      ev("ad_shown", { slot: "hero" }),
    ])
    expect(t.current()).toBeNull()
  })

  it("raises confidence with more evidence", () => {
    const saleIds = PRODUCTS.filter((p) => p.salePrice != null).map((p) => p.id)
    const t = new LivePersonaTracker()
    const events = saleIds.slice(0, 5).flatMap((id) => [
      ev("add_to_bag", { productId: id }),
      ev("sort_changed", { value: "price_asc" }),
      ev("filter_applied", { type: "sale" }),
      ev("product_viewed", { productId: id }),
    ])
    feed(t, events.slice(0, 6))
    const early = t.current()
    feed(t, events.slice(6))
    const later = t.current()
    expect(early?.personaId).toBe("price_hunter")
    expect(later?.personaId).toBe("price_hunter")
    const rank = { low: 0, medium: 1, high: 2 }
    expect(rank[later!.confidence]).toBeGreaterThanOrEqual(rank[early!.confidence])
  })

  it("lets the OTTO browsing style nudge the persona", () => {
    const t = new LivePersonaTracker()
    feed(t, [
      ev("add_to_bag", { productId: newProduct.id }),
      ev("sort_changed", { value: "newest" }),
      ev("product_viewed", { productId: newProduct.id }),
      ev("product_viewed", { productId: priceyProduct.id }),
      ev("product_viewed", { productId: saleProduct.id }),
    ])
    const style = { exploration: 0.95, multi_visit_research: 0.1 } as never
    const lp = t.current(style)
    expect(lp?.personaId).toBe("trend_seeker")
  })
})

describe("applyPersonaOverlay", () => {
  const base = structuredClone(DEFAULT_LAYOUT)

  it("Price Hunter: sale leads the nav, price sort ascends, sale emphasised", () => {
    const out = applyPersonaOverlay(base, {
      personaId: "price_hunter",
      name: "Price Hunter",
      confidence: "high",
      reason: "",
      score: 0.6,
    })
    expect(out.nav.order[0]).toBe("sale")
    expect(out.nav.highlight).toBe("sale")
    expect(out.listing.defaultSort).toBe("price_asc")
    expect(out.listing.card.priceStyle).toBe("sale_emphasis")
    expect(out.listing.card.badges).toContain("sale")
    expect(out.listing.filterOrder.slice(0, 2)).toEqual(["price", "sale"])
    const hero = out.ads.placements.find((p) => p.slot === "hero")
    expect(hero?.adIds[0]).toMatch(/sale|offer/)
  })

  it("Trend Seeker: new_in leads, newest sort", () => {
    const out = applyPersonaOverlay(base, {
      personaId: "trend_seeker",
      name: "Trend Seeker",
      confidence: "medium",
      reason: "",
      score: 0.4,
    })
    expect(out.nav.order[0]).toBe("new_in")
    expect(out.listing.defaultSort).toBe("newest")
    expect(out.listing.card.badges).toContain("new")
  })

  it("does not mutate the input layout", () => {
    applyPersonaOverlay(base, {
      personaId: "price_hunter",
      name: "Price Hunter",
      confidence: "high",
      reason: "",
      score: 0.6,
    })
    expect(base.nav.order[0]).not.toBe("sale")
    expect(base.listing.defaultSort).toBe("relevance")
  })
})
