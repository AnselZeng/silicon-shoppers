"use client"

import { ProductCard } from "@/components/store/ProductCard"
import { useStorefront } from "@/lib/store/storeState"
import type { Product } from "@/lib/store/types"

export function ProductGrid({ products }: { products: Product[] }) {
  const density = useStorefront((state) => state.layout.gridDensity)
  const cols =
    density === 2 ? "grid-cols-2" : density === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-3"
  if (products.length === 0) {
    return <p className="py-16 text-sm tracking-[0.16em] text-neutral-500 uppercase">Nothing in this edit.</p>
  }
  return (
    <div className={`grid gap-x-5 gap-y-10 ${cols}`}>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  )
}
