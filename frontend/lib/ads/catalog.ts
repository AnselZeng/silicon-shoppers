import type { HouseAdSpec } from "@/lib/ads/types"

/**
 * House ads: the store's own promotions. First draft, to be reviewed.
 * Copy rules: short, plain, no exclamation marks, no invented prices or discounts.
 * The only price quoted is the shipping threshold, which is store policy.
 */

export const FREE_SHIPPING_THRESHOLD = 150

const UPPER = "category=tshirts&category=shirts&category=knitwear&category=jackets&category=coats"
const LOWER_WOMEN = "category=jeans&category=trousers&category=skirts"
const LOWER_MEN = "category=jeans&category=trousers"

export const HOUSE_ADS = {
  cat_upper_women: {
    kind: "category",
    department: "women",
    hmCategory: "cat_garment_upper_body",
    headline: "Knits, shirts and coats",
    body: "Tops and outerwear for the colder months.",
    cta: "Shop tops",
    href: `/store/women?${UPPER}`,
    visual: "garment",
    garment: "knit",
    slots: ["hero", "listing_banner", "grid_tile"],
    suits: "category_order led by cat_garment_upper_body, department women",
  },
  cat_lower_women: {
    kind: "category",
    department: "women",
    hmCategory: "cat_garment_lower_body",
    headline: "Trousers, jeans and skirts",
    body: "Straight legs, column skirts and clean denim.",
    cta: "Shop bottoms",
    href: `/store/women?${LOWER_WOMEN}`,
    visual: "garment",
    garment: "trousers",
    slots: ["hero", "listing_banner", "grid_tile"],
    suits: "category_order led by cat_garment_lower_body, department women",
  },
  cat_full_women: {
    kind: "category",
    department: "women",
    hmCategory: "cat_garment_full_body",
    headline: "Dresses",
    body: "Slip dresses and shifts, cut to move.",
    cta: "Shop dresses",
    href: "/store/women?category=dresses",
    visual: "garment",
    garment: "dress",
    slots: ["hero", "listing_banner", "grid_tile"],
    suits: "category_order led by cat_garment_full_body, department women",
  },
  cat_upper_men: {
    kind: "category",
    department: "men",
    hmCategory: "cat_garment_upper_body",
    headline: "Shirts and knitwear",
    body: "Oxfords, heavy crews and knits.",
    cta: "Shop tops",
    href: `/store/men?${UPPER}`,
    visual: "garment",
    garment: "shirt",
    slots: ["hero", "listing_banner", "grid_tile"],
    suits: "category_order led by cat_garment_upper_body, department men",
  },
  cat_lower_men: {
    kind: "category",
    department: "men",
    hmCategory: "cat_garment_lower_body",
    headline: "Trousers and jeans",
    body: "Wool trousers and straight denim.",
    cta: "Shop bottoms",
    href: `/store/men?${LOWER_MEN}`,
    visual: "garment",
    garment: "trousers",
    slots: ["hero", "listing_banner", "grid_tile"],
    suits: "category_order led by cat_garment_lower_body, department men",
  },
  sale_women: {
    kind: "sale",
    department: "women",
    headline: "Women's sale",
    body: "Marked-down pieces from the women's edit. No code needed.",
    cta: "Shop the sale",
    href: "/store/women?sale=1",
    visual: "pattern",
    slots: ["hero", "top_strip", "listing_banner", "grid_tile"],
    suits: "high markdown_affinity; section_order led by sale",
  },
  sale_men: {
    kind: "sale",
    department: "men",
    headline: "Men's sale",
    body: "Marked-down pieces from the men's edit. No code needed.",
    cta: "Shop the sale",
    href: "/store/men?sale=1",
    visual: "pattern",
    slots: ["hero", "top_strip", "listing_banner", "grid_tile"],
    suits: "high markdown_affinity; section_order led by sale",
  },
  new_women: {
    kind: "new_drop",
    department: "women",
    headline: "Winter Puffer",
    body: "The launch jacket. Matte shell, short hem, black or cream.",
    cta: "See the drop",
    href: "/store/product/w-winter-puffer",
    visual: "garment",
    garment: "puffer",
    slots: ["hero", "top_strip", "listing_banner", "grid_tile", "popup", "interstitial"],
    suits: "high novelty_affinity; section_order led by new_in",
  },
  new_men: {
    kind: "new_drop",
    department: "men",
    headline: "New in for men",
    body: "The latest shirts, knits and outerwear.",
    cta: "See what's new",
    href: "/store/men?sort=newest",
    visual: "garment",
    garment: "jacket",
    slots: ["hero", "top_strip", "listing_banner", "grid_tile", "popup", "interstitial"],
    suits: "high novelty_affinity; section_order led by new_in",
  },
  collection_women: {
    kind: "collection",
    department: "women",
    headline: "Cut for the cold.",
    body: "The Winter Edit. Wool, poplin and the new puffer.",
    cta: "Explore the edit",
    href: "/store/women?collection=winter-edit",
    visual: "type_only",
    slots: ["hero", "top_strip", "listing_banner", "grid_tile"],
    suits: "editorial default; high mainstream_score or no clear lead",
  },
  collection_men: {
    kind: "collection",
    department: "men",
    headline: "The pieces you keep.",
    body: "Essentials. Oxfords, heavy crews and wool trousers. Same cut, every season.",
    cta: "Shop Essentials",
    href: "/store/men?collection=essentials",
    visual: "type_only",
    slots: ["hero", "top_strip", "listing_banner", "grid_tile"],
    suits: "editorial default; high mainstream_score or rebuy_share",
  },
  newsletter: {
    kind: "newsletter",
    department: "all",
    headline: "Notes from the atelier",
    body: "Early access to sales and the next drop. One email, no weekly noise.",
    cta: "Join the list",
    href: "/store",
    visual: "type_only",
    slots: ["popup"],
    suits: "only when the model's popups decision is on",
  },
  shipping: {
    kind: "shipping",
    department: "all",
    headline: "Complimentary shipping over $150",
    cta: "Shop new in",
    href: "/store/new-in",
    visual: "type_only",
    slots: ["top_strip", "sticky_footer"],
    suits: "anyone; a quiet default for the top strip",
  },
  loyalty: {
    kind: "loyalty",
    department: "all",
    headline: "Earn points on every order",
    body: "One point per dollar with loyalty pay.",
    cta: "Shop Essentials",
    href: "/store/women?collection=essentials",
    visual: "type_only",
    slots: ["top_strip", "listing_banner", "sticky_footer"],
    suits: "high rebuy_share or mainstream_score",
  },
  offer_women: {
    kind: "sale",
    department: "women",
    headline: "Sale prices on women's pieces",
    body: "Selected tees, knits and trousers are marked down.",
    cta: "Shop the sale",
    href: "/store/women?sale=1",
    visual: "pattern",
    slots: ["popup", "interstitial", "sticky_footer"],
    suits: "high markdown_affinity, department women; intrusive formats only",
  },
  offer_men: {
    kind: "sale",
    department: "men",
    headline: "Sale prices on men's pieces",
    body: "Selected knits, jackets and shoes are marked down.",
    cta: "Shop the sale",
    href: "/store/men?sale=1",
    visual: "pattern",
    slots: ["popup", "interstitial", "sticky_footer"],
    suits: "high markdown_affinity, department men; intrusive formats only",
  },
  offer_all: {
    kind: "sale",
    department: "all",
    headline: "The sale is on",
    body: "Marked-down pieces for women and men.",
    cta: "Shop the sale",
    href: "/store/sale",
    visual: "pattern",
    slots: ["popup", "interstitial", "sticky_footer"],
    suits: "high markdown_affinity, mixed departments; intrusive formats only",
  },
} as const satisfies Record<string, HouseAdSpec>

export type AdId = keyof typeof HOUSE_ADS

export type HouseAd = HouseAdSpec & { id: AdId }

export const AD_IDS = Object.keys(HOUSE_ADS) as [AdId, ...AdId[]]

export function getAd(id: AdId): HouseAd {
  return { ...(HOUSE_ADS[id] as HouseAdSpec), id }
}

export function isAdId(value: unknown): value is AdId {
  return typeof value === "string" && value in HOUSE_ADS
}
