import { describe, expect, test } from "vitest"
import { adContent, intrusiveCount, placementFor, tilePositions } from "@/lib/ads/placement"
import { resolveHome } from "@/lib/layout/home"
import { llmStage, modelStage, withModelData } from "@/lib/layout/pipeline"
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

  test("the LLM layout differs from the model layout it builds on", () => {
    const model = fixtureModel("fixture-women-new")
    expect(llmStage(fixtureLlm("fixture-women-new"), model).layout).not.toEqual(modelStage(model).layout)
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
