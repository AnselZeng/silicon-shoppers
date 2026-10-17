"use client"

import Link from "next/link"
import { useEffect } from "react"
import { Hero } from "@/components/store/Hero"
import { ProductCard } from "@/components/store/ProductCard"
import { UI_CONFIG } from "@/config/ui"
import type { HomeSectionId } from "@/lib/layout/types"
import { PRODUCTS } from "@/lib/store/catalog"
import { sortProducts } from "@/lib/store/sorting"
import { useStorefront } from "@/lib/store/storeState"
import { COLLECTIONS, type Product } from "@/lib/store/types"
import { collectionSlug } from "@/lib/utils"

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
  useEffect(() => {
    useStorefront.getState().setBrowse(layout.defaultSort, "")
  }, [layout.defaultSort])

  const cols = layout.gridDensity === 4 ? "grid-cols-4" : layout.gridDensity === 2 ? "grid-cols-2" : "grid-cols-4"

  return (
    <div>
      <Hero />
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
            <div className="grid grid-cols-4 gap-4">
              {COLLECTIONS.map((collection) => {
                const slug = collectionSlug(collection)
                return (
                  <Link
                    key={slug}
                    href={`/store/women?collection=${slug}`}
                    data-agent-id={`collection-tile-${slug}`}
                    className="flex min-h-36 items-end bg-[#141414] p-4 text-[#f6f3ee]"
                  >
                    <span className="text-[12px] tracking-[0.18em] uppercase">{collection}</span>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className={`grid gap-5 ${cols}`}>
              {sectionProducts(section).map((product) => (
                <ProductCard key={`${section}-${product.id}`} product={product} />
              ))}
            </div>
          )}
        </section>
      ))}
      <p className="sr-only">{UI_CONFIG.loyalistCollection}</p>
    </div>
  )
}
