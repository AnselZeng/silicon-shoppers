import { describe, expect, test } from "vitest"
import { resolveHome } from "@/lib/layout/home"
import { modelStage } from "@/lib/layout/pipeline"
import type { LayoutConfig } from "@/lib/layout/types"
import { validateLayout } from "@/lib/layout/validate"
import { forYouIds, modelLayout, rankCatalog } from "@/lib/model/adapter"
import type { HMDepartment, HomepageDoc } from "@/lib/model/homepage"
import { APP_TO_HM_CATEGORY, HM_TO_APP_CATEGORIES, HM_TO_APP_COLOR, HM_TO_APP_DEPARTMENT } from "@/lib/model/mapping"
import { heroAdFor, modelCategoryOrder, modelDepartment } from "@/lib/model/policy"
import { PRODUCTS } from "@/lib/store/catalog"
import { CATEGORIES } from "@/lib/store/types"
import { fixtureEntries, fixtureModel } from "@/lib/testing/fixtures"

const IDS = ["fixture-men-sale", "fixture-women-new", "fixture-low-evidence", "fixture-divided"]

function withDept(doc: HomepageDoc, dept: HMDepartment): HomepageDoc {
  return { ...doc, layout: { ...doc.layout, landing_department: { ...doc.layout.landing_department, value: dept } } }
}

describe("H&M -> store mapping (ported from the backend)", () => {
  test("departments: Ladieswear and Divided are women, Menswear is men, the rest ignored", () => {
    expect(HM_TO_APP_DEPARTMENT).toEqual({ dept_ladieswear: "women", dept_divided: "women", dept_menswear: "men" })
    const doc = fixtureModel("fixture-divided").doc
    expect(doc.layout.landing_department.value).toBe("dept_divided")
    expect(modelDepartment(doc)).toBe("women")
    expect(modelDepartment(withDept(doc, "dept_sport"))).toBeNull()
    expect(modelDepartment(withDept(doc, "dept_baby_children"))).toBeNull()
    expect(modelLayout(withDept(doc, "dept_sport")).nav.department).toBeNull()
  })

  test("every store category maps to exactly one H&M group and back", () => {
    for (const category of CATEGORIES) {
      const hm = APP_TO_HM_CATEGORY[category]
      expect(HM_TO_APP_CATEGORIES[hm]).toContain(category)
    }
    expect(HM_TO_APP_CATEGORIES.cat_garment_full_body).toEqual(["dresses"])
    expect(HM_TO_APP_CATEGORIES.cat_swimwear).toEqual([])
  })

  test("colors match the backend table", () => {
    expect(HM_TO_APP_COLOR).toMatchObject({ Blue: "navy", "Khaki green": "olive", Red: "burgundy", Mole: "brown" })
  })

  test("category order expands H&M groups and keeps unmapped categories at the end", () => {
    const order = modelCategoryOrder(fixtureModel("fixture-women-new").doc)
    expect(order[0]).toBe("dresses")
    expect(order.slice(1, 6)).toEqual(["tshirts", "shirts", "knitwear", "jackets", "coats"])
    expect([...order].sort()).toEqual([...CATEGORIES].sort())
  })

  test("model hero -> house ad", () => {
    expect(heroAdFor("discount", "men")).toBe("sale_men")
    expect(heroAdFor("new_drop", "women")).toBe("new_women")
    expect(heroAdFor("category", "women", "cat_garment_full_body")).toBe("cat_full_women")
    expect(heroAdFor("category", "men", "cat_garment_full_body")).toBe("collection_men")
    expect(heroAdFor("category", "women", "cat_shoes")).toBe("collection_women")
    expect(heroAdFor("editorial", null)).toBe("collection_women")
  })
})

describe("fixtures follow build_docs", () => {
  test.each(IDS)("%s", (id) => {
    const { doc, basketIds } = fixtureModel(id)
    expect(doc.demo_id).toBe(id)
    expect(doc.layout.popups.value).toBe("off")
    expect(doc.layout.category_order.validated).toBe(true)
    expect(doc.layout.section_order.validated).toBe(true)
    expect(doc.layout.landing_department.validated).toBe(false)
    const ids = (doc.store_products ?? []).map((p) => p.product_id)
    expect(ids.length).toBeLessThanOrEqual(24)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((pid) => PRODUCTS.some((p) => p.id === pid))).toBe(true)
    expect(ids.some((pid) => basketIds.includes(pid))).toBe(false)
    expect(new Set(ids).size).toBe(ids.length)
    expect(basketIds.every((pid) => PRODUCTS.some((p) => p.id === pid))).toBe(true)
  })

  test("the index lists all four", () => {
    expect(fixtureEntries().map((f) => f.id)).toEqual(IDS)
  })
})

describe("model layout", () => {
  test.each(IDS)("%s passes the validator unchanged", (id) => {
    const model = fixtureModel(id)
    const { layout, report } = modelStage(model)
    expect(report.fellBack).toBe(false)
    expect(report.changes).toEqual([])
    expect(validateLayout(layout, { model }).report.changes).toEqual([])
  })

  test("for_you comes from store_products, without basket items", () => {
    const model = fixtureModel("fixture-men-sale")
    const layout = modelLayout(model.doc, model.basketIds)
    expect(layout.home.forYouIds).toEqual(model.doc.store_products?.map((p) => p.product_id))
    expect(layout.home.basketIds).toEqual(model.basketIds)
  })

  test("without store_products, rankCatalog fills for_you", () => {
    const model = fixtureModel("fixture-men-sale")
    const doc = { ...model.doc, store_products: undefined }
    const ids = forYouIds(doc, model.basketIds)
    expect(ids).toHaveLength(24)
    expect(ids.some((id) => model.basketIds.includes(id))).toBe(false)
    expect(rankCatalog(PRODUCTS, doc)[0]?.department).toBe("men")
  })

  test("reasons are the model's own strings and class labels", () => {
    const { doc } = fixtureModel("fixture-low-evidence")
    const { layout } = modelStage(fixtureModel("fixture-low-evidence"))
    const department = layout.reasons.find((r) => r.field === "nav.department")
    expect(department).toMatchObject({ source: "model", text: doc.layout.landing_department.reason, class: "Tested" })
    expect(layout.reasons.every((r) => r.source === "model")).toBe(true)
  })

  test("a menswear-heavy profile shows Men first and lands collection links in menswear", () => {
    const { layout } = modelStage(fixtureModel("fixture-men-sale"))
    expect(layout.nav.order[0]).toBe("men")
    expect(layout.nav.department).toBe("men")
    expect(layout.ads.placements.find((p) => p.slot === "hero")?.adIds).toEqual(["sale_men"])
  })
})

function rows(layout: LayoutConfig) {
  return resolveHome(layout).flatMap((entry) => ("products" in entry ? [entry] : []))
}

describe("two contrasting fixtures", () => {
  const men = modelStage(fixtureModel("fixture-men-sale")).layout
  const women = modelStage(fixtureModel("fixture-women-new")).layout

  test("produce different nav order, home blocks and products", () => {
    expect(men.nav.order).not.toEqual(women.nav.order)
    expect(JSON.stringify(men.home.blocks)).not.toEqual(JSON.stringify(women.home.blocks))
    const menProducts = rows(men).flatMap((r) => r.products.map((p) => p.id))
    const womenProducts = rows(women).flatMap((r) => r.products.map((p) => p.id))
    const overlap = menProducts.filter((id) => womenProducts.includes(id))
    expect(overlap.length).toBeLessThan(Math.min(menProducts.length, womenProducts.length) / 4)
    const menTop = rows(men)[0]?.products.slice(0, 8).map((p) => p.id)
    const womenTop = rows(women)[0]?.products.slice(0, 8).map((p) => p.id)
    expect(menTop).not.toEqual(womenTop)
  })

  test("keep the model's section rows in the model's order, with no product repeated", () => {
    for (const [id, layout] of [["fixture-men-sale", men], ["fixture-women-new", women]] as const) {
      const order = fixtureModel(id).doc.layout.section_order.value
      const sections = layout.home.blocks.flatMap((b) =>
        b.type === "product_row" && b.source.kind !== "for_you" ? [b.source.kind] : [],
      )
      expect(sections).toEqual(order.filter((s) => sections.includes(s)))
      const shown = rows(layout).flatMap((r) => r.products.map((p) => p.id))
      expect(new Set(shown).size).toBe(shown.length)
    }
  })

  test("department rows only show the shopper's department; buy_again shows the basket", () => {
    for (const entry of rows(men)) {
      const kind = entry.block.source.kind
      if (kind === "buy_again") {
        expect(entry.products.every((p) => fixtureModel("fixture-men-sale").basketIds.includes(p.id))).toBe(true)
      } else if (kind !== "for_you") {
        expect(entry.products.every((p) => p.department === "men")).toBe(true)
      }
    }
  })
})
