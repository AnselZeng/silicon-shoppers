import { describe, expect, test } from "vitest"
import { cloneLayout, DEFAULT_LAYOUT } from "@/lib/layout/presets"
import { applyChatIntent } from "@/lib/store/chatIntent"

describe("a concierge sentence becomes layout edits", () => {
  test("each change is reported once", () => {
    const applied = applyChatIntent("make it more men friendly, navy first", cloneLayout(DEFAULT_LAYOUT))
    expect(applied).not.toBeNull()
    expect(new Set(applied!.changes).size).toBe(applied!.changes.length)
    expect(applied!.changes.filter((change) => change.includes("navy"))).toEqual(["navy colors forward"])
    expect(applied!.layout.listing.colorHighlight).toEqual(["navy"])
    expect(applied!.layout.nav.order[0]).toBe("men")
  })

  test("a plain question changes nothing", () => {
    expect(applyChatIntent("why am I seeing this shirt?", cloneLayout(DEFAULT_LAYOUT))).toBeNull()
  })
})
