// Types for the per-shopper homepage documents produced by the H&M model (`python -m model export` on the
// `model` branch). public/model/sample_homepages.json holds 60 of them for local development; in production
// they come from Supabase (table homepages_final, column homepage).

export type DecisionClass = "Tested" | "Estimated" | "Assumed" | "Based on your settings";

export interface Decision<V> {
  value: V;
  class: DecisionClass;
  /** true = confirmed on the clean 2019 test (shoppers whose layout changed did better than the store default,
   *  95% CI above zero); null = not testable with purchases */
  validated: boolean | null;
  reason: string;
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
  | "cat_other";

export type HMDepartment = "dept_ladieswear" | "dept_menswear" | "dept_divided" | "dept_sport" | "dept_baby_children";
export type HMSection = "new_in" | "sale" | "bestsellers" | "buy_again";

export interface ProductTile {
  /** H&M article id (10 digits); not in the demo catalog, use for inspiration or image lookup */
  article_id: string;
  name: string;
  category: HMCategory;
  department: string;
  color: string;
  price_scaled: number | null;
  score: number;
  why: string;
  /** the shopper already bought this product (any color). Showing these scores better offline; hiding them
   *  looks better in a demo. Filter on this flag to choose. */
  bought_before: boolean;
}

/** One demo-store product picked for the shopper (refresh job, server/score.py rank_store). */
export interface StoreProductPick {
  product_id: string;
  score: number;
  why: string;
}

/** What the live session model concluded from the shopper's previous visits (refresh job). */
export interface StoredSession {
  n_events: number;
  visits: number | null;
  style: Partial<Record<string, number>>;
  decisions: Partial<import("./sessionStyle").SessionDecisions>;
  source: string;
}

/** Sorts and filters the shopper keeps choosing. */
export interface ShopperPreferences {
  sort?: string;
  sort_counts: Record<string, number>;
  filter_counts: Record<string, number>;
  filters_first: string[];
  color_filters: string[];
  recent_searches: string[];
}

export interface HomepageDoc {
  demo_id?: string;
  customer_key?: number;
  /** store shoppers (USER_LAYOUTS in Snowflake): anonymous id, last refresh, refresh run */
  user_id?: string;
  updated_at?: string;
  run_id?: string;
  evidence?: { events: number; add_to_bags: number; validated_on: string; note: string };
  store_products?: StoreProductPick[];
  session?: StoredSession | null;
  preferences?: ShopperPreferences;
  stratum: "light" | "lower_mid" | "upper_mid" | "heavy";
  cutoff: string;
  model: { name: string; inputs: string };
  layout: {
    landing_department: Decision<HMDepartment>;
    category_order: Decision<HMCategory[]>;
    section_order: Decision<HMSection[]>;
    /** store shoppers can also get price_desc / relevance when they keep choosing it ("Based on your settings") */
    default_sort: Decision<"bestsellers" | "newest" | "price_asc" | "price_desc" | "relevance">;
    color_highlight: Decision<string[]>;
    price_filter_first: Decision<boolean>;
    filter_order: Decision<("category" | "size" | "color" | "price" | "sale" | "collection")[]>;
    hero: Decision<"editorial" | "discount" | "new_drop" | "category">;
    grid_columns: Decision<2 | 3 | 4>;
    recently_viewed: Decision<"prominent" | "default">;
    compare_panel: Decision<"default" | "on" | "off">;
    cart_reminder: Decision<"default" | "on" | "off">;
    popups: Decision<"on" | "off">;
  };
  predicted_mix: {
    category: Record<HMCategory, number>;
    department: Record<HMDepartment, number>;
    section: Record<HMSection, number>;
  };
  browsing: { source: string; match_confidence: number; exploration: number; multi_visit_research: number };
  products: { for_you: ProductTile[]; rows: Partial<Record<HMCategory, ProductTile[]>> };
}

export interface SampleHomepages {
  source: string;
  shoppers: HomepageDoc[];
}

/** Load the bundled demo shoppers (public/model/sample_homepages.json). */
export async function loadSampleHomepages(): Promise<HomepageDoc[]> {
  const res = await fetch("/model/sample_homepages.json");
  if (!res.ok) throw new Error(`sample_homepages.json: ${res.status}`);
  return ((await res.json()) as SampleHomepages).shoppers;
}
