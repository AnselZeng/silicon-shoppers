// Writes hand-written HomepageDoc fixtures to public/model/fixtures/.
//
// These stand in for the store scoring path's output (build_docs in backend/server/score.py on
// origin/pb-backend) until the backend team commits a real sample. The predicted mixes below are made
// up; everything derived from them follows score.py: decision values and reason wording (_hm_layout),
// the extra decisions build_docs adds, and store_products from rank_store (no views, no trending,
// basket items left out, top 24).
//
// Run: npx tsx scripts/make-fixtures.ts

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { HMCategory, HMDepartment, HMSection, HomepageDoc } from "@/lib/model/homepage"
import { APP_TO_HM_CATEGORY, HM_TO_APP_COLOR } from "@/lib/model/mapping"
import { PRODUCTS } from "@/lib/store/catalog"

const OUT = join(process.cwd(), "public/model/fixtures")
const NOW = "2026-10-17T18:00:00"
const CUTOFF = "2026-10-18"

const CATEGORY_KEYS: HMCategory[] = [
  "cat_garment_upper_body",
  "cat_garment_lower_body",
  "cat_garment_full_body",
  "cat_accessories",
  "cat_shoes",
  "cat_underwear",
  "cat_swimwear",
  "cat_other",
]
const CATEGORY_NAMES: Record<HMCategory, string> = {
  cat_garment_upper_body: "Garment Upper body",
  cat_garment_lower_body: "Garment Lower body",
  cat_garment_full_body: "Garment Full body",
  cat_accessories: "Accessories",
  cat_shoes: "Shoes",
  cat_underwear: "Underwear",
  cat_swimwear: "Swimwear",
  cat_other: "Other",
}
/** Store-wide category shares (B["priors"]["category"]), used for the "x the store average" lift. */
const CATEGORY_PRIOR: Record<HMCategory, number> = {
  cat_garment_upper_body: 0.4,
  cat_garment_lower_body: 0.2,
  cat_garment_full_body: 0.12,
  cat_accessories: 0.08,
  cat_shoes: 0.05,
  cat_underwear: 0.08,
  cat_swimwear: 0.04,
  cat_other: 0.03,
}
const DEPT_NAMES: Record<HMDepartment, string> = {
  dept_ladieswear: "Ladieswear",
  dept_menswear: "Menswear",
  dept_divided: "Divided",
  dept_sport: "Sport",
  dept_baby_children: "Baby/Children",
}
const SECTION_LABELS: Record<HMSection, string> = {
  new_in: "New In",
  sale: "Sale",
  bestsellers: "Bestsellers",
  buy_again: "Buy Again",
}
const SORT_LABELS: Record<string, string> = {
  price_asc: "price, low to high",
  price_desc: "price, high to low",
  newest: "newest first",
  bestsellers: "bestsellers first",
  relevance: "relevance",
}
const STORE_DEFAULT_SORT = "bestsellers"
const SALE_HI = 0.35
const HERO_CATEGORY_MIN_SHARE = 0.4
/** Store's two most common master colors' predicted share (mp[pop2].sum()). */
const TOP_COLOR_SHARE = 0.38
const VALIDATED: Record<string, boolean> = {
  landing_department: false,
  category_order: true,
  section_order: true,
  default_sort: false,
  color_highlight: false,
}

interface Spec {
  id: string
  label: string
  description: string
  basket: string[]
  dept: Record<HMDepartment, number>
  cat: Record<HMCategory, number>
  sec: Record<HMSection, number>
  sort: "price_asc" | "newest" | "bestsellers"
  /** H&M master colors and their predicted share (empty = no highlight). */
  colors: { names: string[]; share: number }
  llm?: string
}

const pct = (x: number) => `${Math.round(100 * x)}%`
const desc = <K extends string>(rec: Record<K, number>) =>
  (Object.keys(rec) as K[]).sort((a, b) => rec[b] - rec[a])

function layoutFor(spec: Spec, nCarts: number): HomepageDoc["layout"] {
  const catOrder = CATEGORY_KEYS.slice().sort((a, b) => spec.cat[b] - spec.cat[a])
  const top = catOrder[0] as HMCategory
  const lift = spec.cat[top] / CATEGORY_PRIOR[top]
  const land = desc(spec.dept)[0] as HMDepartment
  const secOrder = desc(spec.sec)
  const s0 = secOrder[0] as HMSection
  const evidence = nCarts
    ? `from your ${nCarts} add-to-bag${nCarts !== 1 ? "s" : ""}`
    : "for a new shopper (nothing in your bag yet)"
  const priceFirst = spec.sec.sale >= SALE_HI
  let filters: ("category" | "size" | "color" | "price" | "sale")[] = ["category", "size", "color", "price", "sale"]
  if (priceFirst) filters = ["price", "sale", ...filters.filter((x) => x !== "price" && x !== "sale")]
  if (spec.colors.names.length) filters = ["color", ...filters.filter((x) => x !== "color")]
  const hero =
    s0 === "sale" ? "discount" : s0 === "new_in" ? "new_drop" : spec.cat[top] >= HERO_CATEGORY_MIN_SHARE ? "category" : "editorial"
  const T = <V>(value: V, key: string, reason: string) => ({
    value,
    class: "Tested" as const,
    validated: Boolean(VALIDATED[key]),
    reason,
  })
  const A = <V>(value: V, reason: string) => ({ value, class: "Assumed" as const, validated: null, reason })
  const colors = spec.colors.names
  return {
    landing_department: T(land, "landing_department", `${DEPT_NAMES[land]}: about ${pct(spec.dept[land])} of your next picks (predicted ${evidence})`),
    category_order: T(
      catOrder,
      "category_order",
      `${CATEGORY_NAMES[top]} first: about ${pct(spec.cat[top])} of your next picks ` +
        (lift >= 1.2 ? `(${lift.toFixed(1)}x the store average)` : "(your most likely category)"),
    ),
    section_order: T(secOrder, "section_order", `${SECTION_LABELS[s0]} first: about ${pct(spec.sec[s0])} of your next picks are likely to come from it`),
    default_sort: T(
      spec.sort,
      "default_sort",
      `Sorted ${SORT_LABELS[spec.sort]}` + (spec.sort === STORE_DEFAULT_SORT ? ": store default, no shopper beat it on held-out data" : ""),
    ),
    color_highlight: T(
      colors,
      "color_highlight",
      colors.length
        ? `You're likely to pick ${colors.map((c) => c.toLowerCase()).join(" and ")} (about ${pct(spec.colors.share)} of next picks vs ${pct(TOP_COLOR_SHARE)} for the store's top colors)`
        : "No color highlight: your predicted colors match the store's",
    ),
    price_filter_first: A(priceFirst, priceFirst ? "Price filter first: sale items predicted to matter" : "Default filters"),
    filter_order: A(
      filters,
      filters.join() !== "category,size,color,price,sale" ? "Filters reordered to match your predicted shopping" : "Store default filters",
    ),
    hero: A(
      hero,
      {
        discount: "Sale banner: Sale is your top section",
        new_drop: "New-drop banner: New In is your top section",
        category: `Banner for ${CATEGORY_NAMES[top]}, your top predicted category`,
        editorial: "Editorial banner (store default)",
      }[hero],
    ),
    popups: { value: "off", class: "Based on your settings", validated: null, reason: "No newsletter sign-up on record" },
    grid_columns: { value: 3, class: "Estimated", validated: null, reason: "Store default until the live model has enough clicks" },
    recently_viewed: { value: "default", class: "Estimated", validated: null, reason: "Store default until the live model has enough clicks" },
    compare_panel: { value: "default", class: "Estimated", validated: null, reason: "Set by the live session model (see session.decisions)" },
    cart_reminder: { value: "default", class: "Estimated", validated: null, reason: "Set by the live session model (see session.decisions)" },
  }
}

/** rank_store in score.py with no viewed products and no trending (live = 1, tr = 0). */
function rankStore(spec: Spec): HomepageDoc["store_products"] {
  const women = spec.dept.dept_ladieswear + spec.dept.dept_divided
  const men = spec.dept.dept_menswear
  const hl = new Set(spec.colors.names.map((c) => HM_TO_APP_COLOR[c]).filter(Boolean))
  const groupSize: Partial<Record<HMCategory, number>> = {}
  for (const p of PRODUCTS) {
    const hm = APP_TO_HM_CATEGORY[p.category]
    groupSize[hm] = (groupSize[hm] ?? 0) + 1
  }
  const bagged = new Set(spec.basket)
  const rows = PRODUCTS.filter((p) => !bagged.has(p.id)).map((p) => {
    const hm = APP_TO_HM_CATEGORY[p.category]
    const share = (spec.cat[hm] ?? 0) / Math.max(groupSize[hm] ?? 1, 1)
    const fit = p.department === "men" ? men : women
    const inColor = p.colors.some((c) => hl.has(c))
    const score = share * (0.2 + fit) * (inColor ? 1.5 : 1) + 1e-4 * p.popularity
    return { score, id: p.id, why: inColor ? "in a color you're likely to pick" : "fits your predicted mix" }
  })
  rows.sort((a, b) => b.score - a.score)
  return rows.slice(0, 24).map((r) => ({ product_id: r.id, score: Math.round(r.score * 1e5) / 1e5, why: r.why }))
}

function round4(rec: Record<string, number>) {
  return Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, Math.round(v * 1e4) / 1e4]))
}

function buildDoc(spec: Spec): HomepageDoc {
  const n = spec.basket.length
  return {
    demo_id: spec.id,
    user_id: spec.id,
    stratum: "light",
    cutoff: CUTOFF,
    updated_at: `${NOW}Z`,
    run_id: "fixture",
    model: {
      name: "atelier-shopper-model v2 (frozen fixture)",
      inputs: "purchase features from your add-to-bags, mapped to H&M groups and colors",
    },
    evidence: {
      events: n,
      add_to_bags: n,
      validated_on: "fixture: hand-written, not scored by the model",
      note:
        "Tested = beat the store default on held-out H&M purchases. Your store purchases are mapped to H&M product " +
        "groups and colors; that mapping itself is not tested.",
    },
    layout: layoutFor(spec, n),
    predicted_mix: {
      category: round4(spec.cat) as Record<HMCategory, number>,
      department: round4(spec.dept) as Record<HMDepartment, number>,
      section: round4(spec.sec) as Record<HMSection, number>,
    },
    browsing: { source: "Live session model", match_confidence: 1.0, exploration: 0.5, multi_visit_research: 0.5 },
    products: { for_you: [], rows: {} },
    store_products: rankStore(spec),
    session: null,
    preferences: { sort_counts: {}, filter_counts: {}, color_filters: [], recent_searches: [], filters_first: [] },
  }
}

const SPECS: Spec[] = [
  {
    id: "fixture-men-sale",
    label: "Menswear sale buyer",
    description: "12 add-to-bags, mostly men's pieces bought on markdown.",
    basket: ["m-g12", "m-g16", "m-g17", "m-g22", "m-g31", "m-g42", "m-g56", "m-oxford", "m-navy-tee", "m-g41", "m-g02", "w-sale-crew"],
    dept: { dept_menswear: 0.71, dept_ladieswear: 0.14, dept_divided: 0.09, dept_sport: 0.04, dept_baby_children: 0.02 },
    cat: {
      cat_garment_upper_body: 0.46,
      cat_garment_lower_body: 0.27,
      cat_shoes: 0.09,
      cat_accessories: 0.07,
      cat_underwear: 0.05,
      cat_garment_full_body: 0.02,
      cat_swimwear: 0.02,
      cat_other: 0.02,
    },
    sec: { sale: 0.41, bestsellers: 0.33, buy_again: 0.22, new_in: 0.17 },
    sort: "price_asc",
    colors: { names: ["Blue", "Black"], share: 0.52 },
    llm: "fixture-men-sale.llm.json",
  },
  {
    id: "fixture-women-new",
    label: "Womenswear new-arrival buyer",
    description: "14 add-to-bags, women's pieces bought soon after they landed, many dresses.",
    basket: ["w-winter-puffer", "w-new-dress", "w-sale-knit", "w-g03", "w-g04", "w-g08", "w-g10", "w-g24", "w-g25", "w-g29", "w-g45", "w-g58", "w-g54", "w-g34"],
    dept: { dept_ladieswear: 0.66, dept_divided: 0.18, dept_menswear: 0.08, dept_sport: 0.05, dept_baby_children: 0.03 },
    cat: {
      cat_garment_full_body: 0.36,
      cat_garment_upper_body: 0.33,
      cat_garment_lower_body: 0.17,
      cat_accessories: 0.06,
      cat_shoes: 0.04,
      cat_underwear: 0.02,
      cat_swimwear: 0.01,
      cat_other: 0.01,
    },
    sec: { new_in: 0.52, bestsellers: 0.31, buy_again: 0.15, sale: 0.12 },
    sort: "newest",
    colors: { names: ["Black", "Red"], share: 0.49 },
    llm: "fixture-women-new.llm.json",
  },
  {
    id: "fixture-low-evidence",
    label: "Low-evidence shopper",
    description: "3 add-to-bags across both departments. The model stays close to the store average.",
    basket: ["w-sale-poplin", "m-wool-trouser", "w-g48"],
    dept: { dept_ladieswear: 0.45, dept_menswear: 0.26, dept_divided: 0.17, dept_sport: 0.07, dept_baby_children: 0.05 },
    cat: {
      cat_garment_upper_body: 0.38,
      cat_garment_lower_body: 0.26,
      cat_garment_full_body: 0.13,
      cat_accessories: 0.08,
      cat_underwear: 0.07,
      cat_shoes: 0.05,
      cat_swimwear: 0.02,
      cat_other: 0.01,
    },
    sec: { bestsellers: 0.29, new_in: 0.22, sale: 0.2, buy_again: 0.1 },
    sort: "bestsellers",
    colors: { names: [], share: 0 },
    llm: "fixture-low-evidence.llm.json",
  },
  {
    id: "fixture-divided",
    label: "Divided-heavy shopper",
    description: "11 add-to-bags of young, lower-priced women's pieces: jeans, skirts and tees (H&M Divided).",
    basket: ["w-sale-rib-tee", "w-sale-tank", "w-sale-jean", "w-sale-skirt", "w-g03", "w-g05", "w-g35", "w-g60", "w-g33", "w-g28", "w-g40"],
    dept: { dept_divided: 0.52, dept_ladieswear: 0.21, dept_menswear: 0.15, dept_sport: 0.08, dept_baby_children: 0.04 },
    cat: {
      cat_garment_lower_body: 0.41,
      cat_garment_upper_body: 0.37,
      cat_accessories: 0.08,
      cat_shoes: 0.06,
      cat_garment_full_body: 0.04,
      cat_underwear: 0.02,
      cat_swimwear: 0.01,
      cat_other: 0.01,
    },
    sec: { bestsellers: 0.38, sale: 0.3, new_in: 0.27, buy_again: 0.12 },
    sort: "bestsellers",
    colors: { names: ["Black", "Grey"], share: 0.47 },
  },
]

mkdirSync(OUT, { recursive: true })
const index = SPECS.map((spec) => {
  const file = `${spec.id}.json`
  writeFileSync(join(OUT, file), `${JSON.stringify(buildDoc(spec), null, 2)}\n`)
  return { id: spec.id, label: spec.label, description: spec.description, doc: file, basket: spec.basket, llm: spec.llm ?? null }
})
writeFileSync(join(OUT, "index.json"), `${JSON.stringify({ note: "Hand-written fixtures, not model output. See README.md.", fixtures: index }, null, 2)}\n`)
console.log(`wrote ${index.length} fixtures to ${OUT}`)
