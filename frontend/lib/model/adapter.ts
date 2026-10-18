// Store-side helpers for the H&M model's homepage document. Ported from
// backend/server/app/lib/model/adapter.ts (origin/pb-backend). The model's output is JSON for the LLM;
// code never turns it into a layout itself. What code does take from it is product data: the For You
// list (store_products, or rankCatalog when that is missing), copied into the LLM's layout.

import { FOR_YOU_MAX } from "@/lib/layout/enums"
import type { HMCategory, HomepageDoc } from "@/lib/model/homepage"
import { APP_TO_HM_CATEGORY, HM_TO_APP_CATEGORIES, HM_TO_APP_COLOR } from "@/lib/model/mapping"
import { PRODUCTS } from "@/lib/store/catalog"
import type { Category, Product } from "@/lib/store/types"

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
