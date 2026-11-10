"use client"

// Builds the CONTEXT JSON the concierge route grounds its answers in: who this shopper
// is (the stored document's persona + reason), why the store looks like this (the decision
// log's reason strings), what's in the bag, where they are, and the catalog. Everything the
// LLM may quote comes from here so it can explain instead of invent.

import { getDecisionLog, getPersona, getShopperDoc, getStatements } from "@/lib/model/personalize"
import { isStoreLayoutDoc } from "@/lib/model/adapter"
import { PRODUCTS } from "@/lib/store/catalog"
import { effectivePrice } from "@/lib/store/types"
import { useStorefront } from "@/lib/store/storeState"

export interface ChatContext {
  shopper: { id?: string; persona?: string; confidence?: string; reason?: string }
  /** What the shopper told the concierge on this and earlier visits, oldest first. */
  remembered: string[]
  decisions: { field: string; value: string; reason: string; source: string }[]
  bag: { name: string; color: string; size: string; qty: number; price: number }[]
  wishlist: { name: string; price: number }[]
  route: string
  /** Last completed order this session, so "did it go through?" answers truthfully. */
  order: { orderId: string; amount: number; last4: string; points: number } | null
  catalog: {
    id: string; name: string; department: string; category: string
    colors: string[]; sizes: string[]; price: number; isNew: boolean; description: string
  }[]
}

export function buildChatContext(): ChatContext {
  const state = useStorefront.getState()
  const doc = getShopperDoc()

  // The same persona the terminal and the layout use, so the concierge never names a different one.
  const persona = getPersona()
  const shopper: ChatContext["shopper"] = {}
  if (doc && isStoreLayoutDoc(doc)) shopper.id = doc.shopper.id
  if (persona) {
    shopper.persona = persona.name
    shopper.confidence = persona.confidence
    shopper.reason = persona.reason
  } else if (doc && isStoreLayoutDoc(doc)) {
    shopper.persona = doc.shopper.label
    shopper.confidence = doc.shopper.confidence
  }

  return {
    shopper,
    remembered: getStatements(),
    decisions: getDecisionLog()
      .filter((entry) => entry.reason)
      .map((entry) => ({ field: entry.key, value: entry.value, reason: entry.reason, source: entry.source })),
    bag: state.bag.map((line) => ({
      name: line.name,
      color: line.color,
      size: line.size,
      qty: line.qty,
      price: line.unitPrice,
    })),
    wishlist: state.wishlist.map((item) => ({ name: item.name, price: item.price })),
    route: typeof window === "undefined" ? "/store" : window.location.pathname,
    order: state.order
      ? {
          orderId: state.order.orderId,
          amount: state.order.amount,
          last4: state.order.last4,
          points: state.order.loyaltyPoints,
        }
      : null,
    catalog: PRODUCTS.map((p) => ({
      id: p.id,
      name: p.name,
      department: p.department,
      category: p.category,
      colors: [...p.colors],
      sizes: [...p.sizes],
      price: effectivePrice(p),
      isNew: p.isNew,
      description: p.description.slice(0, 140),
    })),
  }
}
