"use client"

import { useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { UI_CONFIG } from "@/config/ui"
import { AdSlot } from "@/components/store/ads/AdSlot"
import { FilterSidebar } from "@/components/store/FilterSidebar"
import { ProductGrid } from "@/components/store/ProductGrid"
import { SortDropdown } from "@/components/store/SortDropdown"
import type { SortOption } from "@/lib/personas/schema"
import { emitStoreEvent } from "@/lib/store/emit"
import { applyFilters, baseProducts, listingHref, parseListingQuery } from "@/lib/store/filtering"
import { sortProducts } from "@/lib/store/sorting"
import { useStorefront } from "@/lib/store/storeState"
import { modePath, CATEGORY_LABEL, COLLECTIONS, type ListingMode, type ListingQuery } from "@/lib/store/types"
import { collectionSlug } from "@/lib/utils"

function listingTitle(mode: ListingMode, query: ListingQuery): string {
  if (query.categories.length === 1) {
    const category = query.categories[0]
    if (category) return CATEGORY_LABEL[category]
  }
  if (query.collections.length === 1) {
    const slug = query.collections[0]
    const name = COLLECTIONS.find((collection) => collectionSlug(collection) === slug)
    if (name) return name
  }
  if (mode === "women") return "Women"
  if (mode === "men") return "Men"
  if (mode === "new-in") return "New in"
  if (mode === "sale") return "Sale"
  if (mode === "for-you") return "For you"
  if (query.q) return `Search “${query.q}”`
  return "Search"
}

export function ListingView({ mode }: { mode: ListingMode }) {
  const params = useSearchParams()
  const router = useRouter()
  const layout = useStorefront((state) => state.layout)
  const query = useMemo(() => parseListingQuery(new URLSearchParams(params.toString())), [params])
  const sort = query.sort ?? layout.listing.defaultSort
  /** For You keeps the model's ranking until the shopper picks a sort. */
  const keepRank = mode === "for-you" && !query.sort
  const path = modePath(mode)
  const pageKey = `${params.toString()}|${layout.listing.defaultSort}`
  const [paging, setPaging] = useState<{ key: string; count: number }>({ key: pageKey, count: UI_CONFIG.listingPageSize })
  const visible = paging.key === pageKey ? paging.count : UI_CONFIG.listingPageSize

  const products = useMemo(() => {
    const filtered = applyFilters(baseProducts(mode, layout.home.forYouIds), query, mode)
    return keepRank ? filtered : sortProducts(filtered, sort, query.q)
  }, [mode, query, sort, keepRank, layout.home.forYouIds])

  function write(next: ListingQuery) {
    router.push(listingHref(path, next), { scroll: false })
  }

  function onSort(nextSort: SortOption) {
    write({ ...query, sort: nextSort })
    emitStoreEvent("sort_changed", { sort: nextSort })
  }

  function onQuery(
    next: ListingQuery,
    event: "filter_applied" | "filter_removed",
    filter: string,
    value?: string,
  ) {
    write(next)
    emitStoreEvent(event, { filter, section: filter, value: value ?? "" })
  }

  const title = listingTitle(mode, query)

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] tracking-[0.22em] text-neutral-500 uppercase">SoCal Atelier</p>
          <h1 className="font-serif text-4xl tracking-tight">{title}</h1>
          <p className="mt-2 text-xs tracking-[0.14em] text-neutral-500 uppercase">{products.length} pieces</p>
        </div>
        <SortDropdown sort={sort} onSort={onSort} />
      </div>
      <div className="flex flex-col items-start gap-6 md:flex-row md:gap-8">
        <FilterSidebar query={query} onQuery={onQuery} />
        <div className="min-w-0 flex-1">
          <AdSlot slot="listing_banner" />
          <ProductGrid products={products.slice(0, visible)} withAds />
          {visible < products.length ? (
            <button
              type="button"
              onClick={() => setPaging({ key: pageKey, count: visible + UI_CONFIG.listingPageSize })}
              className="mt-10 border border-[#141414] px-6 py-3 text-[11px] tracking-[0.18em] uppercase"
            >
              Load more
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
