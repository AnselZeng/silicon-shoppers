import { UI_CONFIG } from "@/config/ui"
import { PERSONA_IDS, type PersonaId } from "@/lib/personas/schema"
import type { StoreEvent } from "@/lib/sim/protocol"

export interface EvidenceRule {
  id: string
  event: StoreEvent["type"]
  when?: (event: StoreEvent) => boolean
  weights: Partial<Record<PersonaId, number>>
  note: string
}

function prop(event: StoreEvent, key: string): string {
  const value = event.properties[key]
  return value === null || value === undefined ? "" : String(value)
}

function flag(event: StoreEvent, key: string): boolean {
  return event.properties[key] === true || event.properties[key] === "true"
}

export const EVIDENCE_RULES: EvidenceRule[] = [
  {
    id: "sort-price-asc",
    event: "sort_changed",
    when: (event) => prop(event, "sort") === "price_asc",
    weights: { price_hunter: 3 },
    note: "Cheap sort is the price hunter's tell.",
  },
  {
    id: "sort-newest",
    event: "sort_changed",
    when: (event) => prop(event, "sort") === "newest",
    weights: { trend_seeker: 3 },
    note: "Newest-first is trend seeking.",
  },
  {
    id: "sort-bestsellers",
    event: "sort_changed",
    when: (event) => prop(event, "sort") === "bestsellers",
    weights: { brand_loyalist: 3 },
    note: "Bestsellers leans loyalist.",
  },
  {
    id: "sort-relevance",
    event: "sort_changed",
    when: (event) => prop(event, "sort") === "relevance",
    weights: { mission_shopper: 1.2 },
    note: "Relevance is a mild mission signal.",
  },
  {
    id: "filter-sale",
    event: "filter_applied",
    when: (event) => prop(event, "filter") === "sale" || prop(event, "section") === "sale",
    weights: { price_hunter: 3 },
    note: "Sale filter is a hard price-hunter signal.",
  },
  {
    id: "filter-price",
    event: "filter_applied",
    when: (event) => prop(event, "filter") === "price" || prop(event, "section") === "price",
    weights: { price_hunter: 1.6 },
    note: "Price band supports the hunter.",
  },
  {
    id: "filter-color",
    event: "filter_applied",
    when: (event) => prop(event, "filter") === "color" || prop(event, "section") === "color",
    weights: { trend_seeker: 2.4 },
    note: "Color is how trend seekers edit the grid.",
  },
  {
    id: "filter-size",
    event: "filter_applied",
    when: (event) => prop(event, "filter") === "size" || prop(event, "section") === "size",
    weights: { mission_shopper: 3 },
    note: "Size-first means they already know the item.",
  },
  {
    id: "filter-collection",
    event: "filter_applied",
    when: (event) =>
      prop(event, "filter") === "collection" || prop(event, "section") === "collection",
    weights: { brand_loyalist: 3 },
    note: "Collection filter is loyalty.",
  },
  {
    id: "filter-category",
    event: "filter_applied",
    when: (event) => prop(event, "filter") === "category" || prop(event, "section") === "category",
    weights: { mission_shopper: 0.8, trend_seeker: 0.6 },
    note: "Category is a weak mission / trend hint.",
  },
  {
    id: "search",
    event: "search_performed",
    weights: { mission_shopper: 3 },
    note: "Search means they arrived with a target.",
  },
  {
    id: "popup-dismissed",
    event: "popup_dismissed",
    weights: { price_hunter: 1.5, mission_shopper: 1.7 },
    note: "Low tolerance shoppers close the popup.",
  },
  {
    id: "popup-clicked",
    event: "popup_clicked",
    weights: { trend_seeker: 1.8, brand_loyalist: 1.5 },
    note: "Popup CTA clicks lean trend and loyalist.",
  },
  {
    id: "banner-discount",
    event: "banner_clicked",
    when: (event) => prop(event, "variant") === "discount",
    weights: { price_hunter: 2.6 },
    note: "Discount hero click.",
  },
  {
    id: "banner-new-drop",
    event: "banner_clicked",
    when: (event) => prop(event, "variant") === "new_drop",
    weights: { trend_seeker: 2.6 },
    note: "New-drop hero click.",
  },
  {
    id: "banner-collection",
    event: "banner_clicked",
    when: (event) => prop(event, "variant") === "collection",
    weights: { brand_loyalist: 2.6 },
    note: "Collection hero click.",
  },
  {
    id: "wishlist",
    event: "add_to_wishlist",
    weights: { brand_loyalist: 2.2, trend_seeker: 0.5 },
    note: "Wishlisting is a loyalist habit.",
  },
  {
    id: "quickview",
    event: "quickview_opened",
    weights: { trend_seeker: 2.2 },
    note: "Quick view instead of a full PDP.",
  },
  {
    id: "view-sale",
    event: "product_viewed",
    when: (event) => flag(event, "onSale"),
    weights: { price_hunter: 1.2 },
    note: "Extra weight when the PDP is on sale.",
  },
  {
    id: "view-new",
    event: "product_viewed",
    when: (event) => flag(event, "isNew"),
    weights: { trend_seeker: 1.2 },
    note: "Extra weight when the PDP is new.",
  },
  {
    id: "view-essentials",
    event: "product_viewed",
    when: (event) => prop(event, "collection") === "Essentials",
    weights: { brand_loyalist: 0.6 },
    note: "Essentials PDPs nudge the loyalist.",
  },
  {
    id: "scroll-deep",
    event: "scroll_depth",
    when: (event) => Number(prop(event, "percent")) >= 75,
    weights: { price_hunter: 1.4 },
    note: "Deep scroll looking for the bottom of the sale.",
  },
  {
    id: "add-bag",
    event: "add_to_bag",
    weights: { mission_shopper: 1.1, price_hunter: 0.3 },
    note: "Mission shoppers add once the target is found.",
  },
  {
    id: "checkout",
    event: "checkout_started",
    weights: { mission_shopper: 1.4 },
    note: "Fast checkout leans mission.",
  },
]

export function emptyScores(): Record<PersonaId, number> {
  return {
    price_hunter: 0,
    trend_seeker: 0,
    mission_shopper: 0,
    brand_loyalist: 0,
  }
}

export function softmax(scores: Record<PersonaId, number>): Record<PersonaId, number> {
  const values = PERSONA_IDS.map((id) => scores[id])
  const max = Math.max(...values)
  const exps = values.map((value) => Math.exp(value - max))
  const sum = exps.reduce((total, value) => total + value, 0) || 1
  const out = emptyScores()
  PERSONA_IDS.forEach((id, index) => {
    out[id] = (exps[index] ?? 0) / sum
  })
  return out
}

export function topPersona(probabilities: Record<PersonaId, number>): {
  id: PersonaId
  probability: number
} {
  let best: PersonaId = "price_hunter"
  let probability = -1
  for (const id of PERSONA_IDS) {
    const value = probabilities[id]
    if (value > probability) {
      best = id
      probability = value
    }
  }
  return { id: best, probability }
}

export function meetsThreshold(probability: number, eventCount: number): boolean {
  return probability >= UI_CONFIG.classificationThreshold && eventCount >= UI_CONFIG.minEventsToClassify
}
