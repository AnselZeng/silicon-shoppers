"use client"

import { ProductCard } from "@/components/store/ProductCard"
import { merchandisedCards } from "@/lib/layout/merchandising"
import { useStorefront } from "@/lib/store/storeState"
import type { Product } from "@/lib/store/types"

/** columns overrides the layout's grid density (home rows hold 4 or 8 products, so they use 4). */
export function ProductGrid({ products, columns }: { products: Product[]; columns?: 2 | 3 | 4 }) {
  const layout = useStorefront((state) => state.layout)
  const density = columns ?? layout.listing.gridDensity
  const cols =
    density === 2 ? "grid-cols-2" : density === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-3"
  const cards = merchandisedCards(products, layout.listing.colorMerchandising)
  if (cards.length === 0) {
    return <p className="py-16 text-sm tracking-[0.16em] text-neutral-500 uppercase">Nothing in this edit.</p>
  }
  return (
    <div className={`grid gap-x-5 gap-y-10 ${cols}`}>
      {cards.map((card) => (
        <ProductCard
          key={`${card.product.id}-${card.color}`}
          product={card.product}
          colorway={card.color}
        />
      ))}
    </div>
  )
}
