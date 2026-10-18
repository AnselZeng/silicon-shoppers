import { emitStoreEvent } from "@/lib/store/emit"
import { bagSubtotal, useStorefront } from "@/lib/store/storeState"
import type { Product } from "@/lib/store/types"
import { effectivePrice } from "@/lib/store/types"
import { captureMockSession, createMockSession } from "@/lib/visa/mock"

export function chosenColor(product: Product): string {
  return useStorefront.getState().selectedColor[product.id] ?? product.colors[0] ?? "black"
}

export function chosenSize(product: Product): string {
  const selected = useStorefront.getState().selectedSize[product.id]
  if (selected) return selected
  if (product.sizes.includes("M")) return "M"
  return product.sizes[0] ?? "OS"
}

export function addProductToBag(product: Product) {
  const color = chosenColor(product)
  const size = chosenSize(product)
  const unitPrice = effectivePrice(product)
  useStorefront.getState().addToBag({
    productId: product.id,
    name: product.name,
    color,
    size,
    unitPrice,
  })
  emitStoreEvent("add_to_bag", {
    productId: product.id,
    color,
    price: unitPrice,
    onSale: product.salePrice !== undefined,
  })
}

export function addProductToWishlist(product: Product) {
  const state = useStorefront.getState()
  if (state.wishlist.some((item) => item.productId === product.id)) return
  state.addWishlist({
    productId: product.id,
    name: product.name,
    price: effectivePrice(product),
    color: chosenColor(product),
  })
  emitStoreEvent("add_to_wishlist", {
    productId: product.id,
    collection: product.collection,
  })
}

export function startCheckout() {
  const state = useStorefront.getState()
  if (state.bag.length === 0) return
  const amount = bagSubtotal(state.bag)
  const session = createMockSession({ amount, mode: state.layout.checkout.variant })
  state.setVisaSession(session)
  state.setCheckoutPhase("session")
  state.setBagOpen(false)
  emitStoreEvent("checkout_started", {
    sessionId: session.id,
    amount: session.amount,
    last4: session.last4,
    mode: session.mode,
  })
  void fetch("/api/checkout/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      amount: session.amount,
      mode: session.mode,
      session,
    }),
  }).catch(() => undefined)
}

export function captureCheckout() {
  const state = useStorefront.getState()
  const session = state.visaSession
  if (!session) return null
  const captured = captureMockSession(session, { awardLoyalty: state.layout.checkout.loyaltyPrompt })
  state.setOrder(captured)
  state.setCheckoutPhase("paid")
  state.setVisaSession(null)
  emitStoreEvent("payment_completed", {
    orderId: captured.orderId,
    amount: captured.amount,
    last4: captured.last4,
  })
  if (captured.loyaltyPoints > 0) {
    emitStoreEvent("loyalty_awarded", { points: captured.loyaltyPoints })
  }
  void fetch("/api/checkout/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "capture",
      sessionId: session.id,
      awardLoyalty: state.layout.checkout.loyaltyPrompt,
      session,
    }),
  }).catch(() => undefined)
  return captured
}
