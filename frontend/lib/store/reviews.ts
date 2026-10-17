import type { Product } from "@/lib/store/types"

const AUTHORS = [
  "Mara V.",
  "Helen Cho",
  "Jonah Ellis",
  "Priya N.",
  "Andre Silva",
  "Claire Dumont",
  "Samira Q.",
  "Owen Park",
]

const TITLES = [
  "Exactly the weight I wanted",
  "Quiet and well cut",
  "True to the silhouette",
  "Wore it twice this week",
  "The cloth feels considered",
  "Cleaner in person",
]

const BODIES = [
  "The shoulder sits where it should and the hem doesn't twist. Kept the size I ordered.",
  "Color is close to the swatch. I wanted something I could wear with the rest of the edit, and this does.",
  "Light, not flimsy. Washed once and it stayed put.",
  "I almost sent it back for a smaller size. Glad I didn't — the ease is the point.",
  "Looks plain on the rail and sharp once it's on. That's the whole trick.",
  "Stitching is even and the lining doesn't cling. Will buy the other color.",
]

const DATES = [
  "12 Jan 2026",
  "3 Feb 2026",
  "19 Mar 2026",
  "2 Apr 2026",
  "28 May 2026",
  "14 Jun 2026",
]

export interface Review {
  id: string
  author: string
  rating: number
  title: string
  body: string
  date: string
}

function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function reviewsFor(productId: string): Review[] {
  const h = hashId(productId)
  const count = 3 + (h % 3)
  return Array.from({ length: count }, (_, i) => {
    const n = h + i * 17
    return {
      id: `${productId}-r${i}`,
      author: AUTHORS[n % AUTHORS.length] ?? AUTHORS[0],
      rating: 3 + (n % 3),
      title: TITLES[n % TITLES.length] ?? TITLES[0],
      body: BODIES[(n * 3) % BODIES.length] ?? BODIES[0],
      date: DATES[n % DATES.length] ?? DATES[0],
    }
  })
}

export function ratingFor(productId: string): { rating: number; reviewCount: number } {
  const reviews = reviewsFor(productId)
  const avg = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
  const rating = Math.round(avg * 10) / 10
  const reviewCount = 12 + (hashId(productId) % 80)
  return { rating, reviewCount }
}

export function withRating(product: Omit<Product, "rating" | "reviewCount">): Product {
  const rated = ratingFor(product.id)
  return { ...product, rating: rated.rating, reviewCount: rated.reviewCount }
}
