"use client"

// Builds the CONTEXT JSON the concierge route grounds its answers in: who this shopper
// is (the stored document's persona + reason), why the store looks like this (the decision
// log's reason strings), what's in the bag, where they are, and the catalog. Everything the
// LLM may quote comes from here so it can explain instead of invent.

import { getDecisionLog, getShopperDoc } from "@/lib/model/personalize"
import { isStoreLayoutDoc } from "@/lib/model/adapter"
import { PRODUCTS } from "@/lib/store/catalog"
import { effectivePrice } from "@/lib/store/types"
import { useStorefront } from "@/lib/store/storeState"

export interface ChatContext {
  shopper: { id?: string; persona?: string; confidence?: string; reason?: string }
  decisions: { field: string; value: string; reason: string; source: string }[]
  bag: { name: string; color: string; size: string; qty: number; price: number }[]
  wishlist: { name: string; price: number }[]
  route: string
  catalog: { id: string; name: string; department: string; category: string; colors: string[]; price: number; isNew: boolean }[]
}

export function buildChatContext(): ChatContext {
  const state = useStorefront.getState()
  const doc = getShopperDoc()

  const shopper: ChatContext["shopper"] = {}
  if (doc && isStoreLayoutDoc(doc)) {
    shopper.id = doc.shopper.id
    shopper.persona = doc.shopper.persona?.name ?? doc.shopper.label
    shopper.confidence = doc.shopper.confidence
    shopper.reason = doc.shopper.persona_reason
  }

  return {
    shopper,
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
    catalog: PRODUCTS.map((p) => ({
      id: p.id,
      name: p.name,
      department: p.department,
      category: p.category,
      colors: [...p.colors],
      price: effectivePrice(p),
      isNew: p.isNew,
    })),
  }
}
