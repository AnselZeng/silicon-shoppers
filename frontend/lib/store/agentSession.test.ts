// Front-to-back concierge session: drives a multi-turn conversation through the
// SAME orchestration the Concierge component uses — confirmReply/NEW_ORDER_RE
// fast-paths, processReply for the LLM reply, and the real storefront state.
import { beforeEach, describe, expect, test, vi } from "vitest"
import { captureCheckout } from "@/lib/store/actions"
import {
  confirmReply,
  NEW_ORDER_RE,
  processReply,
  runChatActions,
} from "@/lib/store/agent"
import { applyChatIntent } from "@/lib/store/chatIntent"
import { useStorefront } from "@/lib/store/storeState"

const nav = vi.fn()
let pending = false

function state() {
  return useStorefront.getState()
}

/** One shopper turn, mirroring Concierge.send()'s structure. `reply` is the model's raw text. */
function turn(message: string, reply: string) {
  // Fast-path: typed answer to a pending done-shopping prompt.
  const pendingReply = pending ? confirmReply(message) : null
  pending = false
  if (pendingReply === "yes") {
    runChatActions([{ action: "checkout" }], nav)
    return { kind: "confirm-yes" as const }
  }
  if (pendingReply === "no") return { kind: "confirm-no" as const }
  // Fast-path: fresh order request.
  if (NEW_ORDER_RE.test(message)) {
    pending = state().bag.length > 0
    return { kind: "new-order" as const }
  }
  // Stated layout preference applies locally.
  const applied = applyChatIntent(message, state().layout)
  if (applied) state().setLayout(applied.layout, { presetName: applied.summary })
  // The LLM reply goes through the shared orchestration.
  const outcome = processReply(message, reply, nav)
  pending = outcome.pending
  return { kind: "llm" as const, outcome, applied }
}

beforeEach(() => {
  pending = false
  useStorefront.setState({
    bag: [],
    bagOpen: false,
    checkoutPhase: "idle",
    visaSession: null,
    order: null,
    agentAutoPay: true,
  })
})

describe("full concierge session", () => {
  test("buy → not done → keep shopping → done → paid → bag cleared", () => {
    vi.useFakeTimers()
    try {
      // Turn 1: a buy ask with a proper action block.
      turn(
        "buy a navy tee in medium",
        'Great pick! Added the Heavy Crew in navy, size M. Done shopping? <<<ACTIONS>>>[{"action":"add_to_bag","productId":"m-navy-tee","color":"navy","size":"M"},{"action":"ask_checkout"}]',
      )
      expect(state().bag).toHaveLength(1)
      expect(pending).toBe(true)

      // Turn 2: "nope" while pending = keep shopping, nothing charged.
      expect(turn("nope", "").kind).toBe("confirm-no")
      expect(state().checkoutPhase).toBe("idle")
      expect(state().bag).toHaveLength(1)

      // Turn 3: a browse ask must NOT bag anything, even if the model claims it did.
      const t3 = turn(
        "i need more men sale products",
        "You're going to love these, I've added the Wool Trouser in black for you. <<<ACTIONS>>>[{\"action\":\"ask_checkout\"}]",
      )
      if (t3.kind === "llm") {
        expect(t3.outcome.result.added).toEqual([])
        expect(t3.outcome.notes.join(" ")).toMatch(/Nothing was bagged|Could not find/)
      }
      expect(state().bag).toHaveLength(1) // still just the tee
      expect(state().layout.nav.department).toBe("men") // layout intent did apply
      expect(state().layout.ads.placements.find((p) => p.slot === "hero")?.adIds[0]).toBe("sale_men")

      // Turn 4: "yeah im done" — shopper's own words unlock checkout.
      turn("yeah im done", "Perfect, paying now. <<<ACTIONS>>>[{\"action\":\"checkout\"}]")
      vi.advanceTimersByTime(2000)
      expect(state().order).not.toBeNull()
      expect(state().bag).toEqual([])
      expect(nav).toHaveBeenCalledWith("/store/confirmation")
    } finally {
      vi.useRealTimers()
    }
  })

  test("premature checkout on a buy ask becomes the Yes/No prompt", () => {
    const t = turn(
      "purchase the oxford shirt",
      'Adding it and taking you to checkout! <<<ACTIONS>>>[{"action":"add_to_bag","productId":"m-oxford"},{"action":"checkout"}]',
    )
    if (t.kind === "llm") {
      expect(t.outcome.result.checkedOut).toBe(false)
      expect(t.outcome.pending).toBe(true)
    }
    expect(state().checkoutPhase).toBe("idle")
  })

  test("claim-only add recovers when the shopper asked to buy", () => {
    const t = turn(
      "buy me the wool trouser in black, size M",
      "I've added the Wool Trouser in black, size M to your bag!",
    )
    expect(state().bag).toHaveLength(1)
    expect(state().bag[0].productId).toBe("m-wool-trouser")
    if (t.kind === "llm") expect(t.outcome.pending).toBe(true)
  })

  test("'next order' after paying starts clean and a second order succeeds", () => {
    vi.useFakeTimers()
    try {
      turn("buy the rib tee", 'Done! Added the Ribbed Cotton Tee. <<<ACTIONS>>>[{"action":"add_to_bag","productId":"w-sale-rib-tee"},{"action":"checkout"}]')
      // "buy" carries BUY_INTENT but not shopperConfirmed — the checkout downgrade applies.
      // Confirm via the buttons.
      expect(pending).toBe(true)
      turn("yes", "")
      vi.advanceTimersByTime(2000)
      const first = state().order!.orderId
      expect(state().bag).toEqual([])

      // Fresh order in the same conversation.
      expect(turn("next order", "").kind).toBe("new-order")
      turn("buy the straight jean", 'On it. <<<ACTIONS>>>[{"action":"add_to_bag","productId":"w-sale-jean"},{"action":"ask_checkout"}]')
      expect(state().bag).toHaveLength(1)
      turn("check me out", "")
      vi.advanceTimersByTime(2000)
      expect(state().order!.orderId).not.toBe(first)
    } finally {
      vi.useRealTimers()
    }
  })

  test("manual Pay click wins over the agent timer — single order", () => {
    vi.useFakeTimers()
    try {
      turn("buy the heavy crew", 'Added! <<<ACTIONS>>>[{"action":"add_to_bag","productId":"m-navy-tee"},{"action":"checkout"}]')
      // Model emitted checkout on a non-confirm message → downgraded, pending buttons.
      expect(pending).toBe(true)
      turn("yes", "")
      const manual = captureCheckout() // shopper beats the 900ms timer
      vi.advanceTimersByTime(2000)
      expect(manual).not.toBeNull()
      expect(state().order!.orderId).toBe(manual!.orderId)
    } finally {
      vi.useRealTimers()
    }
  })

  test("off-scope and question asks change nothing in the bag", () => {
    turn("why am i seeing this shirt?", "Because your browsing leaned toward winter knits.")
    turn("write me python code", "I'm just the store concierge, ask me about the clothes.")
    expect(state().bag).toEqual([])
    expect(state().checkoutPhase).toBe("idle")
    expect(pending).toBe(false)
  })

  test("hallucinated product never lands; a real suggestion is offered", () => {
    const t = turn(
      "add the galaxy hoverboots",
      'Done! <<<ACTIONS>>>[{"action":"add_to_bag","productId":"p-galaxy-boots"},{"action":"ask_checkout"}]',
    )
    expect(state().bag).toEqual([])
    if (t.kind === "llm") expect(t.outcome.result.failed[0]).toContain("p-galaxy-boots")
  })
})
