import { describe, expect, test } from "vitest"
import { forYouIds, rankCatalog } from "@/lib/model/adapter"
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

describe("For You data copied from the model", () => {
  test("for_you comes from store_products, without basket items", () => {
    const model = fixtureModel("fixture-men-sale")
    expect(forYouIds(model.doc, model.basketIds)).toEqual(model.doc.store_products?.map((p) => p.product_id))
  })

  test("without store_products, rankCatalog fills for_you", () => {
    const model = fixtureModel("fixture-men-sale")
    const doc = { ...model.doc, store_products: undefined }
    const ids = forYouIds(doc, model.basketIds)
    expect(ids).toHaveLength(24)
    expect(ids.some((id) => model.basketIds.includes(id))).toBe(false)
    expect(rankCatalog(PRODUCTS, doc)[0]?.department).toBe("men")
  })
})
