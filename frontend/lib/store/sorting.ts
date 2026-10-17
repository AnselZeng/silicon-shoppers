import type { SortOption } from "@/lib/personas/schema"
import { effectivePrice, type Product } from "@/lib/store/types"

function relevance(product: Product, q?: string): number {
  let score = product.popularity
  if (!q) return score
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
  const name = product.name.toLowerCase()
  const category = product.category.toLowerCase()
  for (const token of tokens) {
    if (name.includes(token)) score += 30
    if (category.includes(token)) score += 18
    if (product.colors.some((color) => color.includes(token))) score += 14
    if (product.collection.toLowerCase().includes(token)) score += 10
    if (product.isNew) score += 4
  }
  return score
}

export function sortProducts(products: Product[], sort: SortOption, q?: string): Product[] {
  const list = [...products]
  const byName = (a: Product, b: Product) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  switch (sort) {
    case "price_asc":
      return list.sort((a, b) => effectivePrice(a) - effectivePrice(b) || byName(a, b))
    case "price_desc":
      return list.sort((a, b) => effectivePrice(b) - effectivePrice(a) || byName(a, b))
    case "newest":
      return list.sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || b.popularity - a.popularity || byName(a, b),
      )
    case "bestsellers":
      return list.sort((a, b) => b.popularity - a.popularity || byName(a, b))
    case "relevance":
    default:
      return list.sort((a, b) => relevance(b, q) - relevance(a, q) || byName(a, b))
  }
}
