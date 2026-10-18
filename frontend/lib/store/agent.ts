// Executes actions the concierge model asked for. The reply streams as text; if the model
// wants the store to DO something it ends its reply with a marker + JSON:
//
//   <<<ACTIONS>>>[{"action":"add_to_bag","productId":"p-12","color":"navy","size":"M"},{"action":"checkout"}]
//
// The marker is never shown to the shopper. Actions run client-side against the real
// store actions (addProductToBag / startCheckout / captureCheckout), so every bag add
// and payment still emits its normal events into the tracker, Terminal and Snowflake.

import type { StoreColor } from "@/config/ui"
import { emitStoreEvent } from "@/lib/store/emit"
import { getProduct, PRODUCTS } from "@/lib/store/catalog"
import { addProductToBag, captureCheckout, startCheckout } from "@/lib/store/actions"
import { useStorefront } from "@/lib/store/storeState"

export const ACTIONS_MARKER = "<<<ACTIONS>>>"

// A message that IS the answer to the pending "are you done shopping?" question —
// short affirmatives and negatives only. Handled locally like the Yes/No buttons so
// a flaky model reply can never fake a payment.
export const SHORT_YES_RE =
  /^\s*(?:(?:yes|yeah|yep|yup|sure|ok(?:ay)?|alright|absolutely|go ahead)[,!\s]+)?(yes|yeah|yep|yup|sure|ok(?:ay)?|alright|done|i'?m done|that'?s (all|it)|all set|check ?out|check me out|check ?out me|let'?s (check ?out|pay|wrap( it)? up|go)|pay( now| it| me out)?|wrap( it)? up|finish(ed)?( up)?|nothing else|no( |,)that'?s (all|it)|i'?m good|no more|go ahead)\s*(please)?\s*[.!]?\s*$/i
export const SHORT_NO_RE =
  /^\s*(no|nope|nah|not yet|not done|not now|keep (going|shopping)|more|wait|hold on|still shopping|not really|actually)\s*[.!]?\s*$/i
// Checkout intent embedded in a longer shopper message ("add that and check me out").
export const CHECKOUT_WORDS_RE =
  /\b(check me out|check ?out (now|please|for me)|proceed to (check ?out|payment)|go (ahead and|to) (pay|check ?out)|take me to (check ?out|payment)|ready to (pay|check ?out)|let'?s (pay|check ?out|wrap( it)? up))\b/i

/** Classifies a short typed reply while the done-shopping prompt is pending. */
export function confirmReply(message: string): "yes" | "no" | null {
  if (SHORT_YES_RE.test(message)) return "yes"
  if (SHORT_NO_RE.test(message)) return "no"
  return null
}

/** Whether the shopper's own words authorize a real checkout right now. */
export function shopperConfirmed(message: string): boolean {
  return SHORT_YES_RE.test(message) || CHECKOUT_WORDS_RE.test(message)
}

// The model's prose claims an add or a payment — verified against what really ran.
export const CLAIM_ADD_RE =
  /\b(added|adding|i'?ll (add|grab|bag|toss)|let me (add|grab|bag)|in your (bag|cart)|to your (bag|cart)|into your (bag|cart)|bagged)\b/i
export const CLAIM_PAY_RE =
  /\b(take|taking|check|checking|bring|bringing|head|heading)( you)?( over| right)? to (check ?out|payment)|pay(ing|ment) (for you|now|complete)|order (is |has been |)(placed|confirmed)|you'?re all set|process(ed|ing) (your |the |)payment/i

// Recovery of a claimed add only runs when the SHOPPER actually asked to buy —
// otherwise a browsing ask ("show me men's sale") can't be turned into a bagged
// item by a model that got over-eager with its prose.
export const BUY_INTENT_RE =
  /\b(buy|buying|add|adding|purchase|purchasing|get (me|this|that|it|one|those|these)|grab|order(ing)?|i'?ll (take|get|grab|have|buy)|give me|put (it|that|this|them|one|those|these|a) in|bag (it|this|that)|i want|i'?m (taking|getting|buying)|pick (it|that|this|one|me|them|out|up)|send me|need (the|that|this|a|an|it|one))\b/i

// "next order" / "another one" — start a fresh bag. Whole-message only, so
// "next loafers medium navy" (a product request) never trips it.
export const NEW_ORDER_RE =
  /^\s*(?:next|new|another) (?:order|one)\s*(?:please)?\s*[.!]?\s*$|^\s*(?:start over|fresh start|reset(?: the)? (?:order|bag)|order again|same again|new round)\s*[.!]?\s*$/i

export interface ChatAction {
  /** ask_checkout renders Yes/No buttons in the chat instead of acting directly. */
  action: "add_to_bag" | "checkout" | "ask_checkout"
  productId?: string
  color?: string
  size?: string
}

/** Splits a streamed reply into visible text + action payload. Tolerates <ACTIONS>, <<<ACTIONS>>> etc. */
export function splitActions(full: string): { text: string; actions: ChatAction[] } {
  const marker = /<+\s*ACTIONS\s*>+/i.exec(full)
  const at = marker ? marker.index : -1
  // Also hide a trailing partial marker while it is still streaming in ("<<<ACT").
  const text = (at === -1 ? full : full.slice(0, at)).replace(/<+[ACTIONS>]*$/i, "").trimEnd()
  if (at === -1) return { text, actions: [] }
  // Models wrap the payload in ```json fences or append prose after it — pull the
  // first array out instead of trusting the rest of the reply to be pure JSON.
  const rest = full.slice(at).replace(/^<+\s*ACTIONS\s*>+/, "").replace(/```[a-z]*\s*/g, "")
  const candidates = [/\[[\s\S]*\]/.exec(rest)?.[0], /\[[\s\S]*?\]/.exec(rest)?.[0], rest]
  let parsed: unknown
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      parsed = JSON.parse(candidate)
      break
    } catch {
      /* try the next candidate */
    }
  }
  try {
    if (!Array.isArray(parsed)) return { text, actions: [] }
    return {
      text,
      actions: parsed.filter(
        (a): a is ChatAction =>
          !!a &&
          typeof a === "object" &&
          ((a as ChatAction).action === "add_to_bag" ||
            (a as ChatAction).action === "checkout" ||
            (a as ChatAction).action === "ask_checkout"),
      ),
    }
  } catch {
    return { text, actions: [] }
  }
}

export interface ActionResult {
  /** Human-readable lines for anything that actually changed state. */
  done: string[]
  /** Items the model referenced that could not be resolved/added. */
  failed: string[]
  /** The model emitted ask_checkout (wants the Yes/No prompt). */
  asksCheckout: boolean
  /** Labels of products that really landed in the bag this run. */
  added: string[]
  /** A checkout action ran and a Visa session started. */
  checkedOut: boolean
  /** A checkout action ran but was skipped because the bag was empty. */
  checkoutSkipped: boolean
}

/**
 * Runs the actions the model requested. Returns what was done for the caller to log.
 * `checkout` pays for real (demo Visa flow) and hands back the order for navigation.
 */
export function runChatActions(
  actions: ChatAction[],
  navigate: (path: string) => void,
  onOrder?: (order: { orderId: string; amount: number }) => void,
): ActionResult {
  const done: string[] = []
  const failed: string[] = []
  const added: string[] = []
  let checkedOut = false
  let checkoutSkipped = false
  const store = useStorefront.getState()

  for (const a of actions) {
    if (a.action === "ask_checkout") continue
    if (a.action === "add_to_bag") {
      // Models sometimes send the product name instead of the id — accept either.
      const ref = String(a.productId ?? "")
      const product =
        getProduct(ref) ?? PRODUCTS.find((p) => p.name.toLowerCase() === ref.toLowerCase()) ??
        PRODUCTS.find((p) => ref && p.name.toLowerCase().includes(ref.toLowerCase()))
      if (!product) {
        failed.push(ref || "an item")
        emitStoreEvent("concierge_action", { action: "add_failed", detail: `no such product: ${ref}` })
        continue
      }
      if (a.color && (product.colors as string[]).includes(a.color)) store.selectColor(product.id, a.color as StoreColor)
      if (a.size && product.sizes.includes(a.size)) store.selectSize(product.id, a.size)
      addProductToBag(product)
      const line = useStorefront.getState().bag.at(-1)
      const label = `${product.name}${line ? ` (${line.color}, ${line.size})` : ""}`
      done.push(`added ${label} to bag`)
      added.push(label)
      emitStoreEvent("concierge_action", { action: "add_to_bag", product: product.name, detail: label })
    }
    if (a.action === "checkout") {
      // Re-read state: earlier add_to_bag actions in this same batch changed the bag.
      if (useStorefront.getState().bag.length === 0) {
        checkoutSkipped = true
        emitStoreEvent("concierge_action", { action: "checkout_skipped", detail: "bag empty" })
        continue
      }
      startCheckout()
      checkedOut = true
      done.push("started checkout")
      emitStoreEvent("concierge_action", { action: "checkout" })
      // Auto-pay on: the agent clicks Pay too. Off: stop on the Visa sheet, shopper clicks.
      if (!useStorefront.getState().agentAutoPay) continue
      setTimeout(() => {
        try {
          // Re-read live: the shopper may have flipped auto-pay OFF mid-countdown,
          // or clicked Pay themselves — never override either.
          if (!useStorefront.getState().agentAutoPay) return
          if (useStorefront.getState().checkoutPhase !== "session") return
          const captured = captureCheckout()
          if (captured) {
            emitStoreEvent("concierge_action", { action: "paid", detail: `order ${captured.orderId} · $${captured.amount}` })
            onOrder?.({ orderId: captured.orderId, amount: captured.amount })
            navigate("/store/confirmation")
          } else {
            emitStoreEvent("concierge_action", { action: "pay_failed", detail: "no visa session" })
          }
        } catch (err) {
          emitStoreEvent("concierge_action", { action: "pay_failed", detail: String(err) })
        }
      }, 900)
    }
  }
  return {
    done,
    failed,
    added,
    checkedOut,
    checkoutSkipped,
    asksCheckout: actions.some((a) => a.action === "ask_checkout"),
  }
}

/**
 * Last-resort recovery: the model's text claims an add ("I've added the Wool Trouser
 * in black, size M") but no add_to_bag action actually ran. Find the product it named
 * in its own prose, honor the color/size it quoted, and do the add for real so the
 * claim becomes true instead of a lie.
 */
/**
 * The post-LLM orchestration Concierge.send() runs on a completed reply: parse the
 * action block, gate checkout on the shopper's own words, recover claimed adds,
 * auto-checkout when the shopper confirmed but the model forgot, and audit the
 * prose against what actually ran. One function drives UI and tests.
 */
export interface ReplyOutcome {
  /** Clean reply text, marker stripped. */
  text: string
  /** What actually ran. */
  result: ActionResult
  /** Whether the done-shopping Yes/No buttons should show. */
  pending: boolean
  /** Honest corrections to append to the assistant bubble. */
  notes: string[]
}

export function processReply(
  message: string,
  reply: string,
  navigate: (path: string) => void,
  onOrder?: (order: { orderId: string; amount: number }) => void,
): ReplyOutcome {
  const { text, actions } = splitActions(reply)
  // The shopper's own words gate real payment. A pure confirmation ("yeah im
  // done", "check me out") allows a model checkout; anything else downgrades it
  // to the Yes/No prompt so a "purchase X" request can never skip the ask.
  const confirmed = shopperConfirmed(message)
  const safe = actions.map((a): ChatAction =>
    a.action === "checkout" && !confirmed ? { action: "ask_checkout" } : a,
  )
  const result = runChatActions(safe, navigate, onOrder)

  // The model claimed an add but no action landed — recover the product it named
  // from its own prose and do the add for real. Gated on the shopper's own buy
  // intent: a browsing ask can never become a bagged item via model prose.
  if (BUY_INTENT_RE.test(message) && CLAIM_ADD_RE.test(text) && result.added.length === 0 && !result.checkedOut) {
    const recovered = recoverClaimedAdd(text, navigate, onOrder)
    if (recovered) {
      result.added.push(...recovered.added)
      result.failed.push(...recovered.failed)
    }
  }
  // The model sometimes says "checking you out" but forgets the action. When the
  // shopper clearly confirmed and the bag has items, the agent owes them a checkout.
  if (confirmed && !result.checkedOut && useStorefront.getState().bag.length > 0) {
    const retry = runChatActions([{ action: "checkout" }], navigate, onOrder)
    result.checkedOut = retry.checkedOut
    result.checkoutSkipped = retry.checkoutSkipped
  }

  // Buttons are the "are you done?" ask — show them whenever the agent bagged
  // something, whether or not the model remembered to emit ask_checkout.
  const pending = !result.checkedOut && (result.asksCheckout || result.added.length > 0)

  // The model's prose must never claim an action that didn't happen. If it said
  // "added" but nothing landed, or "paying" but no session started, say so.
  const notes: string[] = []
  if (result.failed.length) {
    const hint = result.failed.map(suggestSimilar).find(Boolean)
    notes.push(
      hint
        ? `Could not find ${result.failed.join(", ")} — but we do have the ${hint}, want that instead?`
        : `Couldn't find ${result.failed.join(", ")} in the catalog, want me to pick something similar?`,
    )
  } else if (CLAIM_ADD_RE.test(text) && result.added.length === 0 && !result.checkedOut) {
    const hint = suggestSimilar(text)
    notes.push(
      hint
        ? `Nothing was bagged just yet — want me to add the ${hint}?`
        : "Hmm, that did not make it into your bag. Tell me the item again and I will grab it!",
    )
  }
  if (CLAIM_PAY_RE.test(text) && !result.checkedOut) {
    notes.push(
      useStorefront.getState().bag.length === 0
        ? "Your bag is actually empty right now, tell me what to add first!"
        : "Checkout did not kick off, say check me out and I will run it!",
    )
  }
  return { text, result, pending, notes }
}

/** Keyword-overlap lookup: "the Clean Jean" the model invented → the real Straight Jean. */
export function suggestSimilar(text: string): string | null {
  const words = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 3)
  const hit = PRODUCTS.find(
    (p) =>
      words.some(
        (w) => p.name.toLowerCase().includes(w) || p.category.toLowerCase().includes(w),
      ),
  )
  return hit?.name ?? null
}

export function recoverClaimedAdd(
  text: string,
  navigate: (path: string) => void,
  onOrder?: (order: { orderId: string; amount: number }) => void,
): ActionResult | null {
  const lower = text.toLowerCase()
  const named = PRODUCTS.filter((p) => lower.includes(p.name.toLowerCase())).sort(
    (a, b) => b.name.length - a.name.length,
  )[0]
  if (!named) return null
  const color = /\bin\s+([a-z]+)\b/i.exec(text)?.[1]?.toLowerCase()
  const size = /\bsize\s+([a-z0-9]+)\b/i.exec(text)?.[1]?.toUpperCase()
  return runChatActions(
    [
      {
        action: "add_to_bag",
        productId: named.id,
        ...(color ? { color } : {}),
        ...(size ? { size } : {}),
      },
    ],
    navigate,
    onOrder,
  )
}
