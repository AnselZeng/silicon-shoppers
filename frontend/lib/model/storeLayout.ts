// ONE layout format for the whole store: atelier.store_layout.v1
//
// Three sources, same output, so the UI has a single renderer:
//   1. H&M shopper   fromHmShopper(record)            a real shopper from demo_shoppers.json (purchase models)
//   2. AI shopper    fromAiShopper(id, label, preset, session?)  the simulator persona + live session model
//   3. Tell us       fromIntent(intent)               the sentence the visitor typed (Gemini / keyword fallback)
// Combine them with mergeLayouts(base, ...overlays): later sources win only where they changed something.
// toLayoutConfig(doc) turns the document into the store's existing LayoutConfig for the set_layout message.
//
// Every field is always present. Each one is a Decision: { value, changed, reason, source }.
// changed = false means "same as the normal store"; reason is the "Why am I seeing this?" text.
// Vocabulary: departments and categories use the H&M keys (labels in LABELS); sections, sort, filters, hero
// and grid use the store's own ids, so the UI can render them directly.
//
// This file has no runtime imports, so it works in the browser, on the server and in Node scripts.

import type { Intent } from "@/lib/model/intent";
import type { LayoutConfig } from "@/lib/layout/types";
import type { SessionDecisions } from "@/lib/model/sessionStyle";

// ---------------------------------------------------------------- vocabulary

export const LABELS = {
  departments: {
    dept_ladieswear: "Women", dept_menswear: "Men", dept_divided: "Divided (teen & young)",
    dept_sport: "Sport", dept_baby_children: "Baby & Kids",
  } as Record<string, string>,
  categories: {
    cat_garment_upper_body: "Tops", cat_garment_lower_body: "Bottoms", cat_garment_full_body: "Dresses & jumpsuits",
    cat_swimwear: "Swimwear", cat_underwear: "Underwear", cat_accessories: "Accessories", cat_shoes: "Shoes",
    cat_other: "Other",
  } as Record<string, string>,
};

export type Source = "Store default" | "H&M model" | "AI shopper" | "Live session" | "You said";
export type HomeSection = "new_in" | "bestsellers" | "sale_picks" | "collections";
export type FilterId = "sale" | "price" | "size" | "color" | "category" | "collection";
export type Sort = "relevance" | "newest" | "price_asc" | "price_desc" | "bestsellers";
export type Hero = "editorial" | "discount_banner" | "new_drop_banner" | "collection_banner";

export interface Decision<V> {
  value: V;
  changed: boolean;
  reason: string;
  source: Source;
}

export interface Tile {
  key: string;
  label: string;
  kind: "department" | "category";
  reason: string;
}

export interface StoreLayoutDoc {
  format: "atelier.store_layout.v1";
  source: "hm_shopper" | "ai_shopper" | "tell_us" | "merged";
  shopper: {
    id: string;
    label: string;
    persona: { name: string; description: string } | null;
    confidence: "low" | "medium" | "high";
    /** extra fields stored docs carry (spec allows unknown fields) */
    persona_id?: string;
    persona_reason?: string;
  };
  layout: {
    // homepage structure
    landing_department: Decision<string>;
    department_order: Decision<string[]> & { labels: string[] };
    category_order: Decision<string[]>;
    homepage_sections: Decision<HomeSection[]>;
    quick_access: Decision<string[]> & { tiles: Tile[] };
    hero: Decision<Hero> & { minimized: boolean };
    // shopping tools
    default_sort: Decision<Sort>;
    filter_order: Decision<FilterId[]> & { expanded: FilterId[] };
    price_mode: Decision<boolean> & { budget_rail: boolean };
    budget: Decision<{ amount: number; scope: "per_item" | "total" } | null>;
    color_highlight: Decision<string[]>;
    sale_badges: Decision<"prominent" | "default">;
    search: Decision<"emphasized" | "default">;
    popups: Decision<"off" | "newsletter" | "new_drop">;
    // browsing (live session model, AI shopper)
    grid_columns: Decision<2 | 3 | 4>;
    quick_view: Decision<"emphasized" | "default">;
    quick_add: Decision<"on" | "off">;
    compare_panel: Decision<"on" | "off">;
    recently_viewed: Decision<"prominent" | "default">;
    cart_reminder: Decision<"on" | "off">;
    product_page: Decision<"compact" | "standard" | "detailed">;
    checkout: Decision<"standard" | "guest_express" | "loyalty_pay">;
  };
  /** Product ids (catalog.json) per homepage block, best first. null when the source has no ranking. */
  products: { by_department: { department: string; label: string; items: string[] }[]; budget_picks: string[] } | null;
  /** Stored docs: last refresh timestamp. */
  updated_at?: string;
  /** Stored docs: internals the model still needs (predicted_mix, session, preferences, evidence,
      store_products, hm_products). Renderers ignore this. */
  model_meta?: Record<string, unknown>;
}

export type LayoutKey = keyof StoreLayoutDoc["layout"];

// ---------------------------------------------------------------- the normal store

const DEFAULT_DEPARTMENT_ORDER = ["dept_ladieswear", "dept_divided", "dept_menswear", "dept_baby_children", "dept_sport"];
const DEFAULT_CATEGORY_ORDER = ["cat_garment_upper_body", "cat_garment_lower_body", "cat_garment_full_body",
  "cat_swimwear", "cat_underwear", "cat_accessories", "cat_other", "cat_shoes"];
const DEFAULT_SECTIONS: HomeSection[] = ["new_in", "bestsellers", "sale_picks", "collections"];
const DEFAULT_FILTERS: FilterId[] = ["category", "size", "color", "price", "collection", "sale"];

const d = <V>(value: V, reason = "Store default"): Decision<V> => ({ value, changed: false, reason, source: "Store default" });

export function defaultLayout(): StoreLayoutDoc["layout"] {
  return {
    landing_department: d("dept_ladieswear", "Women (store default)"),
    department_order: { ...d([...DEFAULT_DEPARTMENT_ORDER], "The store's usual order"), labels: DEFAULT_DEPARTMENT_ORDER.map((k) => LABELS.departments[k]) },
    category_order: d([...DEFAULT_CATEGORY_ORDER], "Store's popular order"),
    homepage_sections: d([...DEFAULT_SECTIONS], "Store default order"),
    quick_access: { ...d<string[]>([], "No shortcuts yet"), tiles: [] },
    hero: { ...d<Hero>("editorial"), minimized: false },
    default_sort: d<Sort>("relevance"),
    filter_order: { ...d([...DEFAULT_FILTERS], "Standard filters"), expanded: ["category"] },
    price_mode: { ...d(false, "Standard filters"), budget_rail: false },
    budget: d(null, "No budget set"),
    color_highlight: d<string[]>([], "No color highlight"),
    sale_badges: d<"prominent" | "default">("default"),
    search: d<"emphasized" | "default">("default"),
    popups: d<"off" | "newsletter" | "new_drop">("newsletter"),
    grid_columns: d<2 | 3 | 4>(3),
    quick_view: d<"emphasized" | "default">("default"),
    quick_add: d<"on" | "off">("off"),
    compare_panel: d<"on" | "off">("off"),
    recently_viewed: d<"prominent" | "default">("default"),
    cart_reminder: d<"on" | "off">("off"),
    product_page: d<"compact" | "standard" | "detailed">("standard"),
    checkout: d<"standard" | "guest_express" | "loyalty_pay">("standard"),
  };
}

function doc(source: StoreLayoutDoc["source"], shopper: StoreLayoutDoc["shopper"]): StoreLayoutDoc {
  return { format: "atelier.store_layout.v1", source, shopper, layout: defaultLayout(), products: null };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function set<K extends LayoutKey>(docu: StoreLayoutDoc, key: K, value: StoreLayoutDoc["layout"][K]["value"],
  reason: string, source: Source, extra: Partial<StoreLayoutDoc["layout"][K]> = {}) {
  const before = defaultLayout()[key];
  const changed = !same(value, before.value) || Object.keys(extra).some((k) => !same((extra as never)[k], (before as never)[k]));
  docu.layout[key] = { ...before, ...extra, value, changed, reason: changed ? reason : before.reason,
    source: changed ? source : "Store default" } as StoreLayoutDoc["layout"][K];
}

// ---------------------------------------------------------------- 1. H&M shopper (demo_shoppers.json record)

/** Shape of one shoppers[] record in model/outputs/web/demo_shoppers.json (h&m-model branch). */
export interface HmShopperRecord {
  id: string;
  confidence: "low" | "medium" | "high";
  persona: { id: number; name: string; description: string };
  layout: Record<string, { value: unknown; changed: boolean; reason: string; tiles?: Tile[]; filter_order?: string[] | null; budget_rail?: boolean }>;
  products: { by_department: { department: string; label: string; items: string[] }[]; budget_picks: string[] };
}

const HM_SECTION: Record<string, HomeSection> = { new_in: "new_in", sale: "sale_picks", bestsellers: "bestsellers" };

export function fromHmShopper(rec: HmShopperRecord, label?: string): StoreLayoutDoc {
  const out = doc("hm_shopper", { id: rec.id, label: label ?? rec.persona.name, persona: { name: rec.persona.name,
    description: rec.persona.description }, confidence: rec.confidence });
  const L = rec.layout;
  const src: Source = "H&M model";
  const take = (k: string) => (L[k]?.changed ? L[k] : null);

  if (take("landing_department")) set(out, "landing_department", L.landing_department.value as string, L.landing_department.reason, src);
  if (take("department_order")) {
    const v = L.department_order.value as string[];
    set(out, "department_order", v, L.department_order.reason, src, { labels: v.map((k) => LABELS.departments[k]) });
  }
  if (take("category_order")) set(out, "category_order", L.category_order.value as string[], L.category_order.reason, src);
  if (take("homepage_sections")) {
    const v = (L.homepage_sections.value as string[]).map((s) => HM_SECTION[s]).filter(Boolean);
    set(out, "homepage_sections", [...v, "collections"], L.homepage_sections.reason, src);
  }
  if (take("quick_access")) set(out, "quick_access", L.quick_access.value as string[], L.quick_access.reason, src, { tiles: L.quick_access.tiles ?? [] });
  if (take("price_mode")) {
    const f = ((L.price_mode.filter_order ?? []) as FilterId[]).concat("collection");
    set(out, "price_mode", true, L.price_mode.reason, src, { budget_rail: Boolean(L.price_mode.budget_rail) });
    set(out, "filter_order", f, L.price_mode.reason, src, { expanded: ["price", "sale"] });
  }
  if (take("color_highlight")) set(out, "color_highlight", L.color_highlight.value as string[], L.color_highlight.reason, src);
  if (take("default_sort")) set(out, "default_sort", L.default_sort.value as Sort, L.default_sort.reason, src);
  out.products = rec.products;
  return out;
}

// ---------------------------------------------------------------- 2. AI shopper (simulator persona + live session)

const PERSONA_HABIT: Record<string, string> = {
  price_hunter: "sorts by price, filters sale, closes pop-ups",
  trend_seeker: "sorts by newest, filters by color, uses quick view",
  mission_shopper: "searches, filters by size, short path to checkout",
  brand_loyalist: "bestsellers, the Essentials collection, wishlist",
};
const PERSONA_CHECKOUT: Record<string, "guest_express" | "loyalty_pay"> = {
  price_hunter: "guest_express", mission_shopper: "guest_express", brand_loyalist: "loyalty_pay",
};

/**
 * personaId/label: what the simulator engine classified (e.g. "price_hunter", "Price Hunter").
 * preset: that persona's LayoutConfig (PERSONA_LAYOUTS[personaId] in lib/layout/presets.ts).
 * session: optional SessionTracker decisions; active ones override the browsing fields.
 */
export function fromAiShopper(personaId: string, label: string, preset: LayoutConfig, session?: SessionDecisions,
  confidence: "low" | "medium" | "high" = "medium"): StoreLayoutDoc {
  const out = doc("ai_shopper", { id: `ai_${personaId}`, label, persona: { name: label,
    description: `AI shopper: ${PERSONA_HABIT[personaId] ?? "simulated browsing"}` }, confidence });
  const why = (what: string) => `Detected ${label} (${PERSONA_HABIT[personaId] ?? "browsing pattern"}): ${what}`;
  const src: Source = "AI shopper";
  const SORT_WORDS: Record<string, string> = { price_asc: "price low to high", price_desc: "price high to low",
    newest: "newest first", bestsellers: "bestsellers first", relevance: "most relevant first" };
  set(out, "default_sort", preset.defaultSort as Sort, why(`sorted ${SORT_WORDS[preset.defaultSort] ?? preset.defaultSort}`), src);
  set(out, "filter_order", preset.filterOrder as FilterId[], why(`${preset.filterOrder[0]} filter first`), src,
    { expanded: preset.expandedFilters as FilterId[] });
  set(out, "hero", preset.heroVariant as Hero, why(`${preset.heroVariant.replace(/_/g, " ")}`), src, { minimized: preset.heroMinimized });
  set(out, "popups", preset.popupEnabled ? (preset.popupVariant as "newsletter" | "new_drop") : "off",
    why(preset.popupEnabled ? `${preset.popupVariant.replace("_", " ")} pop-up` : "pop-ups off"), src);
  set(out, "grid_columns", preset.gridDensity as 2 | 3 | 4, why(`${preset.gridDensity} products per row`), src);
  set(out, "homepage_sections", preset.homeSectionOrder as HomeSection[], why(`${preset.homeSectionOrder[0].replace("_", " ")} first`), src);
  set(out, "sale_badges", preset.showSaleBadgesProminently ? "prominent" : "default", why("sale badges stand out"), src);
  set(out, "quick_view", preset.quickViewEmphasis ? "emphasized" : "default", why("quick view up front"), src);
  set(out, "search", preset.searchEmphasized ? "emphasized" : "default", why("search up front"), src);
  set(out, "price_mode", preset.defaultSort === "price_asc", why("price-first shopping"), src, { budget_rail: preset.defaultSort === "price_asc" });
  const co = PERSONA_CHECKOUT[personaId];
  if (co) set(out, "checkout", co, why(co === "guest_express" ? "guest express checkout" : "loyalty pay at checkout"), src);
  if (session) applySession(out, session);
  return out;
}

/** Live session decisions (SessionTracker.add(...).decisions) override browsing fields once active. */
export function applySession(out: StoreLayoutDoc, s: SessionDecisions): StoreLayoutDoc {
  const src: Source = "Live session";
  if (s.grid_columns.active) set(out, "grid_columns", s.grid_columns.value as 2 | 3 | 4, s.grid_columns.reason, src);
  if (s.quick_add.active) set(out, "quick_add", s.quick_add.value as "on" | "off", s.quick_add.reason, src);
  if (s.compare_panel.active) set(out, "compare_panel", s.compare_panel.value as "on" | "off", s.compare_panel.reason, src);
  if (s.recently_viewed.active) set(out, "recently_viewed", s.recently_viewed.value as "prominent" | "default", s.recently_viewed.reason, src);
  if (s.cart_reminder.active) set(out, "cart_reminder", s.cart_reminder.value as "on" | "off", s.cart_reminder.reason, src);
  if (s.product_page.active) set(out, "product_page", s.product_page.value as "compact" | "standard" | "detailed", s.product_page.reason, src);
  return out;
}

// ---------------------------------------------------------------- 3. Tell us (Intent from /api/intent)

export function fromIntent(intent: Intent): StoreLayoutDoc {
  const out = doc("tell_us", { id: "tell_us", label: "You", persona: null, confidence: "high" });
  const why = `You said: "${intent.summary}"`;
  const src: Source = "You said";
  const [first, ...rest] = intent.departments;
  if (first) {
    set(out, "landing_department", first, why, src);
    const asked: string[] = intent.departments;
    const order = [...asked, ...DEFAULT_DEPARTMENT_ORDER.filter((k) => !asked.includes(k))];
    set(out, "department_order", order, why, src, { labels: order.map((k) => LABELS.departments[k]) });
  }
  if (rest.length) {
    set(out, "quick_access", rest, why, src, { tiles: rest.map((k) => ({ key: k, label: LABELS.departments[k],
      kind: "department" as const, reason: why })) });
  }
  const priceMode = intent.priority === "price" || intent.budget !== null;
  if (priceMode) {
    set(out, "price_mode", true, why, src, { budget_rail: true });
    set(out, "filter_order", ["price", "sale", "category", "size", "color", "collection"], why, src, { expanded: ["price", "sale"] });
  }
  if (intent.budget) set(out, "budget", intent.budget, why, src);
  const firstSection: HomeSection | undefined =
    intent.priority === "new" ? "new_in" : priceMode ? "sale_picks"
      : intent.priority === "popular" || intent.priority === "classics" ? "bestsellers" : undefined;
  if (firstSection) set(out, "homepage_sections", [firstSection, ...DEFAULT_SECTIONS.filter((s) => s !== firstSection)], why, src);
  if (intent.priority === "new") set(out, "default_sort", "newest", why, src);
  return out;
}

// ---------------------------------------------------------------- combine and hand to the store

/** Start from `base`, then apply each overlay's changed decisions (later overlays win). Products come from the first source that has them. */
export function mergeLayouts(base: StoreLayoutDoc, ...overlays: StoreLayoutDoc[]): StoreLayoutDoc {
  const out: StoreLayoutDoc = JSON.parse(JSON.stringify(base));
  for (const o of overlays) {
    for (const key of Object.keys(o.layout) as LayoutKey[]) {
      if (o.layout[key].changed) (out.layout as Record<string, unknown>)[key] = o.layout[key];
    }
    out.products = out.products ?? o.products;
  }
  if (overlays.length) out.source = "merged";
  return out;
}

/** The store's existing LayoutConfig (for set_layout). Partial: callers spread it over their DEFAULT_LAYOUT. */
export function toLayoutConfig(docu: StoreLayoutDoc): Partial<LayoutConfig> {
  const L = docu.layout;
  return {
    defaultSort: L.default_sort.value as LayoutConfig["defaultSort"],
    filterOrder: L.filter_order.value as LayoutConfig["filterOrder"],
    expandedFilters: L.filter_order.expanded as LayoutConfig["expandedFilters"],
    heroVariant: L.hero.value as LayoutConfig["heroVariant"],
    heroMinimized: L.hero.minimized,
    popupEnabled: L.popups.value !== "off",
    popupVariant: (L.popups.value === "off" ? "newsletter" : L.popups.value) as LayoutConfig["popupVariant"],
    gridDensity: L.grid_columns.value,
    homeSectionOrder: L.homepage_sections.value as LayoutConfig["homeSectionOrder"],
    showSaleBadgesProminently: L.sale_badges.value === "prominent",
    quickViewEmphasis: L.quick_view.value === "emphasized" || L.quick_add.value === "on",
    searchEmphasized: L.search.value === "emphasized",
  };
}

/** Every changed decision as one line, for the Terminal panel: "[H&M model] department_order: Women first; ...". */
export function changeLog(docu: StoreLayoutDoc): string[] {
  return (Object.keys(docu.layout) as LayoutKey[])
    .filter((k) => docu.layout[k].changed)
    .map((k) => `[${docu.layout[k].source}] ${k}: ${docu.layout[k].reason}`);
}
