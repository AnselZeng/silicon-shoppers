"use client"

import Link from "next/link"
import { AdBanner } from "@/components/store/ads/AdBanner"
import { GarmentImage } from "@/components/store/GarmentImage"
import { AdSlot } from "@/components/store/ads/AdSlot"
import { ProductGrid } from "@/components/store/ProductGrid"
import { adContent } from "@/lib/ads/placement"
import { resolveHome } from "@/lib/layout/home"
import { categoryHref, collectionHref, departmentPath } from "@/lib/layout/links"
import { FILTER_LABEL, type ColorMerchandising, type HomeBlock, type LayoutConfig, type ProductSource } from "@/lib/layout/types"
import { PRODUCTS } from "@/lib/store/catalog"
import { useStorefront } from "@/lib/store/storeState"
import { CATEGORY_LABEL, type CollectionName } from "@/lib/store/types"

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

const TILE_COLS: Record<number, string> = {
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
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

function transitionName(block: HomeBlock): string {
  if (block.type === "product_row") {
    const source = block.source
    if (source.kind === "category") return `row-cat-${source.category}`
    if (source.kind === "collection") return `row-col-${source.collection.replace(/\s+/g, "-")}`
    if (source.kind === "under_price") return `row-under-${source.max}`
    return `row-${source.kind}`
  }
  if (block.type === "collection_spotlight") return `spot-${block.collection.replace(/\s+/g, "-")}`
  if (block.type === "ad_banner") return `ad-${block.adId}`
  if (block.type === "editorial_text") return `copy-${block.copyKey}`
  if (block.type === "category_tiles") return "tiles"
  return "hero"
}

function rowHref(source: ProductSource, layout: LayoutConfig): string | null {
  switch (source.kind) {
    case "for_you":
      return "/store/for-you"
    case "new_in":
      return "/store/new-in"
    case "sale":
      return layout.nav.department ? `${departmentPath(layout)}?sale=1` : "/store/sale"
    case "bestsellers":
      return `${departmentPath(layout)}?sort=bestsellers`
    case "category":
      return categoryHref(layout, source.category)
    case "collection":
      return collectionHref(layout, source.collection)
    case "under_price":
    case "buy_again":
      return null
  }
}

function CollectionSpotlight({ layout, collection }: { layout: LayoutConfig; collection: CollectionName }) {
  const department = layout.nav.department
  const pieces = PRODUCTS.filter((p) => p.collection === collection && (!department || p.department === department))
  const lead = [...pieces].sort((a, b) => b.popularity - a.popularity)[0]
  return (
    <section className="mx-6 my-10 grid items-center gap-8 bg-[#efeae2] p-8 md:grid-cols-[1fr_auto]">
      <div>
        <p className="text-[10px] tracking-[0.28em] text-neutral-500 uppercase">Collection</p>
        <h2 className="mt-2 font-serif text-4xl tracking-tight">{collection}</h2>
        <p className="mt-3 text-sm text-neutral-600">{pieces.length} pieces</p>
        <Link
          href={collectionHref(layout, collection)}
          className="mt-5 inline-block border border-[#141414] px-4 py-2 text-[11px] tracking-[0.18em] uppercase"
        >
          Shop {collection}
        </Link>
      </div>
      {lead ? <GarmentImage type={lead.garmentType} color={lead.colors[0] ?? "black"} className="h-56 w-44" /> : null}
    </section>
  )
}

export function HomeView() {
  const layout = useStorefront((state) => state.layout)
  const blocks = resolveHome(layout)

  return (
    <div>
      {blocks.map((entry) => {
        const block = entry.block
        const name = transitionName(block)
        const lead = blocks.find((item) => item.block.type === "product_row")?.block === block
        if (block.type === "hero") {
          return (
            <div key={name} style={{ viewTransitionName: name }}>
              <AdSlot slot="hero" />
              <p className="px-6 pt-4 text-[10px] tracking-[0.18em] text-neutral-500 uppercase">
                {SORT_LINE[layout.listing.defaultSort]} · Filters lead with{" "}
                {FILTER_LABEL[layout.listing.filterOrder[0] ?? "category"]} · {MERCH_LINE[layout.listing.colorMerchandising]}
              </p>
            </div>
          )
        }
        if ("products" in entry) {
          if (entry.products.length === 0) return null
          const href = rowHref(entry.block.source, layout)
          return (
            <section key={name} style={{ viewTransitionName: name }} className="px-6 py-10">
              <div className="mb-6 flex items-baseline justify-between">
                <h2 className={lead ? "font-serif text-4xl tracking-tight" : "text-[11px] tracking-[0.22em] uppercase"}>
                  {entry.block.title ?? rowTitle(entry.block.source)}
                </h2>
                {href ? (
                  <Link href={href} className="text-[10px] tracking-[0.18em] uppercase">
                    View all
                  </Link>
                ) : null}
              </div>
              <ProductGrid products={entry.products} columns={4} />
            </section>
          )
        }
        if (block.type === "category_tiles") {
          return (
            <section key={name} style={{ viewTransitionName: name }} className="px-6 py-10">
              <h2 className="mb-6 text-[11px] tracking-[0.22em] uppercase">Shop by category</h2>
              <div className={`grid grid-cols-2 gap-4 md:grid-cols-3 ${TILE_COLS[block.categories.length] ?? "lg:grid-cols-6"}`}>
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
        if (block.type === "collection_spotlight") {
          return (
            <div key={name} style={{ viewTransitionName: name }}>
              <CollectionSpotlight layout={layout} collection={block.collection} />
            </div>
          )
        }
        if (block.type === "editorial_text") {
          const text = layout.copy[block.copyKey]
          if (!text) return null
          return (
            <section key={name} style={{ viewTransitionName: name }} className="px-6 py-12">
              <p
                className={`mx-auto max-w-2xl text-center font-serif tracking-tight ${
                  block.copyKey === "intro" ? "text-2xl" : "text-lg leading-relaxed text-neutral-700"
                }`}
              >
                {text}
              </p>
            </section>
          )
        }
        if (block.type === "ad_banner") {
          return (
            <div key={name} style={{ viewTransitionName: name }}>
              <AdBanner ad={adContent(layout, block.adId)} slot="home_block" className="mx-6 my-6" />
            </div>
          )
        }
        return null
      })}
    </div>
  )
}
