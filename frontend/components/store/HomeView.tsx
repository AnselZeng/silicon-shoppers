"use client"

import Link from "next/link"
import { Hero } from "@/components/store/Hero"
import { ProductGrid } from "@/components/store/ProductGrid"
import { resolveHome } from "@/lib/layout/home"
import { categoryHref } from "@/lib/layout/links"
import { FILTER_LABEL, type ColorMerchandising, type ProductSource } from "@/lib/layout/types"
import { useStorefront } from "@/lib/store/storeState"
import { CATEGORY_LABEL } from "@/lib/store/types"

const SORT_LINE = {
  relevance: "Sorted by relevance",
  newest: "Sorted by newest",
  price_asc: "Sorted by price, low to high",
  price_desc: "Sorted by price, high to low",
  bestsellers: "Sorted by bestsellers",
} as const

const MERCH_LINE: Record<ColorMerchandising, string> = {
  swatches: "One piece, colors as swatches",
  hover_preview: "Hover the piece to preview color",
  split_colors: "Each color shown as its own piece",
  color_locked: "One colorway per piece",
}

function rowTitle(source: ProductSource): string {
  switch (source.kind) {
    case "for_you":
      return "Picked for you"
    case "new_in":
      return "New in"
    case "bestsellers":
      return "Bestsellers"
    case "sale":
      return "Sale picks"
    case "buy_again":
      return "Buy again"
    case "under_price":
      return `Under $${source.max}`
    case "category":
      return CATEGORY_LABEL[source.category]
    case "collection":
      return source.collection
  }
}

function rowHref(source: ProductSource): string | null {
  if (source.kind === "new_in") return "/store/new-in"
  if (source.kind === "sale") return "/store/sale"
  if (source.kind === "bestsellers") return "/store/women?sort=bestsellers"
  return null
}

export function HomeView() {
  const layout = useStorefront((state) => state.layout)
  const blocks = resolveHome(layout)

  return (
    <div>
      {blocks.map((entry, index) => {
        const block = entry.block
        const key = `${index}-${block.type}`
        if (block.type === "hero") {
          return (
            <div key={key}>
              <Hero />
              <p className="px-6 pt-4 text-[10px] tracking-[0.18em] text-neutral-500 uppercase">
                {SORT_LINE[layout.listing.defaultSort]} · Filters lead with{" "}
                {FILTER_LABEL[layout.listing.filterOrder[0] ?? "category"]} · {MERCH_LINE[layout.listing.colorMerchandising]}
              </p>
            </div>
          )
        }
        if ("products" in entry && entry.block.type === "product_row") {
          if (entry.products.length === 0) return null
          const href = rowHref(entry.block.source)
          return (
            <section key={key} className="px-6 py-10">
              <div className="mb-6 flex items-baseline justify-between">
                <h2 className="text-[11px] tracking-[0.22em] uppercase">{entry.block.title ?? rowTitle(entry.block.source)}</h2>
                {href ? (
                  <Link href={href} className="text-[10px] tracking-[0.18em] uppercase">
                    View all
                  </Link>
                ) : null}
              </div>
              <ProductGrid products={entry.products} />
            </section>
          )
        }
        if (block.type === "category_tiles") {
          return (
            <section key={key} className="px-6 py-10">
              <h2 className="mb-6 text-[11px] tracking-[0.22em] uppercase">Shop by category</h2>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {block.categories.map((category) => (
                  <Link
                    key={category}
                    href={categoryHref(layout, category)}
                    className="flex min-h-36 items-end bg-[#141414] p-4 text-[#f6f3ee]"
                  >
                    <span className="text-[12px] tracking-[0.18em] uppercase">{CATEGORY_LABEL[category]}</span>
                  </Link>
                ))}
              </div>
            </section>
          )
        }
        return null
      })}
    </div>
  )
}
