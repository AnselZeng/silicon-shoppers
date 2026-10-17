import type { StoreColor } from "@/config/ui"
import type { SortOption } from "@/lib/personas/schema"

export const CATEGORIES = [
  "tshirts",
  "shirts",
  "knitwear",
  "jackets",
  "coats",
  "jeans",
  "trousers",
  "skirts",
  "dresses",
  "shoes",
  "bags",
] as const

export type Category = (typeof CATEGORIES)[number]

export const COLLECTIONS = ["Essentials", "Winter Edit", "Studio", "Weekend"] as const
export type CollectionName = (typeof COLLECTIONS)[number]

export const GARMENT_TYPES = [
  "tee",
  "shirt",
  "knit",
  "jacket",
  "coat",
  "puffer",
  "jeans",
  "trousers",
  "skirt",
  "dress",
  "shoes",
  "bag",
] as const

export type GarmentType = (typeof GARMENT_TYPES)[number]

export type Department = "women" | "men"

export interface Product {
  id: string
  name: string
  department: Department
  category: Category
  collection: CollectionName
  price: number
  salePrice?: number
  colors: StoreColor[]
  sizes: string[]
  isNew: boolean
  popularity: number
  rating: number
  reviewCount: number
  createdAt: string
  description: string
  garmentType: GarmentType
  isHeroLaunch?: boolean
}

export type PriceBand = "under-60" | "60-120" | "over-120"

export interface ListingQuery {
  sale: boolean
  prices: PriceBand[]
  sizes: string[]
  colors: StoreColor[]
  categories: Category[]
  collections: string[]
  sort?: SortOption
  q?: string
}

export type ListingMode = "women" | "men" | "new-in" | "sale" | "search"

export function modePath(mode: ListingMode): string {
  switch (mode) {
    case "women":
      return "/store/women"
    case "men":
      return "/store/men"
    case "new-in":
      return "/store/new-in"
    case "sale":
      return "/store/sale"
    case "search":
      return "/store/search"
  }
}

export function effectivePrice(product: Product): number {
  return product.salePrice ?? product.price
}

export const APPAREL_SIZES = ["XS", "S", "M", "L", "XL"] as const

export const CATEGORY_LABEL: Record<Category, string> = {
  tshirts: "T-shirts",
  shirts: "Shirts",
  knitwear: "Knitwear",
  jackets: "Jackets",
  coats: "Coats",
  jeans: "Jeans",
  trousers: "Trousers",
  skirts: "Skirts",
  dresses: "Dresses",
  shoes: "Shoes",
  bags: "Bags",
}
