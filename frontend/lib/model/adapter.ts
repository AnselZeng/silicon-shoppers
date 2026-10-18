// Turns the two models into the store's own types:
//   H&M homepage document (who the shopper is, from purchase history)  -> starting LayoutConfig
//   live session decisions (how they browse right now, from OTTO-trained model) -> adjustments as they click
// plus helpers to order the demo catalog by the shopper's predicted mix and to feed store events to the tracker.

import type { FilterSectionId, HeroVariant, HomeSectionId, LayoutConfig } from "@/lib/layout/types";
import { DEFAULT_LAYOUT } from "@/lib/layout/presets";
import type { SortOption } from "@/lib/personas/schema";
import type { StoreColor } from "@/config/ui";
import type { StoreEvent } from "@/lib/sim/protocol";
import { CATEGORIES, type Category, type Department, type Product } from "@/lib/store/types";
import type { HMCategory, HMDepartment, HomepageDoc } from "./homepage";
import type { SessionDecisions, SessionEvent } from "./sessionStyle";

// ---------- vocabulary bridges (H&M data -> demo store) ----------

/** Demo-store categories that belong to each H&M product group. */
export const HM_TO_APP_CATEGORIES: Record<HMCategory, Category[]> = {
  cat_garment_upper_body: ["tshirts", "shirts", "knitwear", "jackets", "coats"],
  cat_garment_lower_body: ["jeans", "trousers", "skirts"],
  cat_garment_full_body: ["dresses"],
  cat_shoes: ["shoes"],
  cat_accessories: ["bags"],
  cat_swimwear: [],
  cat_underwear: [],
  cat_other: [],
};

const APP_TO_HM_CATEGORY = Object.fromEntries(
  (Object.entries(HM_TO_APP_CATEGORIES) as [HMCategory, Category[]][]).flatMap(([hm, cats]) => cats.map((c) => [c, hm])),
) as Record<Category, HMCategory>;

/** H&M master colors that have a demo-store equivalent. */
export const HM_TO_APP_COLOR: Record<string, StoreColor> = {
  Black: "black",
  White: "white",
  Beige: "beige",
  Blue: "navy",
  Grey: "grey",
  "Khaki green": "olive",
  Red: "burgundy",
  Brown: "brown",
  Mole: "brown",
};

export const HM_TO_APP_DEPARTMENT: Partial<Record<HMDepartment, Department>> = {
  dept_ladieswear: "women",
  dept_divided: "women",
  dept_menswear: "men",
};

// ---------- layout ----------

const FILTER_MAP: Record<string, FilterSectionId> = {
  category: "category",
  size: "size",
  color: "color",
  price: "price",
  sale: "sale",
  collection: "collection",
};

const SECTION_MAP: Record<string, HomeSectionId | null> = {
  new_in: "new_in",
  sale: "sale_picks",
  bestsellers: "bestsellers",
  buy_again: null, // the demo store has no Buy Again row
};

const HERO_MAP: Record<string, HeroVariant> = {
  editorial: "editorial",
  discount: "discount_banner",
  new_drop: "new_drop_banner",
  category: "collection_banner",
};

export interface DecisionLogEntry {
  key: string;
  value: string;
  reason: string;
  source: "H&M model" | "Live session" | "Your settings" | "Default";
  /** Tested = beat the store default on held-out purchases; Estimated = browsing-based */
  evidence: string;
}

export interface ModelLayout {
  layout: LayoutConfig;
  /** Demo-store categories in predicted order (unmapped categories keep their default position at the end). */
  categoryOrder: Category[];
  landingDepartment: Department;
  highlightColors: StoreColor[];
  comparePanel: boolean;
  recentlyViewedProminent: boolean;
  cartReminder: boolean;
  productPage: "compact" | "standard" | "detailed";
  /** One line per decision for the Terminal / explanation panel. */
  log: DecisionLogEntry[];
}

function uniq<T>(xs: T[]): T[] {
  return xs.filter((x, i) => xs.indexOf(x) === i);
}

/**
 * Starting layout from the H&M homepage document, adjusted by live session decisions once they are active.
 * Session decisions only override browsing-based ("Estimated") fields; tested purchase-based decisions stay.
 */
/**
 * Live decisions from this visit win once active; until then, decisions the refresh job stored from the
 * shopper's earlier visits (home.session.decisions) apply, so a returning shopper starts where they left off.
 */
export function mergeSessionDecisions(live?: SessionDecisions, stored?: Partial<SessionDecisions> | null): SessionDecisions | undefined {
  if (!live && !stored) return undefined;
  const keys = ["grid_columns", "compare_panel", "recently_viewed", "quick_add", "cart_reminder", "product_page"] as const;
  const out = {} as Record<(typeof keys)[number], unknown>;
  for (const k of keys) {
    const l = live?.[k];
    const s = stored?.[k];
    out[k] = l?.active ? l : s?.active ? { ...s, reason: `${s.reason} (from your last visits)` } : l ?? s ??
      { value: "default", active: false, reason: "Store default" };
  }
  return out as unknown as SessionDecisions;
}

export function modelLayout(home: HomepageDoc, liveSession?: SessionDecisions): ModelLayout {
  const L = home.layout;
  const session = mergeSessionDecisions(liveSession, home.session?.decisions);
  const log: DecisionLogEntry[] = [];
  const h = (key: string, value: unknown, d: { reason: string; class: string; validated: boolean | null }) =>
    log.push({ key, value: String(value), reason: d.reason,
               source: d.class === "Based on your settings" ? "Your settings" : "H&M model",
               evidence: d.validated ? `${d.class}, beat store default` : d.class });
  const s = (key: string, value: unknown, reason: string) =>
    log.push({ key, value: String(value), reason, source: "Live session", evidence: "Estimated from your clicks" });

  const filterOrder = uniq<FilterSectionId>([
    ...L.filter_order.value.map((f) => FILTER_MAP[f]).filter(Boolean),
    ...DEFAULT_LAYOUT.filterOrder,
  ]);
  const expandedFilters: FilterSectionId[] = L.price_filter_first.value
    ? ["price", "sale"]
    : L.color_highlight.value.length
      ? ["color"]
      : [...DEFAULT_LAYOUT.expandedFilters];
  const homeSectionOrder = uniq<HomeSectionId>([
    ...L.section_order.value.map((x) => SECTION_MAP[x]).filter((x): x is HomeSectionId => x !== null),
    ...DEFAULT_LAYOUT.homeSectionOrder,
  ]);
  const heroVariant = HERO_MAP[L.hero.value] ?? DEFAULT_LAYOUT.heroVariant;

  let gridDensity: 2 | 3 | 4 = L.grid_columns.value;
  let quickView = false;
  let heroMinimized = false;
  let comparePanel = false;
  let recentlyViewed = L.recently_viewed.value === "prominent";
  let cartReminder = false;
  let productPage: ModelLayout["productPage"] = "standard";

  h("defaultSort", L.default_sort.value, L.default_sort);
  h("homeSectionOrder", homeSectionOrder.join(" > "), L.section_order);
  h("categoryOrder", L.category_order.value[0], L.category_order);
  h("highlightColors", L.color_highlight.value.join(", ") || "none", L.color_highlight);
  h("heroVariant", heroVariant, L.hero);
  h("filterOrder", filterOrder.join(" > "), L.filter_order);
  h("popup", L.popups.value, L.popups);

  if (session) {
    if (session.grid_columns.active) { gridDensity = session.grid_columns.value; s("gridDensity", gridDensity, session.grid_columns.reason); }
    if (session.quick_add.active) { quickView = true; s("quickViewEmphasis", true, session.quick_add.reason); }
    if (session.compare_panel.active) { comparePanel = true; s("comparePanel", "on", session.compare_panel.reason); }
    if (session.recently_viewed.active) { recentlyViewed = true; s("recentlyViewed", "prominent", session.recently_viewed.reason); }
    if (session.cart_reminder.active) { cartReminder = true; s("cartReminder", "on", session.cart_reminder.reason); }
    if (session.product_page.active) {
      productPage = session.product_page.value;
      heroMinimized = productPage === "compact";
      s("productPage", productPage, session.product_page.reason);
    }
  }
  if (!session?.grid_columns.active) h("gridDensity", gridDensity, L.grid_columns);

  const categoryOrder = uniq<Category>([
    ...L.category_order.value.flatMap((c) => HM_TO_APP_CATEGORIES[c] ?? []),
    ...CATEGORIES,
  ]);

  return {
    layout: {
      ...DEFAULT_LAYOUT,
      defaultSort: L.default_sort.value as SortOption,
      filterOrder,
      expandedFilters,
      heroVariant,
      popupEnabled: L.popups.value === "on",
      popupVariant: L.hero.value === "new_drop" ? "new_drop" : "newsletter",
      gridDensity,
      homeSectionOrder,
      showSaleBadgesProminently: L.section_order.value[0] === "sale" || L.price_filter_first.value,
      quickViewEmphasis: quickView,
      searchEmphasized: false,
      heroMinimized,
    },
    categoryOrder,
    landingDepartment: HM_TO_APP_DEPARTMENT[L.landing_department.value] ?? "women",
    highlightColors: uniq([
      ...((home.preferences?.color_filters ?? []) as StoreColor[]),
      ...L.color_highlight.value.map((c) => HM_TO_APP_COLOR[c]).filter((c): c is StoreColor => !!c),
    ]).slice(0, 3),
    comparePanel,
    recentlyViewedProminent: recentlyViewed,
    cartReminder,
    productPage,
    log,
  };
}

// ---------- catalog ordering ----------

/**
 * Orders demo-store products by how well they fit the shopper's predicted next purchases:
 * predicted share of the product's H&M group x department fit, boosted for highlighted colors,
 * with popularity as a tie-breaker. Products in groups the model can't map keep a small base score.
 */
export function rankCatalog(products: Product[], home: HomepageDoc): Product[] {
  if (home.store_products?.length) {
    // refresh job's ranking (predicted mix + what they viewed + trending; bagged items left out), rest after
    const pos = new Map(home.store_products.map((p, i) => [p.product_id, i]));
    const ranked = products.filter((p) => pos.has(p.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
    return [...ranked, ...rankCatalogFromMix(products.filter((p) => !pos.has(p.id)), home)];
  }
  return rankCatalogFromMix(products, home);
}

function rankCatalogFromMix(products: Product[], home: HomepageDoc): Product[] {
  const cat = home.predicted_mix.category;
  const dept = home.predicted_mix.department;
  const women = (dept.dept_ladieswear ?? 0) + (dept.dept_divided ?? 0);
  const men = dept.dept_menswear ?? 0;
  const colors = new Set(home.layout.color_highlight.value.map((c) => HM_TO_APP_COLOR[c]).filter(Boolean));
  const groupSize: Partial<Record<HMCategory, number>> = {};
  for (const [hm, cats] of Object.entries(HM_TO_APP_CATEGORIES) as [HMCategory, Category[]][]) groupSize[hm] = cats.length;
  const score = (p: Product) => {
    const hm = APP_TO_HM_CATEGORY[p.category];
    const share = hm ? (cat[hm] ?? 0) / (groupSize[hm] || 1) : 0.01;
    const deptFit = p.department === "men" ? men : women;
    const colorBoost = p.colors.some((c) => colors.has(c)) ? 1.5 : 1;
    return share * (0.2 + deptFit) * colorBoost + 1e-4 * p.popularity;
  };
  return [...products].sort((a, b) => score(b) - score(a));
}

// ---------- events ----------

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h % 2147483647;
}

/**
 * Store event -> session model event. Product views count as clicks, add-to-bag as carts.
 * The demo has no order event; call tracker.add({ ts, aid, type: 2 }) at checkout if you add one.
 */
export function fromStoreEvent(e: StoreEvent): SessionEvent | null {
  const p = e.properties ?? {};
  const id = p.productId ?? p.product_id ?? p.id;
  if (id === undefined || id === null) return null;
  const aid = typeof id === "number" ? id : hashId(String(id));
  const ts = Math.floor(e.timestamp / 1000);
  if (e.type === "product_viewed" || e.type === "quickview_opened") return { ts, aid, type: 0 };
  if (e.type === "add_to_bag") return { ts, aid, type: 1 };
  return null;
}
