import { describe, expect, it } from "vitest"

import { DEFAULT_LAYOUT } from "@/lib/layout/presets"
import { FORGET_RE, mergeStatements, statementsFrom, STATEMENTS_MAX } from "@/lib/model/statements"
import { applyChatIntent } from "@/lib/store/chatIntent"

describe("statementsFrom: what the shopper told the concierge, read back from events", () => {
  it("returns statements oldest first", () => {
    expect(statementsFrom([{ q: "make it more men friendly" }, { q: "prioritize navy blue" }])).toEqual([
      "make it more men friendly",
      "prioritize navy blue",
    ])
  })

  it("skips events stored before statements were kept", () => {
    expect(statementsFrom([{}, { q: "" }, { q: 7 }, { q: "navy first" }])).toEqual(["navy first"])
  })

  it("drops everything said before a forget", () => {
    expect(statementsFrom([{ q: "men friendly" }, { forget: true }, { q: "navy first" }])).toEqual(["navy first"])
    expect(statementsFrom([{ q: "men friendly" }, { forget: true }])).toEqual([])
  })

  it("moves a repeated statement to the end instead of keeping it twice", () => {
    expect(statementsFrom([{ q: "navy first" }, { q: "men friendly" }, { q: "navy first" }])).toEqual([
      "men friendly",
      "navy first",
    ])
  })

  it("keeps only the newest few", () => {
    const many = Array.from({ length: STATEMENTS_MAX + 3 }, (_, i) => ({ q: `statement ${i}` }))
    const kept = statementsFrom(many)
    expect(kept).toHaveLength(STATEMENTS_MAX)
    expect(kept.at(-1)).toBe(`statement ${STATEMENTS_MAX + 2}`)
  })
})

describe("mergeStatements", () => {
  it("puts what was said this visit after what was stored", () => {
    expect(mergeStatements(["a", "b"], ["c"])).toEqual(["a", "b", "c"])
    expect(mergeStatements(["a", "b"], ["a"])).toEqual(["b", "a"])
  })
})

describe("FORGET_RE", () => {
  it("matches a request to forget", () => {
    for (const s of ["forget that", "forget what I told you", "reset my preferences", "please clear my prefs.", "Forget everything"]) {
      expect(FORGET_RE.test(s), s).toBe(true)
    }
  })

  it("leaves shopping messages alone", () => {
    for (const s of ["clear jeans in navy", "reset", "forget it, show me navy shoes", "undo the last item in my bag", "i forgot my size"]) {
      expect(FORGET_RE.test(s), s).toBe(false)
    }
  })
})

describe("a remembered statement rebuilds the same layout on a later visit", () => {
  it("re-applies each statement in order, the newest having the last word", () => {
    const said = ["make it more men friendly", "prioritize navy blue"]
    // this visit: each statement applied as it was typed
    let live = structuredClone(DEFAULT_LAYOUT)
    for (const q of said) live = applyChatIntent(q, live)!.layout
    // next visit: the stored statements replayed onto a fresh layout
    let later = structuredClone(DEFAULT_LAYOUT)
    for (const q of statementsFrom(said.map((q) => ({ q })))) later = applyChatIntent(q, later)!.layout
    expect(later).toEqual(live)
    expect(later.nav.order[0]).toBe("men")
    expect(later.listing.colorHighlight).toContain("navy")
  })
})
