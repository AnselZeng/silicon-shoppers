import { beforeEach, describe, expect, test, vi } from "vitest"
import { cloneLayout, DEFAULT_LAYOUT } from "@/lib/layout/presets"
import { PRODUCTS } from "@/lib/store/catalog"
import { captureCheckout } from "@/lib/store/actions"
import { confirmReply, runChatActions, shopperConfirmed, splitActions } from "@/lib/store/agent"
import { applyChatIntent } from "@/lib/store/chatIntent"
import { useStorefront } from "@/lib/store/storeState"

describe("splitActions", () => {
  test("plain text passes through untouched", () => {
    const { text, actions } = splitActions("The rib tee is $22.")
    expect(text).toBe("The rib tee is $22.")
    expect(actions).toEqual([])
  })

  test("parses the canonical marker and strips it from the text", () => {
    const { text, actions } = splitActions(
      'Added it! <<<ACTIONS>>>[{"action":"add_to_bag","productId":"m-navy-tee","color":"navy"}]',
    )
    expect(text).toBe("Added it!")
    expect(actions).toEqual([{ action: "add_to_bag", productId: "m-navy-tee", color: "navy" }])
  })

  test("tolerates loose markers (<ACTIONS>, <ACTIONS>>>)", () => {
    for (const marker of ["<ACTIONS>", "<ACTIONS>>>", "<<<<ACTIONS>>>>", "< ACTIONS >>>"]) {
      const { text, actions } = splitActions(`Done. ${marker}[{"action":"checkout"}]`)
      expect(text).toBe("Done.")
      expect(actions).toEqual([{ action: "checkout" }])
    }
  })

  test("malformed actions JSON still yields clean text and no actions", () => {
    const { text, actions } = splitActions("Done. <<<ACTIONS>>>[{not json")
    expect(text).toBe("Done.")
    expect(actions).toEqual([])
  })

  test("a partial marker mid-stream is hidden", () => {
    expect(splitActions("Checking<<<ACT").text).toBe("Checking")
  })

  test("unknown action types are dropped", () => {
    const { actions } = splitActions('x <<<ACTIONS>>>[{"action":"delete_store"},{"action":"checkout"}]')
    expect(actions).toEqual([{ action: "checkout" }])
  })
})

describe("confirmReply / shopperConfirmed", () => {
  test("affirmatives and negatives classify to yes/no", () => {
    for (const m of ["yes", "yeah im done", "I'm done", "that's all", "check me out", "let's pay", "nothing else", "all set"]) {
      expect(confirmReply(m)).toBe("yes")
    }
    for (const m of ["no", "nope", "nah", "not yet", "keep shopping", "more"]) {
      expect(confirmReply(m)).toBe("no")
    }
    expect(confirmReply("can you also find me a belt")).toBeNull()
    expect(confirmReply("purchase navy blue medium tshirt")).toBeNull()
  })

  test("shopping requests never count as a checkout confirmation", () => {
    expect(shopperConfirmed("yeah im done")).toBe(true)
    expect(shopperConfirmed("add that and check me out")).toBe(true)
    expect(shopperConfirmed("purchase navy blue medium tshirt")).toBe(false)
    expect(shopperConfirmed("nope")).toBe(false)
    expect(shopperConfirmed("why am i seeing this shirt")).toBe(false)
  })
})

describe("applyChatIntent", () => {
  test("men + navy: switches department, nav order and color highlight", () => {
    const applied = applyChatIntent("make it more men friendly and focus on navy", cloneLayout(DEFAULT_LAYOUT))
    expect(applied).not.toBeNull()
    expect(applied!.layout.nav.department).toBe("men")
    expect(applied!.layout.nav.order[0]).toBe("men")
    expect(applied!.layout.listing.colorHighlight).toEqual(["navy"])
  })

  test("budget talk sorts by price and emphasizes sale", () => {
    const applied = applyChatIntent("only show me stuff under $50", cloneLayout(DEFAULT_LAYOUT))
    expect(applied!.layout.listing.defaultSort).toBe("price_asc")
    expect(applied!.layout.listing.card.priceStyle).toBe("sale_emphasis")
  })

  test("a plain question changes nothing", () => {
    expect(applyChatIntent("why am i seeing this shirt?", cloneLayout(DEFAULT_LAYOUT))).toBeNull()
  })
})

describe("runChatActions", () => {
  beforeEach(() => {
    useStorefront.setState({ bag: [], bagOpen: false, checkoutPhase: "idle", visaSession: null, agentAutoPay: true })
  })

  const tee = PRODUCTS.find((p) => p.id === "m-navy-tee") ?? PRODUCTS[0]

  test("adds a catalog product by id, honoring color and size", () => {
    const result = runChatActions([{ action: "add_to_bag", productId: tee.id, color: tee.colors[0], size: tee.sizes[0] }], vi.fn())
    expect(result.done[0]).toContain(tee.name)
    const line = useStorefront.getState().bag[0]
    expect(line.productId).toBe(tee.id)
    expect(line.color).toBe(tee.colors[0])
    expect(line.size).toBe(tee.sizes[0])
  })

  test("accepts a product name when the model sends one instead of an id", () => {
    const result = runChatActions([{ action: "add_to_bag", productId: tee.name }], vi.fn())
    expect(result.done[0]).toContain(tee.name)
    expect(useStorefront.getState().bag[0].productId).toBe(tee.id)
  })

  test("a hallucinated product reports failed instead of silently dropping", () => {
    const result = runChatActions([{ action: "add_to_bag", productId: "p-999-imaginary" }], vi.fn())
    expect(result.done).toEqual([])
    expect(result.failed[0]).toContain("p-999-imaginary")
    expect(useStorefront.getState().bag).toEqual([])
  })

  test("checkout on an empty bag is skipped, not paid", () => {
    const result = runChatActions([{ action: "checkout" }], vi.fn())
    expect(useStorefront.getState().checkoutPhase).toBe("idle")
    expect(result.checkedOut).toBe(false)
    expect(result.checkoutSkipped).toBe(true)
    expect(result.done).toEqual([])
  })

  test("successful add and checkout report through added/checkedOut", () => {
    vi.useFakeTimers()
    try {
      const result = runChatActions([{ action: "add_to_bag", productId: tee.id }], vi.fn())
      expect(result.added).toHaveLength(1)
      expect(result.added[0]).toContain(tee.name)
      const out = runChatActions([{ action: "checkout" }], vi.fn())
      expect(out.checkedOut).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  test("post-purchase: same conversation can add and check out again", () => {
    vi.useFakeTimers()
    try {
      runChatActions([{ action: "add_to_bag", productId: tee.id }, { action: "checkout" }], vi.fn())
      vi.advanceTimersByTime(2000)
      const first = useStorefront.getState().order
      expect(useStorefront.getState().bag).toEqual([])
      // Second round in the same chat.
      const other = PRODUCTS.find((p) => p.id !== tee.id)!
      const result = runChatActions(
        [{ action: "add_to_bag", productId: other.id }, { action: "checkout" }],
        vi.fn(),
      )
      expect(result.checkedOut).toBe(true)
      vi.advanceTimersByTime(2000)
      const second = useStorefront.getState().order
      expect(second).not.toBeNull()
      expect(second!.orderId).not.toBe(first!.orderId)
    } finally {
      vi.useRealTimers()
    }
  })

  test("add then checkout in one batch sees the fresh bag", () => {
    vi.useFakeTimers()
    try {
      runChatActions(
        [{ action: "add_to_bag", productId: tee.id }, { action: "checkout" }],
        vi.fn(),
      )
      expect(useStorefront.getState().checkoutPhase).toBe("session")
      vi.advanceTimersByTime(2000)
      expect(useStorefront.getState().checkoutPhase).toBe("paid")
      expect(useStorefront.getState().bag).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  test("a shopper clicking Pay first cancels the agent's auto-pay (no double capture)", () => {
    vi.useFakeTimers()
    try {
      runChatActions([{ action: "add_to_bag", productId: tee.id }, { action: "checkout" }], vi.fn())
      // Shopper beats the agent to the button.
      const first = captureCheckout()
      vi.advanceTimersByTime(2000)
      expect(first).not.toBeNull()
      // The agent's timer must not mint a second order.
      expect(useStorefront.getState().order?.orderId).toBe(first!.orderId)
    } finally {
      vi.useRealTimers()
    }
  })
})
