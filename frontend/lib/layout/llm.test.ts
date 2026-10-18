import { describe, expect, test } from "vitest"
import { adContent, intrusiveCount, placementFor, tilePositions } from "@/lib/ads/placement"
import { resolveHome } from "@/lib/layout/home"
import { llmStage, withModelData } from "@/lib/layout/pipeline"
import { DEFAULT_LAYOUT } from "@/lib/layout/presets"
import type { LayoutConfig } from "@/lib/layout/types"
import { LlmLayoutSchema } from "@/lib/layout/schema"
import { fixtureLlm, fixtureModel } from "@/lib/testing/fixtures"

const WITH_LLM = ["fixture-men-sale", "fixture-women-new", "fixture-low-evidence"]

describe("hand-written LLM output through the pipeline", () => {
  test.each(WITH_LLM)("%s is valid LLM output and survives validation", (id) => {
    const raw = fixtureLlm(id)
    expect(LlmLayoutSchema.safeParse(raw).success).toBe(true)
    const { layout, report } = llmStage(raw, fixtureModel(id))
    expect(report.fellBack).toBe(false)
    expect(report.changes).toEqual([])
    expect(layout.reasons.length).toBeGreaterThan(0)
  })

  test("code copies product ids; the LLM never writes them", () => {
    const model = fixtureModel("fixture-men-sale")
    const copied = withModelData(fixtureLlm("fixture-men-sale"), model) as { home: { forYouIds: string[]; basketIds: string[] } }
    expect(copied.home.forYouIds).toEqual(model.doc.store_products?.map((p) => p.product_id))
    expect(copied.home.basketIds).toEqual(model.basketIds)
  })

  test("a high-markdown profile gets a sale hero, sale grid tiles and an offer popup", () => {
    const { layout } = llmStage(fixtureLlm("fixture-men-sale"), fixtureModel("fixture-men-sale"))
    expect(placementFor(layout, "hero")?.adIds[0]).toBe("sale_men")
    expect(placementFor(layout, "grid_tile")?.adIds[0]).toBe("sale_men")
    expect(placementFor(layout, "popup")?.adIds).toEqual(["offer_men"])
    expect(layout.reasons.find((r) => r.field === "nav.order")?.text).toBe(
      "Men and Sale lead the nav: menswear is about 71% of next picks and sale 41%",
    )
  })

  test("a low-evidence profile gets no popup, interstitial or sticky footer", () => {
    const { layout } = llmStage(fixtureLlm("fixture-low-evidence"), fixtureModel("fixture-low-evidence"))
    expect(intrusiveCount(layout)).toBe(0)
  })

  test("the LLM layout keeps the model's section order and repeats no product", () => {
    for (const id of WITH_LLM) {
      const model = fixtureModel(id)
      const { layout } = llmStage(fixtureLlm(id), model)
      const order = model.doc.layout.section_order.value
      const sections = layout.home.blocks.flatMap((b) =>
        b.type === "product_row" && (order as string[]).includes(b.source.kind) ? [b.source.kind] : [],
      )
      expect(sections).toEqual(order.filter((s) => sections.includes(s)))
      const shown = resolveHome(layout).flatMap((e) => ("products" in e ? e.products.map((p) => p.id) : []))
      expect(new Set(shown).size).toBe(shown.length)
    }
  })

  test("a menswear-heavy profile shows Men first and lands collection links in menswear", () => {
    const { layout } = llmStage(fixtureLlm("fixture-men-sale"), fixtureModel("fixture-men-sale"))
    expect(layout.nav.order[0]).toBe("men")
    expect(layout.nav.department).toBe("men")
  })
})

function rows(layout: LayoutConfig) {
  return resolveHome(layout).flatMap((entry) => ("products" in entry ? [entry] : []))
}

describe("two contrasting fixtures", () => {
  const men = llmStage(fixtureLlm("fixture-men-sale"), fixtureModel("fixture-men-sale")).layout
  const women = llmStage(fixtureLlm("fixture-women-new"), fixtureModel("fixture-women-new")).layout

  test("produce different nav order, home blocks and products", () => {
    expect(men.nav.order).not.toEqual(women.nav.order)
    expect(JSON.stringify(men.home.blocks)).not.toEqual(JSON.stringify(women.home.blocks))
    const menProducts = rows(men).flatMap((r) => r.products.map((p) => p.id))
    const womenProducts = rows(women).flatMap((r) => r.products.map((p) => p.id))
    const overlap = menProducts.filter((id) => womenProducts.includes(id))
    expect(overlap.length).toBeLessThan(Math.min(menProducts.length, womenProducts.length) / 4)
    expect(rows(men)[0]?.products.map((p) => p.id)).not.toEqual(rows(women)[0]?.products.map((p) => p.id))
  })

  test("both differ from the house default", () => {
    expect(men).not.toEqual(DEFAULT_LAYOUT)
    expect(women).not.toEqual(DEFAULT_LAYOUT)
  })

  test("department rows only show the shopper's department; buy_again shows the basket", () => {
    const basket = fixtureModel("fixture-men-sale").basketIds
    for (const entry of rows(men)) {
      const kind = entry.block.source.kind
      if (kind === "buy_again") expect(entry.products.every((p) => basket.includes(p.id))).toBe(true)
      else if (kind !== "for_you") expect(entry.products.every((p) => p.department === "men"), kind).toBe(true)
    }
  })
})

test("copy overrides replace the ad's catalog text", () => {
  const { layout } = llmStage(fixtureLlm("fixture-men-sale"), fixtureModel("fixture-men-sale"))
  expect(adContent(layout, "sale_men")).toMatchObject({ headline: "Men's sale, picked for you", cta: "Shop the sale" })
  expect(adContent(layout, "offer_men").headline).toBe("Sale prices on men's pieces")
})

describe("grid tile positions", () => {
  const placement = { slot: "grid_tile" as const, adIds: ["sale_men" as const, "sale_women" as const], gridPosition: 3 }
  test("clamped to 2..(cards - 1), second tile 6 cards later", () => {
    expect(tilePositions(12, placement)).toEqual([3, 9])
    expect(tilePositions(5, placement)).toEqual([3, 4])
    expect(tilePositions(4, { ...placement, gridPosition: 0 })).toEqual([2, 3])
    expect(tilePositions(2, placement)).toEqual([])
    expect(tilePositions(12, undefined)).toEqual([])
  })
})
