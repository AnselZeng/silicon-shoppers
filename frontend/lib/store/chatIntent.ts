// Turns a concierge sentence ("make it more men friendly, focus on navy") into a real layout
// change applied immediately inside the store. The shopper said it out loud, so this is applied
// directly like a quiz answer — no model confidence gate. The LLM is then told what changed so
// its reply confirms instead of deflecting.

import type { LayoutConfig } from "@/lib/layout/types"
import type { NavItemId } from "@/lib/layout/enums"
import type { AdId } from "@/lib/ads/catalog"
import { STORE_COLORS, type StoreColor } from "@/config/ui"
import { intentOverrides, keywordIntent } from "@/lib/model/intent"

const COLOR_WORDS: Record<StoreColor, string[]> = {
  black: ["black"],
  white: ["white", "ivory"],
  beige: ["beige", "sand", "taupe", "nude"],
  navy: ["navy", "dark blue", "blue"],
  grey: ["grey", "gray", "charcoal", "slate"],
  olive: ["olive", "khaki", "army green", "green"],
  burgundy: ["burgundy", "maroon", "wine", "oxblood"],
  cream: ["cream", "ecru", "off white", "off-white"],
  brown: ["brown", "chocolate", "mocha"],
  camel: ["camel", "tan", "caramel", "toffee"],
}

/** Colors the sentence asked for, store ids, most-mentioned first (max 3). */
function colorsIn(text: string): StoreColor[] {
  const t = text.toLowerCase()
  return STORE_COLORS.filter((c) => COLOR_WORDS[c]?.some((w) => new RegExp(`\\b${w}\\b`, "i").test(t))).slice(0, 3)
}

function navFirst(order: NavItemId[], id: NavItemId): NavItemId[] {
  return order.includes(id) ? [id, ...order.filter((x) => x !== id)] : order
}

export interface ChatApplied {
  /** Patched layout, ready for setLayout(). */
  layout: LayoutConfig
  /** One line for the toast/terminal, e.g. "Men's clothes, navy forward". */
  summary: string
  /** Human-readable list of what changed, for the chat reply + terminal. */
  changes: string[]
}

/**
 * If the message states a preference the store can act on, returns a patched copy of `current`.
 * Returns null when the message has nothing actionable (a plain question, small talk).
 */
// "expensive" is a direction of its own — the opposite end of "sale/cheap".
// "not too expensive" still means cheap, so negation is checked first.
const NOT_EXPENSIVE_RE = /\b(not|nothing|isn'?t|never)\s+(too\s+|that\s+|very\s+|so\s+|really\s+)?(expensive|pricey)\b/i
const EXPENSIVE_RE =
  /\b(expensive|priciest|pricey|premium|luxur\w*|luxe|high[-\s]?end|top[-\s]?end|splurge|designer|upscale|fancy|posh|fanciest|nicest)\b/i
// "not sale", "no sale", "full price" — pull sale emphasis off.
const NOT_SALE_RE =
  /\b(not|no|none|without|skip|hate|tired of|over)\b[\w\s']{0,20}\bsale\b|\bfull[-\s]?price\b|\bnon[-\s]?sale\b|\bno sale\b/i

export function applyChatIntent(message: string, current: LayoutConfig): ChatApplied | null {
  const intent = keywordIntent(message)
  const o = intentOverrides(intent)
  const colors = colorsIn(message)
  const expensive = EXPENSIVE_RE.test(message) && !NOT_EXPENSIVE_RE.test(message)
  const notSale = NOT_SALE_RE.test(message)
  const wantsSale = !notSale && !expensive && (o.sectionFirst === "sale" || o.priceMode || !!o.budget)
  if (
    !o.landingDepartment && !o.departmentsFirst.length && !o.sectionFirst && !o.budget && !colors.length &&
    !o.priceMode && !expensive && !notSale
  ) {
    return null
  }

  const layout: LayoutConfig = JSON.parse(JSON.stringify(current))
  const changes: string[] = []

  // Department → the store's two departments and nav order.
  const deptNav: Record<string, NavItemId | null> = {
    dept_menswear: "men",
    dept_ladieswear: "women",
    dept_divided: null,
    dept_sport: null,
    dept_baby_children: null,
  }
  const landing = o.landingDepartment ? deptNav[o.landingDepartment] : null
  if (landing === "men" || landing === "women") {
    if (layout.nav.department !== landing) {
      layout.nav.department = landing
      changes.push(`switched to ${landing === "men" ? "menswear" : "womenswear"}`)
    }
    layout.nav.order = navFirst(layout.nav.order, landing)
    layout.nav.highlight = landing
  }

  // Stated priority → nav + homepage rail order + listing sort. A "sale" read is
  // suppressed when the shopper actually said NOT sale or asked for expensive.
  const sectionFirst = o.sectionFirst === "sale" && !wantsSale ? undefined : o.sectionFirst
  if (sectionFirst) {
    const navMap: Record<string, NavItemId> = { new_in: "new_in", sale: "sale", bestsellers: "for_you" }
    layout.nav.order = navFirst(layout.nav.order, navMap[sectionFirst])
    const idx = layout.home.blocks.findIndex((b) => b.type === "product_row" && b.source.kind === sectionFirst)
    if (idx > 1) {
      const [block] = layout.home.blocks.splice(idx, 1)
      layout.home.blocks.splice(1, 0, block)
      changes.push(`moved ${sectionFirst.replaceAll("_", " ")} to the top`)
    }
  }
  if ((o.priceMode || o.budget) && wantsSale) {
    layout.listing.defaultSort = "price_asc"
    layout.listing.card.priceStyle = "sale_emphasis"
    layout.listing.expandedFilters = [...new Set<typeof layout.listing.expandedFilters[number]>(["sale", "price", ...layout.listing.expandedFilters])]
    changes.push("sorted by price, sale badges on")
  }

  // The other end of the range: "expensive / premium" sorts high-to-low, drops
  // sale emphasis and brings collections forward.
  if (expensive) {
    layout.listing.defaultSort = "price_desc"
    if (layout.listing.card.priceStyle === "sale_emphasis") layout.listing.card.priceStyle = "plain"
    layout.listing.expandedFilters = [...new Set<typeof layout.listing.expandedFilters[number]>(["price", ...layout.listing.expandedFilters])]
    layout.nav.order = navFirst(layout.nav.order, "collections")
    const idx = layout.home.blocks.findIndex((b) => b.type === "category_tiles" || b.type === "collection_spotlight")
    if (idx > 1) {
      const [block] = layout.home.blocks.splice(idx, 1)
      layout.home.blocks.splice(1, 0, block)
    }
    changes.push("most expensive first, collections up top")
  }
  // "not sale" on its own: pull sale badges/filters back off.
  if (notSale) {
    if (layout.listing.card.priceStyle === "sale_emphasis") layout.listing.card.priceStyle = "plain"
    layout.listing.expandedFilters = layout.listing.expandedFilters.filter((f) => f !== "sale")
    changes.push("sale de-emphasized")
  }

  // Stated colors → color merchandising: those colors first on cards and in the color filter.
  if (colors.length) {
    layout.listing.colorHighlight = colors
    layout.listing.expandedFilters = [...new Set<typeof layout.listing.expandedFilters[number]>(["color", ...layout.listing.expandedFilters])]
    changes.push(`${colors.join(" + ")} colors forward`)
  }

  // Stated colors → color merchandising: those colors first on cards and in the color filter.
  if (colors.length) {
    layout.listing.colorHighlight = colors
    layout.listing.expandedFilters = [...new Set<typeof layout.listing.expandedFilters[number]>(["color", ...layout.listing.expandedFilters])]
    changes.push(`${colors.join(" + ")} colors forward`)
  }

  // The hero is part of the rearrange too — swap the banner to match what they asked
  // for, so the headline/visual changes with the store instead of staying constant.
  const deptForHero = landing ?? layout.nav.department
  const heroAd: AdId | null = expensive
    ? deptForHero === "women"
      ? "collection_women"
      : deptForHero === "men"
        ? "collection_men"
        : null
    : wantsSale
      ? deptForHero === "men"
        ? "sale_men"
        : deptForHero === "women"
          ? "sale_women"
          : "offer_all"
      : sectionFirst === "new_in"
        ? deptForHero === "women"
          ? "new_women"
          : "new_men"
        : landing === "men"
          ? "collection_men"
          : landing === "women"
            ? "collection_women"
            : null
  if (heroAd) {
    const hero = layout.ads.placements.find((p) => p.slot === "hero")
    if (!hero) {
      layout.ads.placements.unshift({ slot: "hero", adIds: [heroAd] })
      changes.push("hero banner swapped")
    } else if (hero.adIds[0] !== heroAd) {
      hero.adIds = [heroAd]
      changes.push("hero banner swapped")
    }
  }

  if (!changes.length) return null
  return { layout, summary: changes.join(", "), changes }
}
