import { describe, expect, it } from "vitest"

import { layoutChanges, replayLines, type ReplayEvent, type ReplayLayout } from "@/lib/sim/replay"

const events: ReplayEvent[] = [
  { ts: "2026-10-18 11:20:35.128", type: "page_view", properties: { path: "/store" } },
  { ts: "2026-10-18 11:20:40.000", type: "add_to_bag", properties: { productId: "m-navy-tee", price: 42 } },
  { ts: "2026-10-18 11:24:10.000", type: "concierge_query", properties: { q: "navy first" } },
]

function layout(ts: string, nEvents: number, decisions: Record<string, unknown>, persona: string | null = null): ReplayLayout {
  return { ts, runId: `refresh-${ts}`, nEvents, persona, confidence: persona ? "medium" : null, decisions }
}

describe("layoutChanges", () => {
  it("lists only the decisions whose value moved", () => {
    const a = layout("1", 2, { default_sort: "relevance", landing_department: "women", category_order: ["tops", "jeans"] })
    const b = layout("2", 9, { default_sort: "price_asc", landing_department: "women", category_order: ["jeans", "tops"] })
    expect(layoutChanges(a, b)).toEqual(["default_sort relevance -> price_asc", "category_order tops/jeans -> jeans/tops"])
  })

  it("has nothing to compare for the first version", () => {
    expect(layoutChanges(null, layout("1", 2, { default_sort: "relevance" }))).toEqual([])
  })
})

describe("replayLines", () => {
  const layouts = [
    layout("2026-10-18 11:20:40.000", 2, { default_sort: "relevance" }),
    layout("2026-10-18 11:23:54.772", 2, { default_sort: "relevance" }, "Price Hunter"),
    layout("2026-10-18 11:27:54.000", 3, { default_sort: "price_asc" }, "Price Hunter"),
  ]
  const lines = replayLines(events, layouts)

  it("merges events and layout versions in time order", () => {
    expect(lines.map((l) => l.ts)).toEqual([...lines.map((l) => l.ts)].sort())
    expect(lines).toHaveLength(6)
  })

  it("puts a layout written at the same instant after the event it read", () => {
    const at = lines.filter((l) => l.ts === "2026-10-18 11:20:40.000")
    expect(at.map((l) => l.source)).toEqual(["tracker", "layout"])
  })

  it("says what each layout version changed and who the shopper was", () => {
    const written = lines.filter((l) => l.source === "layout").map((l) => l.message)
    expect(written[0]).toBe("layout v1 · no persona yet · 2 events seen · first layout")
    expect(written[1]).toBe("layout v2 · Price Hunter (medium) · 2 events seen · no decision changed")
    expect(written[2]).toBe("layout v3 · Price Hunter (medium) · 3 events seen · default_sort relevance -> price_asc")
  })

  it("files concierge events under the llm channel", () => {
    expect(lines.find((l) => l.message.startsWith("concierge_query"))?.source).toBe("llm")
    expect(lines.find((l) => l.message.startsWith("add_to_bag"))?.message).toBe("add_to_bag productId=m-navy-tee price=42")
  })

  it("is empty for a shopper with nothing stored", () => {
    expect(replayLines([], [])).toEqual([])
  })
})
