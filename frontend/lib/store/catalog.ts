import { mulberry32 } from "@/lib/sim/rng"
import { withRating } from "@/lib/store/reviews"
import {
  type Category,
  type CollectionName,
  type Department,
  type GarmentType,
  type Product,
} from "@/lib/store/types"
import type { StoreColor } from "@/config/ui"

const APPAREL = ["XS", "S", "M", "L", "XL"]
const SHOE_SIZES = ["36", "37", "38", "39", "40", "41", "42", "43"]

function garmentFor(category: Category): GarmentType {
  switch (category) {
    case "tshirts":
      return "tee"
    case "shirts":
      return "shirt"
    case "knitwear":
      return "knit"
    case "jackets":
      return "jacket"
    case "coats":
      return "coat"
    case "jeans":
      return "jeans"
    case "trousers":
      return "trousers"
    case "skirts":
      return "skirt"
    case "dresses":
      return "dress"
    case "shoes":
      return "shoes"
    case "bags":
      return "bag"
  }
}

function anchor(
  partial: Omit<Product, "rating" | "reviewCount" | "description" | "garmentType"> & {
    garmentType?: GarmentType
    description?: string
  },
): Product {
  const garmentType = partial.garmentType ?? garmentFor(partial.category)
  return withRating({
    ...partial,
    garmentType,
    description:
      partial.description ??
      `${partial.name} in ${partial.colors.join(" / ")}. Part of ${partial.collection}, cut for ${partial.department}.`,
  })
}

const ANCHORS: Product[] = [
  anchor({
    id: "w-winter-puffer",
    name: "Winter Puffer Jacket",
    department: "women",
    category: "jackets",
    collection: "Winter Edit",
    price: 180,
    colors: ["black", "cream"],
    sizes: APPAREL,
    isNew: true,
    popularity: 98,
    createdAt: "2026-10-02",
    garmentType: "puffer",
    isHeroLaunch: true,
    description:
      "The season launch. A compact puffer with a clean collar and a matte shell, cut short enough to wear over tailoring.",
  }),
  anchor({
    id: "w-sale-rib-tee",
    name: "Ribbed Cotton Tee",
    department: "women",
    category: "tshirts",
    collection: "Essentials",
    price: 38,
    salePrice: 22,
    colors: ["black", "grey"],
    sizes: APPAREL,
    isNew: false,
    popularity: 70,
    createdAt: "2026-01-12",
  }),
  anchor({
    id: "w-sale-tank",
    name: "Fine Tank",
    department: "women",
    category: "tshirts",
    collection: "Essentials",
    price: 42,
    salePrice: 26,
    colors: ["grey", "white"],
    sizes: APPAREL,
    isNew: false,
    popularity: 61,
    createdAt: "2026-02-02",
  }),
  anchor({
    id: "w-sale-crew",
    name: "Everyday Crew",
    department: "women",
    category: "tshirts",
    collection: "Essentials",
    price: 48,
    salePrice: 29,
    colors: ["black", "white", "navy"],
    sizes: APPAREL,
    isNew: false,
    popularity: 84,
    createdAt: "2026-01-20",
  }),
  anchor({
    id: "w-sale-poplin",
    name: "Poplin Shirt",
    department: "women",
    category: "shirts",
    collection: "Studio",
    price: 88,
    salePrice: 54,
    colors: ["white", "navy", "beige"],
    sizes: APPAREL,
    isNew: false,
    popularity: 73,
    createdAt: "2026-03-01",
  }),
  anchor({
    id: "w-sale-cardigan",
    name: "Light Cardigan",
    department: "women",
    category: "knitwear",
    collection: "Weekend",
    price: 98,
    salePrice: 64,
    colors: ["grey", "camel"],
    sizes: APPAREL,
    isNew: false,
    popularity: 66,
    createdAt: "2026-03-18",
  }),
  anchor({
    id: "w-sale-skirt",
    name: "Column Skirt",
    department: "women",
    category: "skirts",
    collection: "Studio",
    price: 96,
    salePrice: 68,
    colors: ["black", "navy"],
    sizes: APPAREL,
    isNew: false,
    popularity: 69,
    createdAt: "2026-04-04",
  }),
  anchor({
    id: "w-sale-trouser",
    name: "Straight Trouser",
    department: "women",
    category: "trousers",
    collection: "Essentials",
    price: 110,
    salePrice: 72,
    colors: ["navy", "black"],
    sizes: APPAREL,
    isNew: false,
    popularity: 77,
    createdAt: "2026-02-14",
  }),
  anchor({
    id: "w-sale-jean",
    name: "Straight Jean",
    department: "women",
    category: "jeans",
    collection: "Weekend",
    price: 108,
    salePrice: 74,
    colors: ["navy", "grey"],
    sizes: APPAREL,
    isNew: false,
    popularity: 80,
    createdAt: "2026-02-28",
  }),
  anchor({
    id: "w-sale-knit",
    name: "Merino Polo",
    department: "women",
    category: "knitwear",
    collection: "Winter Edit",
    price: 120,
    salePrice: 79,
    colors: ["burgundy", "black"],
    sizes: APPAREL,
    isNew: true,
    popularity: 74,
    createdAt: "2026-09-12",
  }),
  anchor({
    id: "m-oxford",
    name: "Oxford Shirt",
    department: "men",
    category: "shirts",
    collection: "Essentials",
    price: 88,
    colors: ["navy", "white", "black"],
    sizes: APPAREL,
    isNew: false,
    popularity: 90,
    createdAt: "2026-01-08",
  }),
  anchor({
    id: "m-poplin",
    name: "Poplin Shirt",
    department: "men",
    category: "shirts",
    collection: "Studio",
    price: 78,
    colors: ["black", "white"],
    sizes: APPAREL,
    isNew: false,
    popularity: 76,
    createdAt: "2026-05-02",
  }),
  anchor({
    id: "m-navy-tee",
    name: "Heavy Crew",
    department: "men",
    category: "tshirts",
    collection: "Essentials",
    price: 42,
    colors: ["navy", "black", "grey"],
    sizes: APPAREL,
    isNew: false,
    popularity: 88,
    createdAt: "2025-11-02",
  }),
  anchor({
    id: "m-wool-trouser",
    name: "Wool Trouser",
    department: "men",
    category: "trousers",
    collection: "Essentials",
    price: 148,
    colors: ["navy", "black", "brown"],
    sizes: APPAREL,
    isNew: false,
    popularity: 86,
    createdAt: "2026-01-28",
  }),
  anchor({
    id: "w-ess-coat",
    name: "Column Coat",
    department: "women",
    category: "coats",
    collection: "Essentials",
    price: 240,
    colors: ["black", "camel", "navy"],
    sizes: APPAREL,
    isNew: false,
    popularity: 93,
    createdAt: "2025-10-01",
  }),
  anchor({
    id: "w-new-dress",
    name: "Bias Slip Dress",
    department: "women",
    category: "dresses",
    collection: "Studio",
    price: 168,
    colors: ["black", "burgundy", "cream"],
    sizes: APPAREL,
    isNew: true,
    popularity: 81,
    createdAt: "2026-09-28",
  }),
]

const WOMEN_CATS: Category[] = [
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
]
const MEN_CATS: Category[] = [
  "tshirts",
  "shirts",
  "knitwear",
  "jackets",
  "coats",
  "jeans",
  "trousers",
  "shoes",
  "bags",
]
const COLOR_POOL: StoreColor[] = [
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
]
const COLLECTION_POOL: CollectionName[] = ["Essentials", "Winter Edit", "Studio", "Weekend"]
const ADJECTIVES = [
  "Clean",
  "Soft",
  "Long",
  "Cropped",
  "Structured",
  "Washed",
  "Matte",
  "Fine",
  "Relaxed",
  "Tailored",
  "Quiet",
  "Double",
]
const NOUNS: Record<Category, string[]> = {
  tshirts: ["Tee", "Crew", "Tank"],
  shirts: ["Shirt", "Overshirt", "Camp Shirt"],
  knitwear: ["Knit", "Rollneck", "Cardigan"],
  jackets: ["Jacket", "Blouson", "Overshirt"],
  coats: ["Coat", "Topcoat", "Wrap Coat"],
  jeans: ["Jean", "Denim"],
  trousers: ["Trouser", "Pant", "Wide Leg"],
  skirts: ["Skirt", "Midi"],
  dresses: ["Dress", "Shift", "Slip"],
  shoes: ["Loafer", "Boot", "Sandal"],
  bags: ["Tote", "Shoulder Bag", "Pouch"],
}

function pick<T>(rand: () => number, list: readonly T[]): T {
  const item = list[Math.floor(rand() * list.length)]
  if (item === undefined) {
    throw new Error("empty pick")
  }
  return item
}

function buildGenerated(): Product[] {
  const rand = mulberry32(20260317)
  const items: Product[] = []
  const counts = new Map<string, number>()
  for (const product of ANCHORS) {
    const key = `${product.department}:${product.category}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  // The first 68 keep the original mix. The rest fill the categories that came out thin.
  const target = 120 - ANCHORS.length
  const kept = 84 - ANCHORS.length
  for (let i = 0; i < target; i += 1) {
    const department: Department = i % 5 === 0 || i % 5 === 1 ? "men" : "women"
    const cats = department === "women" ? WOMEN_CATS : MEN_CATS
    const rolled = pick(rand, cats)
    const category =
      i < kept
        ? rolled
        : cats.reduce((thin, cat) =>
            (counts.get(`${department}:${cat}`) ?? 0) < (counts.get(`${department}:${thin}`) ?? 0) ? cat : thin,
          )
    counts.set(`${department}:${category}`, (counts.get(`${department}:${category}`) ?? 0) + 1)
    const collection = pick(rand, COLLECTION_POOL)
    const colorCount = 1 + Math.floor(rand() * 3)
    const colors: StoreColor[] = []
    while (colors.length < colorCount) {
      const color = pick(rand, COLOR_POOL)
      if (!colors.includes(color)) colors.push(color)
    }
    const price = 28 + Math.floor(rand() * 28) * 6
    const onSale = rand() < 0.22
    const salePrice = onSale ? Math.max(18, Math.round((price * 0.72) / 2) * 2) : undefined
    const day = 1 + Math.floor(rand() * 27)
    const month = 1 + Math.floor(rand() * 12)
    const createdAt = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    const isNew = month >= 9
    const id = `${department === "women" ? "w" : "m"}-g${String(i + 1).padStart(2, "0")}`
    const name = `${pick(rand, ADJECTIVES)} ${pick(rand, NOUNS[category])}`
    const sizes = category === "shoes" ? SHOE_SIZES : category === "bags" ? ["OS"] : APPAREL
    items.push(
      anchor({
        id,
        name,
        department,
        category,
        collection,
        price,
        salePrice,
        colors,
        sizes,
        isNew,
        popularity: 20 + Math.floor(rand() * 75),
        createdAt,
      }),
    )
  }
  return items
}

export const PRODUCTS: Product[] = [...ANCHORS, ...buildGenerated()]

const byId = new Map(PRODUCTS.map((product) => [product.id, product]))

export function getProduct(id: string): Product | undefined {
  return byId.get(id)
}

export function productsByDepartment(department: Department): Product[] {
  return PRODUCTS.filter((product) => product.department === department)
}
