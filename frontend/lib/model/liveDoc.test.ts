import { describe, expect, test } from "vitest"
import { draftFromLive, sameMix } from "@/lib/model/liveDoc"
import { fromIntent } from "@/lib/model/storeLayout"
import { fixtureModel } from "@/lib/testing/fixtures"

describe("stored document feeds the panel", () => {
  test("slider draft copies the mix stored on the laptop document", () => {
    const base = fixtureModel("fixture-women-new").doc
    const stored = fromIntent({
      departments: ["dept_menswear"],
      priority: "price",
      budget: null,
      summary: "men",
      source: "keywords",
    })
    stored.model_meta = { predicted_mix: base.predicted_mix, browsing: base.browsing }
    const draft = draftFromLive(base, stored)
    expect(draft).not.toBeNull()
    expect(sameMix(draft!.predicted_mix, base.predicted_mix)).toBe(true)
    expect(draft!.user_id).toBe(stored.shopper.id)
    expect(draft!.layout.landing_department.value).toBe("dept_ladieswear")
  })

  test("a document with no mix cannot drive the sliders", () => {
    const base = fixtureModel("fixture-men-sale").doc
    const stored = fromIntent({
      departments: ["dept_menswear"],
      priority: "none",
      budget: null,
      summary: "men",
      source: "keywords",
    })
    expect(draftFromLive(base, stored)).toBeNull()
  })
})
