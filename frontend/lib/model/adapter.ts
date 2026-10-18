// Store-side helpers for the H&M model's homepage document.
// Product ranking (forYouIds, rankCatalog) feeds the v2 layout pipeline.
// modelLayout() turns the same document, plus live session decisions, into a v2 layout
// the store can apply when Snowflake returns a shopper.

import type { StoreColor } from "@/config/ui"
import { FOR_YOU_MAX, type NavItemId } from "@/lib/layout/enums"
import { cloneLayout, DEFAULT_LAYOUT } from "@/lib/layout/presets"
import type { FilterSectionId, HomeBlock, LayoutConfig } from "@/lib/layout/types"
import type { HMCategory, HMFilter, HMSection, HomepageDoc } from "@/lib/model/homepage"
import { APP_TO_HM_CATEGORY, HM_TO_APP_CATEGORIES, HM_TO_APP_COLOR } from "@/lib/model/mapping"
import { modelCategoryOrder, modelDepartment, modelHeroAd } from "@/lib/model/policy"
import type { SessionDecisions, SessionEvent } from "@/lib/model/sessionStyle"
import type { StoreEvent } from "@/lib/sim/protocol"
import { PRODUCTS } from "@/lib/store/catalog"
import { CATEGORIES, type Category, type Product } from "@/lib/store/types"

function uniq<T>(xs: T[]): T[] {
  return xs.filter((x, i) => xs.indexOf(x) === i)
}

export { HM_TO_APP_CATEGORIES, HM_TO_APP_COLOR, HM_TO_APP_DEPARTMENT } from "@/lib/model/mapping"

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

export interface DecisionLogEntry {
  key: string
  value: string
  reason: string
  source: string
  evidence: string
}

export interface ModelLayout {
  layout: LayoutConfig
  categoryOrder: Category[]
  landingDepartment: "women" | "men"
  highlightColors: StoreColor[]
  comparePanel: boolean
  recentlyViewedProminent: boolean
  cartReminder: boolean
  productPage: "compact" | "standard" | "detailed"
  log: DecisionLogEntry[]
}

const FILTER_IDS = new Set<string>(DEFAULT_LAYOUT.listing.filterOrder)

function asFilter(id: HMFilter): FilterSectionId | null {
  return FILTER_IDS.has(id) ? (id as FilterSectionId) : null
}

/**
 * Live decisions from this visit win once active. Until then, decisions the refresh job stored from
 * earlier visits apply, so a returning shopper starts where they left off.
 */
export function mergeSessionDecisions(
  live?: SessionDecisions,
  stored?: Partial<SessionDecisions> | null,
): SessionDecisions | undefined {
  if (!live && !stored) return undefined
  const keys = ["grid_columns", "compare_panel", "recently_viewed", "quick_add", "cart_reminder", "product_page"] as const
  const out = {} as Record<(typeof keys)[number], unknown>
  for (const key of keys) {
    const current = live?.[key]
    const previous = stored?.[key]
    out[key] = current?.active
      ? current
      : previous?.active
        ? { ...previous, reason: `${previous.reason} (from your last visits)` }
        : (current ?? previous ?? { value: "default", active: false, reason: "Store default" })
  }
  return out as unknown as SessionDecisions
}

function homeBlocks(sections: HMSection[]): HomeBlock[] {
  const rows: HomeBlock[] = sections.map((section) => ({
    type: "product_row",
    source: { kind: section },
    limit: 8,
  }))
  const blocks: HomeBlock[] = [{ type: "hero" }, ...rows]
  if (blocks.length < 3) blocks.push({ type: "category_tiles", categories: CATEGORIES.slice(0, 4) })
  return blocks.slice(0, 8)
}

/**
 * Starting v2 layout from the H&M homepage document, adjusted by live session decisions once they are active.
 * Session decisions only override browsing fields. Tested purchase-based decisions stay.
 */
export function modelLayout(home: HomepageDoc, liveSession?: SessionDecisions): ModelLayout {
  const decisions = home.layout
  const session = mergeSessionDecisions(liveSession, home.session?.decisions)
  const log: DecisionLogEntry[] = []
  const note = (key: string, value: unknown, decision: { reason: string; class: string; validated: boolean | null }) =>
    log.push({
      key,
      value: String(value),
      reason: decision.reason,
      source: decision.class === "Based on your settings" ? "Your settings" : "H&M model",
      evidence: decision.validated ? `${decision.class}, beat store default` : decision.class,
    })
  const live = (key: string, value: unknown, reason: string) =>
    log.push({ key, value: String(value), reason, source: "Live session", evidence: "Estimated from your clicks" })

  const department = modelDepartment(home)
  const landing = department ?? "women"
  const navOrder: NavItemId[] = department
    ? [department, ...DEFAULT_LAYOUT.nav.order.filter((id) => id !== department)]
    : [...DEFAULT_LAYOUT.nav.order]
  const filterOrder = uniq<FilterSectionId>([
    ...decisions.filter_order.value.map(asFilter).filter((id): id is FilterSectionId => id !== null),
    ...DEFAULT_LAYOUT.listing.filterOrder,
  ])
  const expandedFilters: FilterSectionId[] = decisions.price_filter_first.value
    ? ["price", "sale"]
    : decisions.color_highlight.value.length
      ? ["color"]
      : [...DEFAULT_LAYOUT.listing.expandedFilters]
  const sections = uniq(decisions.section_order.value)
  const highlightColors = uniq(
    [
      ...((home.preferences?.color_filters ?? []) as StoreColor[]),
      ...decisions.color_highlight.value.map((color) => HM_TO_APP_COLOR[color]).filter((color): color is StoreColor => !!color),
    ],
  ).slice(0, 3)

  let gridDensity: 2 | 3 | 4 = decisions.grid_columns.value
  let quickView = false
  let heroSize: "full" | "compact" = "full"
  let comparePanel = false
  let recentlyViewed = decisions.recently_viewed.value === "prominent"
  let cartReminder = false
  let productPage: ModelLayout["productPage"] = "standard"

  note("defaultSort", decisions.default_sort.value, decisions.default_sort)
  note("sectionOrder", sections.join(" > "), decisions.section_order)
  note("categoryOrder", decisions.category_order.value[0], decisions.category_order)
  note("highlightColors", highlightColors.join(", ") || "none", decisions.color_highlight)
  note("hero", decisions.hero.value, decisions.hero)
  note("filterOrder", filterOrder.join(" > "), decisions.filter_order)
  note("popup", decisions.popups.value, decisions.popups)

  if (session) {
    if (session.grid_columns.active) {
      gridDensity = session.grid_columns.value
      live("gridDensity", gridDensity, session.grid_columns.reason)
    }
    if (session.quick_add.active) {
      quickView = true
      live("quickView", true, session.quick_add.reason)
    }
    if (session.compare_panel.active) {
      comparePanel = true
      live("comparePanel", "on", session.compare_panel.reason)
    }
    if (session.recently_viewed.active) {
      recentlyViewed = true
      live("recentlyViewed", "prominent", session.recently_viewed.reason)
    }
    if (session.cart_reminder.active) {
      cartReminder = true
      live("cartReminder", "on", session.cart_reminder.reason)
    }
    if (session.product_page.active) {
      productPage = session.product_page.value
      heroSize = productPage === "compact" ? "compact" : "full"
      live("productPage", productPage, session.product_page.reason)
    }
  }
  if (!session?.grid_columns.active) note("gridDensity", gridDensity, decisions.grid_columns)

  const layout = cloneLayout(DEFAULT_LAYOUT)
  const heroAd = modelHeroAd(home, department)
  layout.nav = {
    order: navOrder,
    highlight: department,
    department,
    searchEmphasized: false,
  }
  layout.home = {
    ...layout.home,
    blocks: homeBlocks(sections),
    heroSize,
    forYouIds: forYouIds(home),
    basketIds: [],
  }
  layout.listing = {
    ...layout.listing,
    defaultSort: decisions.default_sort.value,
    filterOrder,
    expandedFilters,
    gridDensity,
    colorHighlight: highlightColors,
    categoryOrder: modelCategoryOrder(home),
    card: {
      ...layout.listing.card,
      priceStyle: sections[0] === "sale" || decisions.price_filter_first.value ? "sale_emphasis" : "plain",
      quickView: quickView ? "emphasized" : "button",
    },
  }
  layout.ads = {
    placements: layout.ads.placements
      .filter((placement) => decisions.popups.value === "on" || placement.slot !== "popup")
      .map((placement) => (placement.slot === "hero" ? { ...placement, adIds: [heroAd] } : placement)),
  }

  return {
    layout,
    categoryOrder: layout.listing.categoryOrder,
    landingDepartment: landing,
    highlightColors,
    comparePanel,
    recentlyViewedProminent: recentlyViewed,
    cartReminder,
    productPage,
    log,
  }
}

function hashId(id: string): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619) >>> 0
  return hash % 2147483647
}

/**
 * Store event -> session model event. Product views count as clicks, add-to-bag as carts.
 * The demo has no order event; call tracker.add({ ts, aid, type: 2 }) at checkout if you add one.
 */
export function fromStoreEvent(event: StoreEvent): SessionEvent | null {
  const properties = event.properties ?? {}
  const id = properties.productId ?? properties.product_id ?? properties.id
  if (id === undefined || id === null || typeof id === "boolean") return null
  const aid = typeof id === "number" ? id : hashId(String(id))
  const ts = Math.floor(event.timestamp / 1000)
  if (event.type === "product_viewed" || event.type === "quickview_opened") return { ts, aid, type: 0 }
  if (event.type === "add_to_bag") return { ts, aid, type: 1 }
  return null
}
