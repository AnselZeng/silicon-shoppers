import { describe, expect, test } from "vitest"
import { z } from "zod"
import { DEFAULT_LAYOUT, cloneLayout } from "@/lib/layout/presets"
import { LlmLayoutSchema } from "@/lib/layout/schema"
import type { LayoutConfig } from "@/lib/layout/types"
import { validateLayout } from "@/lib/layout/validate"
import { resolveHome } from "@/lib/layout/home"
import { llmStage, modelStage } from "@/lib/layout/pipeline"
import { modelLayout } from "@/lib/model/adapter"
import { PRODUCTS } from "@/lib/store/catalog"
import { sortProducts } from "@/lib/store/sorting"
import { CATEGORIES } from "@/lib/store/types"
import { fixtureModel } from "@/lib/testing/fixtures"

function base(): LayoutConfig {
  return cloneLayout(DEFAULT_LAYOUT)
}

function slots(layout: LayoutConfig) {
  return layout.ads.placements.map((p) => p.slot)
}

describe("validator without model output", () => {
  test("the house default passes unchanged", () => {
    const { layout, report } = validateLayout(base())
    expect(report).toEqual({ changes: [], fellBack: false })
    expect(layout).toEqual(DEFAULT_LAYOUT)
  })

  test("garbage falls back to the house default", () => {
    const { layout, report } = validateLayout({ version: 2, nav: "men first" })
    expect(report.fellBack).toBe(true)
    expect(layout).toEqual(DEFAULT_LAYOUT)
    expect(validateLayout(null).report.fellBack).toBe(true)
  })

  test("caps intrusive placements at 2, dropping interstitial, then popup, then sticky footer", () => {
    const cfg = base()
    cfg.ads.placements = [
      { slot: "sticky_footer", adIds: ["offer_all"] },
      { slot: "popup", adIds: ["offer_all"] },
      { slot: "interstitial", adIds: ["new_women"] },
    ]
    cfg.home.blocks = cfg.home.blocks.filter((b) => b.type !== "hero")
    expect(slots(validateLayout(cfg).layout).sort()).toEqual(["popup", "sticky_footer"])

    cfg.ads.placements = [
      { slot: "sticky_footer", adIds: ["shipping"] },
      { slot: "popup", adIds: ["offer_all"] },
    ]
    expect(slots(validateLayout(cfg).layout).sort()).toEqual(["popup", "sticky_footer"])

    cfg.ads.placements = [
      { slot: "interstitial", adIds: ["offer_all"] },
      { slot: "popup", adIds: ["offer_all"] },
      { slot: "sticky_footer", adIds: ["offer_all"] },
      { slot: "top_strip", adIds: ["shipping"] },
    ]
    const kept = slots(validateLayout(cfg).layout)
    expect(kept).not.toContain("interstitial")
    expect(kept).toContain("top_strip")
  })

  test("keeps one placement per slot", () => {
    const cfg = base()
    cfg.ads.placements.push({ slot: "top_strip", adIds: ["loyalty"] })
    const { layout, report } = validateLayout(cfg)
    expect(layout.ads.placements.filter((p) => p.slot === "top_strip")).toEqual([{ slot: "top_strip", adIds: ["shipping"] }])
    expect(report.changes.join(" ")).toMatch(/top_strip: more than one placement/)
  })

  test("removes ads that don't fit the slot and unknown ad ids", () => {
    const cfg = base() as unknown as { ads: { placements: unknown[] } }
    cfg.ads.placements = [
      { slot: "top_strip", adIds: ["shipping", "cat_full_women"] },
      { slot: "hero", adIds: ["newsletter", "not_an_ad", "sale_men"] },
      { slot: "listing_banner", adIds: ["offer_all"] },
    ]
    const { layout } = validateLayout(cfg)
    expect(layout.ads.placements).toEqual([
      { slot: "top_strip", adIds: ["shipping"] },
      { slot: "hero", adIds: ["sale_men"] },
    ])
  })

  test("caps carousel and grid tile ad counts and fixes triggers", () => {
    const cfg = base()
    cfg.ads.placements = [
      { slot: "top_strip", adIds: ["shipping", "loyalty", "sale_women", "new_women"], trigger: "delay" },
      { slot: "hero", adIds: ["sale_women"] },
      { slot: "grid_tile", adIds: ["sale_women", "sale_men", "new_women"], gridPosition: 0 },
      { slot: "popup", adIds: ["offer_all"], trigger: "scroll_depth", triggerValue: 400 },
      { slot: "interstitial", adIds: ["new_women"], trigger: "exit_intent" },
    ]
    const { layout } = validateLayout(cfg)
    const get = (slot: string) => layout.ads.placements.find((p) => p.slot === slot)
    expect(get("top_strip")).toEqual({ slot: "top_strip", adIds: ["shipping", "loyalty", "sale_women"] })
    expect(get("grid_tile")).toEqual({ slot: "grid_tile", adIds: ["sale_women", "sale_men"], gridPosition: 2 })
    expect(get("popup")).toMatchObject({ trigger: "scroll_depth", triggerValue: 100 })
    expect(get("interstitial")).toMatchObject({ trigger: "page_count", triggerValue: 1 })
  })

  test("keeps the newsletter popup when there is no model output", () => {
    expect(slots(validateLayout(base()).layout)).toContain("popup")
  })

  test("trims copy, strips markup and URLs, and removes invented prices and percentages", () => {
    const cfg = base()
    cfg.copy = {
      intro: `<b>Up to 70% off</b> everything! See https://example.com for more. ${"Long copy. ".repeat(40)}`,
      story: "Shipping is free over $150 and the rib tee is $22, not $19.",
      adOverrides: {
        sale_women: { headline: "Huge sale!!! Save 55% on all the women's pieces today only", cta: "<a href='x'>Go</a>" },
        shipping: { headline: "   " },
      },
    }
    const { layout } = validateLayout(cfg)
    const intro = layout.copy.intro ?? ""
    expect(intro.length).toBeLessThanOrEqual(200)
    expect(intro).not.toMatch(/70%|<b>|https?:|example\.com|!/)
    expect(layout.copy.story).toContain("$150")
    expect(layout.copy.story).toContain("$22")
    expect(layout.copy.story).not.toContain("$19")
    const sale = layout.copy.adOverrides?.sale_women
    expect(sale?.headline?.length).toBeLessThanOrEqual(40)
    expect(sale?.headline).not.toMatch(/55%|!/)
    expect(sale?.cta).toBe("Go")
    expect(layout.copy.adOverrides?.shipping).toBeUndefined()
  })

  test("fills a hero block with no hero ad, and drops a hero ad with no hero block", () => {
    const cfg = base()
    cfg.ads.placements = cfg.ads.placements.filter((p) => p.slot !== "hero")
    const filled = validateLayout(cfg).layout
    expect(filled.ads.placements.find((p) => p.slot === "hero")?.adIds).toEqual(["collection_women"])
    expect(filled.home.blocks[0]?.type).toBe("hero")

    const noHero = base()
    noHero.home.blocks = noHero.home.blocks.filter((b) => b.type !== "hero")
    expect(slots(validateLayout(noHero).layout)).not.toContain("hero")
  })

  test("moves the hero to the top and enforces block counts and unique row sources", () => {
    const cfg = base()
    cfg.home.blocks = [
      { type: "product_row", source: { kind: "new_in" }, limit: 4 },
      { type: "hero" },
      { type: "product_row", source: { kind: "new_in" }, limit: 8 },
      { type: "product_row", source: { kind: "buy_again" }, limit: 4 },
    ]
    const { layout } = validateLayout(cfg)
    expect(layout.home.blocks[0]).toEqual({ type: "hero" })
    const kinds = layout.home.blocks.flatMap((b) => (b.type === "product_row" ? [b.source.kind] : []))
    expect(kinds.filter((k) => k === "new_in")).toHaveLength(1)
    expect(kinds).not.toContain("buy_again")
    expect(layout.home.blocks.length).toBeGreaterThanOrEqual(3)

    cfg.home.blocks = Array.from({ length: 12 }, (_, i) => ({
      type: "product_row" as const,
      source: { kind: "under_price" as const, max: 50 as const },
      title: `Row ${i}`,
      limit: 4 as const,
    }))
    expect(validateLayout(cfg).layout.home.blocks.length).toBeLessThanOrEqual(8)
  })

  test("drops category tiles and rows the department can't fill", () => {
    const cfg = base()
    cfg.nav.department = "men"
    cfg.home.blocks = [
      { type: "hero" },
      { type: "category_tiles", categories: ["dresses", "skirts", "shoes"] },
      { type: "product_row", source: { kind: "category", category: "dresses" }, limit: 4 },
      { type: "product_row", source: { kind: "new_in" }, limit: 4 },
    ]
    const { layout } = validateLayout(cfg)
    const tiles = layout.home.blocks.find((b) => b.type === "category_tiles")
    expect(tiles?.type === "category_tiles" && tiles.categories).toEqual(["tshirts", "shirts", "shoes"])
    expect(layout.home.blocks.some((b) => b.type === "product_row" && b.source.kind === "category")).toBe(false)
  })

  test("nav keeps a department link and 3–6 unique items", () => {
    const cfg = base()
    cfg.nav.order = ["sale", "sale", "for_you"]
    cfg.nav.highlight = "collections"
    const { layout } = validateLayout(cfg)
    expect(layout.nav.order).toEqual(["women", "sale", "men"])
    expect(layout.nav.highlight).toBeNull()
  })

  test("LLM-shaped output (no copied fields) is accepted", () => {
    const llm = structuredClone(DEFAULT_LAYOUT) as Partial<LayoutConfig> & Record<string, unknown>
    const home = llm.home as Record<string, unknown>
    delete home.forYouIds
    delete home.basketIds
    delete (llm.listing as Record<string, unknown>).categoryOrder
    expect(LlmLayoutSchema.safeParse(llm).success).toBe(true)
    expect(validateLayout(llm).report.fellBack).toBe(false)
  })

  test("LLM reasons without model output can't cite numbers", () => {
    const cfg = base()
    cfg.reasons = [
      { field: "nav.order", source: "llm", text: "80% of purchases are menswear" },
      { field: "home.blocks", source: "llm", text: "Sale rows first for a sale shopper" },
      { field: "listing.defaultSort", source: "model", modelDecision: "default_sort", text: "x" },
    ]
    const { layout } = validateLayout(cfg)
    expect(layout.reasons).toEqual([{ field: "home.blocks", source: "llm", text: "Sale rows first for a sale shopper" }])
  })

  test("the LLM schema converts to JSON Schema", () => {
    const schema = z.toJSONSchema(LlmLayoutSchema) as { properties: Record<string, unknown> }
    expect(Object.keys(schema.properties)).toEqual(["version", "nav", "home", "listing", "ads", "copy", "checkout", "concierge", "reasons"])
  })
})

describe("validator with model output", () => {
  const model = fixtureModel("fixture-men-sale")
  const modelBase = () => modelLayout(model.doc, model.basketIds)

  test("keeps the model's section rows in section_order, other blocks stay put", () => {
    const cfg = modelBase()
    cfg.home.blocks = [
      { type: "hero" },
      { type: "product_row", source: { kind: "new_in" }, limit: 4 },
      { type: "collection_spotlight", collection: "Essentials" },
      { type: "product_row", source: { kind: "bestsellers" }, limit: 4 },
      { type: "product_row", source: { kind: "sale" }, limit: 8 },
    ]
    const { layout, report } = validateLayout(cfg, { model })
    const kinds = layout.home.blocks.map((b) => (b.type === "product_row" ? b.source.kind : b.type))
    expect(kinds).toEqual(["hero", "sale", "collection_spotlight", "bestsellers", "new_in"])
    expect(report.changes.join(" ")).toMatch(/section_order/)
  })

  test("category tiles and the category filter follow category_order", () => {
    const women = fixtureModel("fixture-women-new")
    const cfg = modelLayout(women.doc, women.basketIds)
    cfg.listing.categoryOrder = [...CATEGORIES].reverse()
    cfg.home.blocks = [{ type: "hero" }, { type: "category_tiles", categories: ["coats", "jeans", "dresses", "shirts"] }, { type: "product_row", source: { kind: "new_in" }, limit: 8 }]
    const { layout } = validateLayout(cfg, { model: women })
    expect(layout.listing.categoryOrder[0]).toBe("dresses")
    const tiles = layout.home.blocks.find((b) => b.type === "category_tiles")
    expect(tiles?.type === "category_tiles" && tiles.categories).toEqual(["dresses", "shirts", "coats", "jeans"])
  })

  test("the newsletter is removed unless the model's popups is on; other popups are the LLM's choice", () => {
    const cfg = modelBase()
    cfg.ads.placements.push({ slot: "popup", adIds: ["newsletter"], trigger: "delay", triggerValue: 1000 })
    expect(validateLayout(cfg, { model }).layout.ads.placements.some((p) => p.slot === "popup")).toBe(false)

    const on = structuredClone(model)
    on.doc.layout.popups = { ...on.doc.layout.popups, value: "on" }
    expect(validateLayout(cfg, { model: on }).layout.ads.placements.find((p) => p.slot === "popup")?.adIds).toEqual(["newsletter"])

    const offer = modelBase()
    offer.ads.placements.push({ slot: "popup", adIds: ["offer_men"], trigger: "exit_intent" })
    expect(validateLayout(offer, { model }).layout.ads.placements.find((p) => p.slot === "popup")?.adIds).toEqual(["offer_men"])
  })

  test("fills an empty hero from the model's hero decision", () => {
    const cfg = modelBase()
    cfg.ads.placements = cfg.ads.placements.filter((p) => p.slot !== "hero")
    expect(validateLayout(cfg, { model }).layout.ads.placements.find((p) => p.slot === "hero")?.adIds).toEqual(["sale_men"])
  })

  test("model reasons get the model's text; LLM reasons may cite only numbers from the model output", () => {
    const cfg = modelBase()
    cfg.reasons = [
      { field: "nav.department", source: "model", modelDecision: "landing_department", text: "made up", class: "Tested" },
      { field: "ads.placements", source: "llm", text: "Offer popup: sale is 41% of next picks" },
      { field: "home.blocks", source: "llm", text: "Sale rows first: 90% of shoppers love sales" },
    ]
    const { layout } = validateLayout(cfg, { model })
    expect(layout.reasons.map((r) => r.field)).toEqual(["nav.department", "ads.placements"])
    expect(layout.reasons[0]?.text).toBe(model.doc.layout.landing_department.reason)
  })

  test("a broken LLM config falls back to the model layout", () => {
    const { layout, report } = llmStage({ version: 2, nav: { order: "men" } }, model)
    expect(report.fellBack).toBe(true)
    expect(layout).toEqual(modelStage(model).layout)
  })

  test("removes products repeated across rows, rows filled top to bottom", () => {
    const cfg = modelBase()
    cfg.nav.department = null
    cfg.home.blocks = [
      { type: "hero" },
      { type: "product_row", source: { kind: "bestsellers" }, limit: 8 },
      { type: "product_row", source: { kind: "under_price", max: 150 }, limit: 8 },
      { type: "product_row", source: { kind: "category", category: "coats" }, limit: 8 },
    ]
    const { layout } = validateLayout(cfg, { model })
    const resolved = resolveHome(layout).flatMap((e) => ("products" in e ? [e.products.map((p) => p.id)] : []))
    const all = resolved.flat()
    expect(new Set(all).size).toBe(all.length)
    expect(resolved[0]).toHaveLength(8)
    expect(sortProducts(PRODUCTS, "bestsellers").slice(0, 8).map((p) => p.id)).toEqual(resolved[0])
  })

  test("department filtering applies to every source except for_you and buy_again", () => {
    const cfg = modelBase()
    cfg.home.blocks.push({ type: "product_row", source: { kind: "under_price", max: 100 }, limit: 8 })
    const { layout } = validateLayout(cfg, { model })
    for (const entry of resolveHome(layout)) {
      if (!("products" in entry)) continue
      const kind = entry.block.source.kind
      if (kind === "for_you" || kind === "buy_again") continue
      expect(entry.products.every((p) => p.department === "men"), kind).toBe(true)
    }
    const forYou = resolveHome(layout).find((e) => "products" in e && e.block.source.kind === "for_you")
    expect(forYou && "products" in forYou && forYou.products.some((p) => p.department === "women")).toBe(true)
  })
})
