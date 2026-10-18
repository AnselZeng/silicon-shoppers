import type { PersonaId } from "@/lib/personas/schema"

/** The four demo shoppers. Each one fills the panel and maps to a layout the store can apply. */
export const DEMO_SHOPPERS: {
  id: PersonaId
  title: string
  fixtureId: string
  lines: string[]
}[] = [
  {
    id: "price_hunter",
    title: "Price Hunter",
    fixtureId: "fixture-men-sale",
    lines: ["Buys on markdown.", "Men and Sale lead the store.", "Budget sits around $75."],
  },
  {
    id: "trend_seeker",
    title: "Trend Seeker",
    fixtureId: "fixture-women-new",
    lines: ["Chases what just landed.", "New in and dresses come first.", "Looks at the pictures before the price."],
  },
  {
    id: "mission_shopper",
    title: "Mission Shopper",
    fixtureId: "fixture-low-evidence",
    lines: ["Already knows the piece.", "Little history, so the store stays close to the default.", "Gets in and out."],
  },
  {
    id: "brand_loyalist",
    title: "Brand Loyalist",
    fixtureId: "fixture-divided",
    lines: ["Comes back for the same cuts.", "Lower-priced women's pieces: jeans, skirts, tees.", "Keeps a wishlist."],
  },
]

/** A typed sentence picks the closest shopper. Empty text keeps the card they selected. */
export function shopperFromSentence(text: string): (typeof DEMO_SHOPPERS)[number] | null {
  const q = text.toLowerCase()
  if (!q.trim()) return null
  if (/\b(sale|cheap|budget|markdown|discount|deal)\b/.test(q)) return DEMO_SHOPPERS[0]
  if (/\b(new|trend|dress|drop|latest|just landed)\b/.test(q)) return DEMO_SHOPPERS[1]
  if (/\b(loyal|essential|collection|classic|keep|again)\b/.test(q)) return DEMO_SHOPPERS[3]
  if (/\b(mission|search|specific|errand|quick)\b/.test(q)) return DEMO_SHOPPERS[2]
  if (/\bmen\b/.test(q)) return DEMO_SHOPPERS[0]
  if (/\bwomen\b/.test(q)) return DEMO_SHOPPERS[1]
  return null
}
