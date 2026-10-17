"use client"

import Link from "next/link"
import { Hero } from "@/components/store/Hero"
import { ProductGrid } from "@/components/store/ProductGrid"
import { UI_CONFIG } from "@/config/ui"
import { FILTER_LABEL, type ColorMerchandising, type HomeSectionId } from "@/lib/layout/types"
import { PRODUCTS } from "@/lib/store/catalog"
import { sortProducts } from "@/lib/store/sorting"
import { useStorefront } from "@/lib/store/storeState"
import { COLLECTIONS, type Product } from "@/lib/store/types"
import { collectionSlug } from "@/lib/utils"

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

const SECTION_TITLE: Record<HomeSectionId, string> = {
  new_in: "New in",
  bestsellers: "Bestsellers",
  sale_picks: "Sale picks",
  collections: "Collections",
}

function sectionProducts(id: HomeSectionId): Product[] {
  if (id === "new_in") return sortProducts(PRODUCTS.filter((product) => product.isNew), "newest").slice(0, 8)
  if (id === "bestsellers") return sortProducts(PRODUCTS, "bestsellers").slice(0, 8)
  if (id === "sale_picks") {
    return sortProducts(
      PRODUCTS.filter((product) => product.salePrice !== undefined),
      "price_asc",
    ).slice(0, 8)
  }
  return []
}

export function HomeView() {
  const layout = useStorefront((state) => state.layout)
  return (
    <div>
      <Hero />
      <p className="px-6 pt-4 text-[10px] tracking-[0.18em] text-neutral-500 uppercase">
        {SORT_LINE[layout.defaultSort]} · Filters lead with {FILTER_LABEL[layout.filterOrder[0] ?? "category"]} ·{" "}
        {MERCH_LINE[layout.colorMerchandising]}
      </p>
      {layout.homeSectionOrder.map((section) => (
        <section key={section} className="px-6 py-10">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 className="text-[11px] tracking-[0.22em] uppercase">{SECTION_TITLE[section]}</h2>
            {section !== "collections" ? (
              <Link href={section === "sale_picks" ? "/store/sale" : section === "new_in" ? "/store/new-in" : "/store/women"} className="text-[10px] tracking-[0.18em] uppercase">
                View all
              </Link>
            ) : null}
          </div>
          {section === "collections" ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {COLLECTIONS.map((collection) => {
                const slug = collectionSlug(collection)
                return (
                  <Link
                    key={slug}
                    href={`/store/women?collection=${slug}`}
                    className="flex min-h-36 items-end bg-[#141414] p-4 text-[#f6f3ee]"
                  >
                    <span className="text-[12px] tracking-[0.18em] uppercase">{collection}</span>
                  </Link>
                )
              })}
            </div>
          ) : (
            <ProductGrid products={sectionProducts(section)} />
          )}
        </section>
      ))}
      <p className="sr-only">{UI_CONFIG.loyalistCollection}</p>
    </div>
  )
}
