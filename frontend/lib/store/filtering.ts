import type { StoreColor } from "@/config/ui"
import type { SortOption } from "@/lib/personas/schema"
import { collectionSlug } from "@/lib/utils"
import { getProduct, PRODUCTS } from "@/lib/store/catalog"
import {
  CATEGORIES,
  type Category,
  type ListingMode,
  type ListingQuery,
  type PriceBand,
  type Product,
  effectivePrice,
} from "@/lib/store/types"

const PRICE_BANDS: PriceBand[] = ["under-60", "60-120", "over-120"]

function isPriceBand(value: string): value is PriceBand {
  return (PRICE_BANDS as string[]).includes(value)
}

function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value)
}

const COLOR_SET = new Set<string>([
  "black",
  "white",
  "beige",
  "navy",
  "grey",
  "olive",
  "burgundy",
  "cream",
  "brown",
  "camel",
])

function isColor(value: string): value is StoreColor {
  return COLOR_SET.has(value)
}

export function emptyQuery(): ListingQuery {
  return {
    sale: false,
    prices: [],
    sizes: [],
    colors: [],
    categories: [],
    collections: [],
  }
}

export function parseListingQuery(params: URLSearchParams): ListingQuery {
  const sortRaw = params.get("sort")
  const sort = isSort(sortRaw) ? sortRaw : undefined
  const q = params.get("q") ?? undefined
  return {
    sale: params.get("sale") === "1",
    prices: params.getAll("price").filter(isPriceBand),
    sizes: params.getAll("size"),
    colors: params.getAll("color").filter(isColor),
    categories: params.getAll("category").filter(isCategory),
    collections: params.getAll("collection"),
    sort,
    q: q && q.length > 0 ? q : undefined,
  }
}

function isSort(value: string | null): value is SortOption {
  return (
    value === "relevance" ||
    value === "newest" ||
    value === "price_asc" ||
    value === "price_desc" ||
    value === "bestsellers"
  )
}

export function queryToSearchParams(query: ListingQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (query.q) params.set("q", query.q)
  if (query.sale) params.set("sale", "1")
  for (const price of query.prices) params.append("price", price)
  for (const size of query.sizes) params.append("size", size)
  for (const color of query.colors) params.append("color", color)
  for (const category of query.categories) params.append("category", category)
  for (const collection of query.collections) params.append("collection", collection)
  if (query.sort) params.set("sort", query.sort)
  return params
}

export function listingHref(path: string, query: ListingQuery): string {
  const params = queryToSearchParams(query)
  const text = params.toString()
  return text ? `${path}?${text}` : path
}

export function filterKeys(query: ListingQuery): string[] {
  const keys: string[] = []
  if (query.sale) keys.push("sale")
  for (const price of query.prices) keys.push(`price:${price}`)
  for (const size of query.sizes) keys.push(`size:${size}`)
  for (const color of query.colors) keys.push(`color:${color}`)
  for (const category of query.categories) keys.push(`category:${category}`)
  for (const collection of query.collections) keys.push(`collection:${collection}`)
  return keys
}

function inPriceBand(price: number, band: PriceBand): boolean {
  if (band === "under-60") return price < 60
  if (band === "60-120") return price >= 60 && price <= 120
  return price > 120
}

function matchesQueryText(product: Product, q: string): boolean {
  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
  if (tokens.length === 0) return true
  const haystack = [
    product.name,
    product.category,
    product.collection,
    product.department,
    product.colors.join(" "),
    product.description,
  ]
    .join(" ")
    .toLowerCase()
  return tokens.every((token) => haystack.includes(token))
}

/** forYouIds is the layout's home.forYouIds, in the model's order; only the for-you listing reads it. */
export function baseProducts(mode: ListingMode, forYouIds: string[] = []): Product[] {
  switch (mode) {
    case "women":
      return PRODUCTS.filter((product) => product.department === "women")
    case "men":
      return PRODUCTS.filter((product) => product.department === "men")
    case "new-in":
      return PRODUCTS.filter((product) => product.isNew)
    case "sale":
      return PRODUCTS.filter((product) => product.salePrice !== undefined)
    case "search":
      return PRODUCTS
    case "for-you":
      return forYouIds.map((id) => getProduct(id)).filter((p): p is Product => p !== undefined)
  }
}

export function applyFilters(products: Product[], query: ListingQuery, mode: ListingMode): Product[] {
  return products.filter((product) => {
    if (query.sale && product.salePrice === undefined) return false
    if (mode === "search" && query.q && !matchesQueryText(product, query.q)) return false
    if (query.prices.length > 0) {
      const price = effectivePrice(product)
      if (!query.prices.some((band) => inPriceBand(price, band))) return false
    }
    if (query.sizes.length > 0 && !query.sizes.some((size) => product.sizes.includes(size))) {
      return false
    }
    if (query.colors.length > 0 && !query.colors.some((color) => product.colors.includes(color))) {
      return false
    }
    if (query.categories.length > 0 && !query.categories.includes(product.category)) return false
    if (
      query.collections.length > 0 &&
      !query.collections.includes(collectionSlug(product.collection))
    ) {
      return false
    }
    return true
  })
}

export function toggleValue<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}
