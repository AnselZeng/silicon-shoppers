"use client"

import { useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { UI_CONFIG } from "@/config/ui"
import { FilterSidebar } from "@/components/store/FilterSidebar"
import { ProductGrid } from "@/components/store/ProductGrid"
import { SortDropdown } from "@/components/store/SortDropdown"
import type { SortOption } from "@/lib/personas/schema"
import { emitStoreEvent } from "@/lib/store/emit"
import { applyFilters, baseProducts, listingHref, parseListingQuery } from "@/lib/store/filtering"
import { sortProducts } from "@/lib/store/sorting"
import { useStorefront } from "@/lib/store/storeState"
import { modePath, type ListingMode, type ListingQuery } from "@/lib/store/types"

export function ListingView({ mode }: { mode: ListingMode }) {
  const params = useSearchParams()
  const router = useRouter()
  const layout = useStorefront((state) => state.layout)
  const query = useMemo(() => parseListingQuery(new URLSearchParams(params.toString())), [params])
  const sort = query.sort ?? layout.listing.defaultSort
  const path = modePath(mode)
  const pageKey = `${params.toString()}|${layout.listing.defaultSort}`
  const [paging, setPaging] = useState<{ key: string; count: number }>({ key: pageKey, count: UI_CONFIG.listingPageSize })
  const visible = paging.key === pageKey ? paging.count : UI_CONFIG.listingPageSize

  const products = useMemo(() => {
    const filtered = applyFilters(baseProducts(mode), query, mode)
    return sortProducts(filtered, sort, query.q)
  }, [mode, query, sort])

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

  const title =
    mode === "women"
      ? "Women"
      : mode === "men"
        ? "Men"
        : mode === "new-in"
          ? "New in"
          : mode === "sale"
            ? "Sale"
            : query.q
              ? `Search “${query.q}”`
              : "Search"

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] tracking-[0.22em] text-neutral-500 uppercase">Atelier Nine</p>
          <h1 className="font-serif text-4xl tracking-tight">{title}</h1>
          <p className="mt-2 text-xs tracking-[0.14em] text-neutral-500 uppercase">{products.length} pieces</p>
        </div>
        <SortDropdown sort={sort} onSort={onSort} />
      </div>
      <div className="flex flex-col items-start gap-6 md:flex-row md:gap-8">
        <FilterSidebar query={query} onQuery={onQuery} />
        <div className="min-w-0 flex-1">
          <ProductGrid products={products.slice(0, visible)} />
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
