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
  const json = full.slice(at).replace(/^<+\s*ACTIONS\s*>+/, "")
  try {
    const parsed = JSON.parse(json) as unknown
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
          // The shopper may have clicked Pay themselves in the meantime — never double-charge.
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
