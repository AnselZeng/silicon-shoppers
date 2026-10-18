import { describe, expect, test } from "vitest"
import { blockName } from "@/lib/layout/home"
import { DEFAULT_LAYOUT, cloneLayout } from "@/lib/layout/presets"
import { layoutSteps } from "@/lib/layout/steps"
import { validateLayout } from "@/lib/layout/validate"
import { fixtureLlm, fixtureModel } from "@/lib/testing/fixtures"

function personalized(id: string) {
  return validateLayout(fixtureLlm(id), { model: fixtureModel(id) }).layout
}

describe("layoutSteps", () => {
  test("no steps when nothing changes", () => {
    expect(layoutSteps(DEFAULT_LAYOUT, cloneLayout(DEFAULT_LAYOUT))).toEqual([])
  })

  test("ends exactly on the target, nav first", () => {
    const to = personalized("fixture-men-sale")
    const steps = layoutSteps(DEFAULT_LAYOUT, to)
    expect(steps.length).toBeGreaterThan(1)
    expect(steps.at(-1)?.layout).toBe(to)
    if (JSON.stringify(DEFAULT_LAYOUT.nav) !== JSON.stringify(to.nav)) {
      expect(steps[0].label).toMatch(/^nav/)
      expect(steps[0].layout.nav).toEqual(to.nav)
      expect(steps[0].layout.home).toEqual(DEFAULT_LAYOUT.home)
    }
  })

  test("every intermediate layout keeps the hero first and has no repeated block", () => {
    for (const id of ["fixture-men-sale", "fixture-women-new", "fixture-low-evidence"]) {
      const to = personalized(id)
      for (const [from, target] of [
        [DEFAULT_LAYOUT, to],
        [to, DEFAULT_LAYOUT],
      ]) {
        for (const step of layoutSteps(from, target)) {
          const names = step.layout.home.blocks.map(blockName)
          expect(names[0]).toBe("hero")
          expect(new Set(names).size).toBe(names.length)
        }
      }
    }
  })

  test("tags new and moved blocks", () => {
    const from = cloneLayout(DEFAULT_LAYOUT)
    const to = cloneLayout(DEFAULT_LAYOUT)
    const [hero, ...rest] = to.home.blocks
    to.home.blocks = [hero, ...rest.reverse()]
    to.home.blocks.push({ type: "editorial_text", copyKey: "story" })
    const flash = Object.assign({}, ...layoutSteps(from, to).map((step) => step.flash))
    expect(flash["copy-story"]).toBe("New")
    expect(flash[blockName(to.home.blocks[1])]).toBe("Moving up")
  })

  test("scrolls to the first block position that changes", () => {
    const from = cloneLayout(DEFAULT_LAYOUT)
    const to = cloneLayout(DEFAULT_LAYOUT)
    const blocks = to.home.blocks
    to.home.blocks = [blocks[0], blocks[1], blocks[3], blocks[2], blocks[4]]
    const steps = layoutSteps(from, to)
    expect(steps).toHaveLength(1)
    expect(steps[0].focus).toBe(blockName(from.home.blocks[2]))
    to.nav.order = ["men", "women", "new_in", "sale", "collections"]
    expect(layoutSteps(from, to)[0].focus).toBe("top")
  })

  test("marks a replaced ad, but not one that appears or stays the same", () => {
    const from = cloneLayout(DEFAULT_LAYOUT)
    const to = cloneLayout(DEFAULT_LAYOUT)
    to.ads.placements = to.ads.placements.map((p) => (p.slot === "hero" ? { ...p, adIds: ["shipping"] } : p))
    expect(layoutSteps(from, to)[0].adSwaps).toEqual(["hero"])
    to.ads.placements = to.ads.placements.filter((p) => p.slot !== "hero")
    expect(layoutSteps(from, to)[0].adSwaps).toEqual([])
  })
})
