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
import { getProduct } from "@/lib/store/catalog"
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
  const text = (at === -1 ? full : full.slice(0, at)).replace(/<+$/, "").trimEnd()
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

/**
 * Runs the actions the model requested. Returns what was done for the caller to log.
 * `checkout` pays for real (demo Visa flow) and hands back the order for navigation.
 */
export function runChatActions(actions: ChatAction[], navigate: (path: string) => void): { done: string[]; asksCheckout: boolean } {
  const done: string[] = []
  const store = useStorefront.getState()

  for (const a of actions) {
    if (a.action === "ask_checkout") continue
    if (a.action === "add_to_bag") {
      const product = a.productId ? getProduct(a.productId) : undefined
      if (!product) continue
      if (a.color && (product.colors as string[]).includes(a.color)) store.selectColor(product.id, a.color as StoreColor)
      if (a.size && product.sizes.includes(a.size)) store.selectSize(product.id, a.size)
      addProductToBag(product)
      const line = useStorefront.getState().bag.at(-1)
      const label = `${product.name}${line ? ` (${line.color}, ${line.size})` : ""}`
      done.push(`added ${label} to bag`)
      emitStoreEvent("concierge_action", { action: "add_to_bag", product: product.name, detail: label })
    }
    if (a.action === "checkout") {
      // Re-read state: earlier add_to_bag actions in this same batch changed the bag.
      if (useStorefront.getState().bag.length === 0) {
        emitStoreEvent("concierge_action", { action: "checkout_skipped", detail: "bag empty" })
        continue
      }
      startCheckout()
      done.push("started checkout")
      emitStoreEvent("concierge_action", { action: "checkout" })
      // Auto-pay on: the agent clicks Pay too. Off: stop on the Visa sheet, shopper clicks.
      if (!useStorefront.getState().agentAutoPay) continue
      window.setTimeout(() => {
        try {
          const captured = captureCheckout()
          if (captured) {
            emitStoreEvent("concierge_action", { action: "paid", detail: `order ${captured.orderId} · $${captured.amount}` })
            navigate("/store/confirmation")
          } else {
            emitStoreEvent("concierge_action", { action: "pay_failed", detail: "no visa session" })
          }
        } catch (err) {
          emitStoreEvent("concierge_action", { action: "pay_failed", detail: String(err) })
        }
      }, 1600)
    }
  }
  return { done, asksCheckout: actions.some((a) => a.action === "ask_checkout") }
}
