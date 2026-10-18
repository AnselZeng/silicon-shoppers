// Types for the per-shopper homepage document produced by the H&M model.
// Ported from backend/server/app/lib/model/homepage.ts (origin/pb-backend). For store shoppers the
// document comes from build_docs in backend/server/score.py. The live-session model is out of scope
// here, so `session` is typed loosely and never read.

export type DecisionClass = "Tested" | "Estimated" | "Assumed" | "Based on your settings"

export interface Decision<V> {
  value: V
  class: DecisionClass
  /** true = confirmed on held-out H&M purchases (set per decision type for the whole build); null = not testable */
  validated: boolean | null
  reason: string
}

/** H&M product groups, in the order the model predicts the shopper's next purchases */
export type HMCategory =
  | "cat_garment_upper_body"
  | "cat_garment_lower_body"
  | "cat_garment_full_body"
  | "cat_swimwear"
  | "cat_underwear"
  | "cat_accessories"
  | "cat_shoes"
  | "cat_other"

export type HMDepartment = "dept_ladieswear" | "dept_menswear" | "dept_divided" | "dept_sport" | "dept_baby_children"
export type HMSection = "new_in" | "sale" | "bestsellers" | "buy_again"
export type HMSort = "bestsellers" | "newest" | "price_asc" | "price_desc" | "relevance"
export type HMHero = "editorial" | "discount" | "new_drop" | "category"
export type HMFilter = "category" | "size" | "color" | "price" | "sale" | "collection"

export interface ProductTile {
  article_id: string
  name: string
  category: HMCategory
  department: string
  color: string
  price_scaled: number | null
  score: number
  why: string
  bought_before: boolean
}

/** One store product picked for the shopper (score.py rank_store). Basket items are left out. */
export interface StoreProductPick {
  product_id: string
  score: number
  why: string
}

/** Sorts and filters the shopper keeps choosing. */
export interface ShopperPreferences {
  sort?: string
  sort_counts: Record<string, number>
  filter_counts: Record<string, number>
  filters_first: string[]
  color_filters: string[]
  recent_searches: string[]
}

export interface HomepageLayout {
  landing_department: Decision<HMDepartment>
  category_order: Decision<HMCategory[]>
  section_order: Decision<HMSection[]>
  default_sort: Decision<HMSort>
  color_highlight: Decision<string[]>
  price_filter_first: Decision<boolean>
  filter_order: Decision<HMFilter[]>
  hero: Decision<HMHero>
  grid_columns: Decision<2 | 3 | 4>
  recently_viewed: Decision<"prominent" | "default">
  compare_panel: Decision<"default" | "on" | "off">
  cart_reminder: Decision<"default" | "on" | "off">
  popups: Decision<"on" | "off">
}

export interface HomepageDoc {
  /** Set on hand-written fixtures ("fixture-…") and demo shoppers. */
  demo_id?: string
  customer_key?: number
  user_id?: string
  updated_at?: string
  run_id?: string
  evidence?: { events: number; add_to_bags: number; validated_on: string; note: string }
  store_products?: StoreProductPick[]
  session?: unknown
  preferences?: ShopperPreferences
  stratum: "light" | "lower_mid" | "upper_mid" | "heavy"
  cutoff: string
  model: { name: string; inputs: string }
  layout: HomepageLayout
  predicted_mix: {
    category: Record<HMCategory, number>
    department: Record<HMDepartment, number>
    section: Record<HMSection, number>
  }
  browsing: { source: string; match_confidence: number; exploration: number; multi_visit_research: number }
  products: { for_you: ProductTile[]; rows: Partial<Record<HMCategory, ProductTile[]>> }
}

/** Context the validator needs to apply the model policy. */
export interface ModelContext {
  doc: HomepageDoc
  basketIds: string[]
}
