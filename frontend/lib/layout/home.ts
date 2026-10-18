import type { HomeBlock, LayoutConfig, ProductSource } from "@/lib/layout/types"
import { getProduct, PRODUCTS } from "@/lib/store/catalog"
import { sortProducts } from "@/lib/store/sorting"
import { effectivePrice, type Product } from "@/lib/store/types"

export type ResolvedBlock =
  | { block: Exclude<HomeBlock, { type: "product_row" }> }
  | { block: Extract<HomeBlock, { type: "product_row" }>; products: Product[] }

function ids(list: string[]): Product[] {
  return list.map((id) => getProduct(id)).filter((p): p is Product => p !== undefined)
}

/** Every product a source could show, best first. Department filtering is applied by the caller. */
export function sourceProducts(source: ProductSource, layout: LayoutConfig): Product[] {
  switch (source.kind) {
    case "for_you":
      return ids(layout.home.forYouIds)
    case "buy_again":
      return ids(layout.home.basketIds)
    case "new_in":
      return sortProducts(PRODUCTS.filter((p) => p.isNew), "newest")
    case "bestsellers":
      return sortProducts(PRODUCTS, "bestsellers")
    case "sale":
      return sortProducts(PRODUCTS.filter((p) => p.salePrice !== undefined), "price_asc")
    case "under_price":
      return sortProducts(PRODUCTS.filter((p) => effectivePrice(p) <= source.max), "bestsellers")
    case "category":
      return sortProducts(PRODUCTS.filter((p) => p.category === source.category), "bestsellers")
    case "collection":
      return sortProducts(PRODUCTS.filter((p) => p.collection === source.collection), "bestsellers")
  }
}

/** for_you and buy_again are the shopper's own lists; every other source follows nav.department. */
export function followsDepartment(source: ProductSource): boolean {
  return source.kind !== "for_you" && source.kind !== "buy_again"
}

/**
 * The home page, top to bottom. Rows are filled in order and a product already
 * shown in an earlier row is skipped, so no product repeats across rows.
 */
export function resolveHome(layout: LayoutConfig): ResolvedBlock[] {
  const shown = new Set<string>()
  const department = layout.nav.department
  return layout.home.blocks.map((block) => {
    if (block.type !== "product_row") return { block }
    const products = sourceProducts(block.source, layout)
      .filter((p) => !department || !followsDepartment(block.source) || p.department === department)
      .filter((p) => !shown.has(p.id))
      .slice(0, block.limit)
    for (const p of products) shown.add(p.id)
    return { block, products }
  })
}

/** Stable view-transition name for a home block; also keys the change highlight. */
export function blockName(block: HomeBlock): string {
  if (block.type === "product_row") {
    const source = block.source
    if (source.kind === "category") return `row-cat-${source.category}`
    if (source.kind === "collection") return `row-col-${source.collection.replace(/\s+/g, "-")}`
    if (source.kind === "under_price") return `row-under-${source.max}`
    return `row-${source.kind}`
  }
  if (block.type === "collection_spotlight") return `spot-${block.collection.replace(/\s+/g, "-")}`
  if (block.type === "ad_banner") return `ad-${block.adId}`
  if (block.type === "editorial_text") return `copy-${block.copyKey}`
  if (block.type === "category_tiles") return "tiles"
  return "hero"
}
