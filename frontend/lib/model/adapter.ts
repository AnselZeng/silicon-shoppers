// Turns the H&M model's homepage document into the store's own types: the model layout (no LLM) and a
// ranking of the demo catalog. Ported from backend/server/app/lib/model/adapter.ts (origin/pb-backend) and
// converted to layout v2. The live-session model is out of scope, so its merge step is gone.

import type { StoreColor } from "@/config/ui"
import { FOR_YOU_MAX, type ModelDecisionKey, type NavItemId } from "@/lib/layout/enums"
import { DEFAULT_LAYOUT, cloneLayout } from "@/lib/layout/presets"
import type { AdPlacement, FilterSectionId, HomeBlock, LayoutConfig, LayoutFieldPath, LayoutReason } from "@/lib/layout/types"
import type { HMCategory, HomepageDoc } from "@/lib/model/homepage"
import { APP_TO_HM_CATEGORY, HM_TO_APP_CATEGORIES, HM_TO_APP_COLOR } from "@/lib/model/mapping"
import {
  modelCategoryOrder,
  modelDepartment,
  modelHeroAd,
  modelReason,
  modelSectionOrder,
} from "@/lib/model/policy"
import { SORT_OPTIONS, type SortOption } from "@/lib/personas/schema"
import { PRODUCTS } from "@/lib/store/catalog"
import type { Category, Product } from "@/lib/store/types"

export { HM_TO_APP_CATEGORIES, HM_TO_APP_COLOR, HM_TO_APP_DEPARTMENT } from "@/lib/model/mapping"

const FILTER_MAP: Record<string, FilterSectionId> = {
  category: "category",
  size: "size",
  color: "color",
  price: "price",
  sale: "sale",
  collection: "collection",
}

function uniq<T>(xs: T[]): T[] {
  return xs.filter((x, i) => xs.indexOf(x) === i)
}

function isSort(value: string): value is SortOption {
  return (SORT_OPTIONS as readonly string[]).includes(value)
}

/** Store products for the For You row and page: the model's ranking, else rankCatalog. Basket items left out. */
export function forYouIds(doc: HomepageDoc, basketIds: string[] = []): string[] {
  const basket = new Set(basketIds)
  const known = new Set(PRODUCTS.map((p) => p.id))
  const picked = (doc.store_products ?? []).map((p) => p.product_id).filter((id) => known.has(id) && !basket.has(id))
  if (picked.length > 0) return uniq(picked).slice(0, FOR_YOU_MAX)
  return rankCatalog(PRODUCTS, doc)
    .filter((p) => !basket.has(p.id))
    .slice(0, FOR_YOU_MAX)
    .map((p) => p.id)
}

/** Model reasons for the fields the model decided, with its own text and class label. */
function reasonsFrom(doc: HomepageDoc, fields: [LayoutFieldPath, ModelDecisionKey][]): LayoutReason[] {
  return fields.map(([field, key]) => {
    const reason = modelReason(doc, key)
    return { field, source: "model", modelDecision: key, text: reason.text, class: reason.class }
  })
}

/**
 * The model layout: the house default changed only where the model decided something.
 * It is the starting point for the LLM and the fallback when the LLM's config is broken.
 */
export function modelLayout(doc: HomepageDoc, basketIds: string[] = []): LayoutConfig {
  const L = doc.layout
  const layout = cloneLayout(DEFAULT_LAYOUT)
  const department = modelDepartment(doc)
  const forYou = forYouIds(doc, basketIds)
  const sections = modelSectionOrder(doc).filter((s) => s !== "buy_again" || basketIds.length > 0)
  const categoryOrder = modelCategoryOrder(doc)
  const priceFirst = L.price_filter_first.value
  const colors = uniq<StoreColor>([
    ...((doc.preferences?.color_filters ?? []).filter((c): c is StoreColor => Object.values(HM_TO_APP_COLOR).includes(c as StoreColor))),
    ...L.color_highlight.value.map((c) => HM_TO_APP_COLOR[c]).filter((c): c is StoreColor => Boolean(c)),
  ]).slice(0, 3)

  const departments: NavItemId[] = department === "men" ? ["men", "women"] : ["women", "men"]
  const lead = sections[0]
  layout.nav = {
    order: [...departments, "new_in", "sale", "collections", ...(forYou.length > 0 ? (["for_you"] as const) : [])],
    highlight: lead === "sale" ? "sale" : lead === "new_in" ? "new_in" : forYou.length > 0 ? "for_you" : null,
    department,
    searchEmphasized: false,
  }

  const available = new Set(PRODUCTS.filter((p) => !department || p.department === department).map((p) => p.category))
  const tiles = categoryOrder.filter((c) => available.has(c)).slice(0, 4)
  const rows: HomeBlock[] = sections.map((section, i) => ({
    type: "product_row",
    source: { kind: section },
    limit: i === 0 ? 8 : 4,
  }))
  layout.home = {
    blocks: [
      { type: "hero" },
      ...(forYou.length > 0 ? [{ type: "product_row", source: { kind: "for_you" }, limit: 8 } as HomeBlock] : []),
      ...rows.slice(0, 1),
      { type: "category_tiles", categories: tiles },
      ...rows.slice(1),
    ],
    heroSize: "full",
    forYouIds: forYou,
    basketIds: [...basketIds],
  }

  const heroAd = modelHeroAd(doc, department)
  const placements: AdPlacement[] = [
    { slot: "top_strip", adIds: ["shipping"] },
    { slot: "hero", adIds: [heroAd] },
    { slot: "listing_banner", adIds: [heroAd] },
  ]
  if (L.popups.value === "on") placements.push({ slot: "popup", adIds: ["newsletter"], trigger: "delay", triggerValue: 2200 })
  layout.ads = { placements }

  layout.listing = {
    ...layout.listing,
    defaultSort: isSort(L.default_sort.value) ? L.default_sort.value : layout.listing.defaultSort,
    filterOrder: uniq<FilterSectionId>([
      ...L.filter_order.value.map((f) => FILTER_MAP[f]).filter((f): f is FilterSectionId => Boolean(f)),
      ...DEFAULT_LAYOUT.listing.filterOrder,
    ]),
    expandedFilters: priceFirst ? ["price", "sale"] : colors.length > 0 ? ["color"] : [...DEFAULT_LAYOUT.listing.expandedFilters],
    gridDensity: L.grid_columns.value,
    colorHighlight: colors,
    categoryOrder,
    card: {
      ...layout.listing.card,
      priceStyle: lead === "sale" || priceFirst ? "sale_emphasis" : "plain",
    },
  }

  layout.reasons = reasonsFrom(doc, [
    ["nav.department", "landing_department"],
    ["nav.order", "landing_department"],
    ["nav.highlight", "section_order"],
    ["home.blocks", "section_order"],
    ["listing.categoryOrder", "category_order"],
    ["listing.defaultSort", "default_sort"],
    ["listing.filterOrder", "filter_order"],
    ["listing.expandedFilters", "price_filter_first"],
    ["listing.gridDensity", "grid_columns"],
    ["listing.colorHighlight", "color_highlight"],
    ["ads.placements", "hero"],
  ])
  return layout
}

// ---------- catalog ordering ----------

/**
 * Orders demo-store products by how well they fit the shopper's predicted next purchases:
 * predicted share of the product's H&M group x department fit, boosted for highlighted colors,
 * with popularity as a tie-breaker. The model's own store_products ranking comes first when present.
 */
export function rankCatalog(products: Product[], doc: HomepageDoc): Product[] {
  if (doc.store_products?.length) {
    const pos = new Map(doc.store_products.map((p, i) => [p.product_id, i]))
    const ranked = products.filter((p) => pos.has(p.id)).sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0))
    return [...ranked, ...rankCatalogFromMix(products.filter((p) => !pos.has(p.id)), doc)]
  }
  return rankCatalogFromMix(products, doc)
}

function rankCatalogFromMix(products: Product[], doc: HomepageDoc): Product[] {
  const cat = doc.predicted_mix.category
  const dept = doc.predicted_mix.department
  const women = (dept.dept_ladieswear ?? 0) + (dept.dept_divided ?? 0)
  const men = dept.dept_menswear ?? 0
  const colors = new Set(doc.layout.color_highlight.value.map((c) => HM_TO_APP_COLOR[c]).filter(Boolean))
  const groupSize: Partial<Record<HMCategory, number>> = {}
  for (const [hm, cats] of Object.entries(HM_TO_APP_CATEGORIES) as [HMCategory, Category[]][]) groupSize[hm] = cats.length
  const score = (p: Product) => {
    const hm = APP_TO_HM_CATEGORY[p.category]
    const share = hm ? (cat[hm] ?? 0) / (groupSize[hm] || 1) : 0.01
    const deptFit = p.department === "men" ? men : women
    const colorBoost = p.colors.some((c) => colors.has(c)) ? 1.5 : 1
    return share * (0.2 + deptFit) * colorBoost + 1e-4 * p.popularity
  }
  return [...products].sort((a, b) => score(b) - score(a))
}
