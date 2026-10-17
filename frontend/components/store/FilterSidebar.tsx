"use client"

import { useEffect, useState } from "react"
import { COLOR_HEX, STORE_COLORS } from "@/config/ui"
import { FILTER_LABEL, type FilterSectionId } from "@/lib/layout/types"
import { useStorefront } from "@/lib/store/storeState"
import { toggleValue } from "@/lib/store/filtering"
import {
  APPAREL_SIZES,
  CATEGORIES,
  CATEGORY_LABEL,
  COLLECTIONS,
  type Category,
  type ListingQuery,
  type PriceBand,
} from "@/lib/store/types"
import { collectionSlug } from "@/lib/utils"

const PRICE_OPTIONS: { id: string; band: PriceBand; label: string }[] = [
  { id: "filter-price-under-60", band: "under-60", label: "Under $60" },
  { id: "filter-price-60-120", band: "60-120", label: "$60 – $120" },
  { id: "filter-price-over-120", band: "over-120", label: "Over $120" },
]

export function FilterSidebar({
  query,
  onQuery,
}: {
  query: ListingQuery
  onQuery: (next: ListingQuery, event: "filter_applied" | "filter_removed", filter: string, value?: string) => void
}) {
  const layout = useStorefront((state) => state.layout)
  const [expanded, setExpanded] = useState<FilterSectionId[]>(layout.expandedFilters)
  const signature = layout.expandedFilters.join("|")

  useEffect(() => {
    setExpanded(layout.expandedFilters)
  }, [signature, layout.expandedFilters])

  function push(next: ListingQuery, applied: boolean, filter: string, value?: string) {
    onQuery(next, applied ? "filter_applied" : "filter_removed", filter, value)
  }

  return (
    <aside className="w-full shrink-0 md:w-52">
      <p className="mb-4 text-[10px] tracking-[0.22em] text-neutral-500 uppercase">Filters</p>
      <div className="flex flex-col gap-2">
        {layout.filterOrder.map((section) => {
          const open = expanded.includes(section)
          return (
            <div key={section} className="border-b border-[#e4dfd6] pb-2">
              <button
                type="button"
                data-agent-id={`filter-section-${section}`}
                aria-expanded={open}
                onClick={() =>
                  setExpanded((current) =>
                    current.includes(section)
                      ? current.filter((item) => item !== section)
                      : [...current, section],
                  )
                }
                className="flex w-full items-center justify-between py-2 text-left text-[11px] tracking-[0.16em] uppercase"
              >
                {FILTER_LABEL[section]}
                <span>{open ? "–" : "+"}</span>
              </button>
              {open ? (
                <div className="flex flex-col gap-1 pb-2">
                  {section === "sale" ? (
                    <button
                      type="button"
                      data-agent-id="filter-sale-toggle"
                      aria-pressed={query.sale}
                      onClick={() => push({ ...query, sale: !query.sale }, !query.sale, "sale", "1")}
                      className={`px-2 py-1 text-left text-sm ${query.sale ? "bg-[#141414] text-white" : "hover:bg-white"}`}
                    >
                      On sale
                    </button>
                  ) : null}
                  {section === "price"
                    ? PRICE_OPTIONS.map((option) => {
                        const active = query.prices.includes(option.band)
                        return (
                          <button
                            key={option.id}
                            type="button"
                            data-agent-id={option.id}
                            aria-pressed={active}
                            onClick={() =>
                              push(
                                { ...query, prices: toggleValue(query.prices, option.band) },
                                !active,
                                "price",
                                option.band,
                              )
                            }
                            className={`px-2 py-1 text-left text-sm ${active ? "bg-[#141414] text-white" : "hover:bg-white"}`}
                          >
                            {option.label}
                          </button>
                        )
                      })
                    : null}
                  {section === "size"
                    ? APPAREL_SIZES.map((size) => {
                        const active = query.sizes.includes(size)
                        return (
                          <button
                            key={size}
                            type="button"
                            data-agent-id={`filter-size-${size}`}
                            aria-pressed={active}
                            onClick={() =>
                              push(
                                { ...query, sizes: toggleValue(query.sizes, size) },
                                !active,
                                "size",
                                size,
                              )
                            }
                            className={`px-2 py-1 text-left text-sm ${active ? "bg-[#141414] text-white" : "hover:bg-white"}`}
                          >
                            {size}
                          </button>
                        )
                      })
                    : null}
                  {section === "color" ? (
                    <div className="flex flex-wrap gap-2 px-1 py-1">
                      {STORE_COLORS.map((color) => {
                        const active = query.colors.includes(color)
                        return (
                          <button
                            key={color}
                            type="button"
                            data-agent-id={`filter-color-${color}`}
                            aria-label={color}
                            aria-pressed={active}
                            title={color}
                            onClick={() =>
                              push(
                                { ...query, colors: toggleValue(query.colors, color) },
                                !active,
                                "color",
                                color,
                              )
                            }
                            className={`size-6 rounded-full border ${active ? "ring-2 ring-[#141414] ring-offset-2" : "border-black/10"}`}
                            style={{ background: COLOR_HEX[color] }}
                          />
                        )
                      })}
                    </div>
                  ) : null}
                  {section === "category"
                    ? CATEGORIES.map((category) => {
                        const active = query.categories.includes(category)
                        return (
                          <button
                            key={category}
                            type="button"
                            data-agent-id={`filter-category-${category}`}
                            aria-pressed={active}
                            onClick={() =>
                              push(
                                {
                                  ...query,
                                  categories: toggleValue<Category>(query.categories, category),
                                },
                                !active,
                                "category",
                                category,
                              )
                            }
                            className={`px-2 py-1 text-left text-sm ${active ? "bg-[#141414] text-white" : "hover:bg-white"}`}
                          >
                            {CATEGORY_LABEL[category]}
                          </button>
                        )
                      })
                    : null}
                  {section === "collection"
                    ? COLLECTIONS.map((collection) => {
                        const slug = collectionSlug(collection)
                        const active = query.collections.includes(slug)
                        return (
                          <button
                            key={slug}
                            type="button"
                            data-agent-id={`filter-collection-${slug}`}
                            aria-pressed={active}
                            onClick={() =>
                              push(
                                { ...query, collections: toggleValue(query.collections, slug) },
                                !active,
                                "collection",
                                slug,
                              )
                            }
                            className={`px-2 py-1 text-left text-sm ${active ? "bg-[#141414] text-white" : "hover:bg-white"}`}
                          >
                            {collection}
                          </button>
                        )
                      })
                    : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
