"use client"

import { AdTile } from "@/components/store/ads/AdTile"
import { ProductCard } from "@/components/store/ProductCard"
import { adContent, placementFor, tilePositions } from "@/lib/ads/placement"
import { merchandisedCards } from "@/lib/layout/merchandising"
import { useStorefront } from "@/lib/store/storeState"
import type { Product } from "@/lib/store/types"

/**
 * columns overrides the layout's grid density (home rows hold 4 or 8 products, so they use 4).
 * withAds draws the layout's grid_tile ads; listings only.
 */
export function ProductGrid({
  products,
  columns,
  withAds = false,
}: {
  products: Product[]
  columns?: 2 | 3 | 4
  withAds?: boolean
}) {
  const layout = useStorefront((state) => state.layout)
  const density = columns ?? layout.listing.gridDensity
  const cols =
    density === 2 ? "grid-cols-2" : density === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-3"
  const cards = merchandisedCards(products, layout.listing.colorMerchandising)
  if (cards.length === 0) {
    return <p className="py-16 text-sm tracking-[0.16em] text-neutral-500 uppercase">Nothing in this edit.</p>
  }
  const placement = withAds ? placementFor(layout, "grid_tile") : undefined
  const positions = tilePositions(cards.length, placement)
  const items = cards.map((card) => (
    <ProductCard key={`${card.product.id}-${card.color}`} product={card.product} colorway={card.color} />
  ))
  positions.forEach((position, i) => {
    const id = placement?.adIds[i]
    if (!id) return
    items.splice(position + i, 0, <AdTile key={`ad-${id}`} ad={adContent(layout, id)} />)
  })
  return <div className={`grid gap-x-5 gap-y-10 ${cols}`}>{items}</div>
}
