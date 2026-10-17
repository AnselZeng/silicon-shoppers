"use client"

import Link from "next/link"
import { useStorefront } from "@/lib/store/storeState"
import { addProductToWishlist } from "@/lib/store/actions"
import { effectivePrice, type Product } from "@/lib/store/types"
import { formatMoney } from "@/lib/utils"
import { GarmentImage } from "@/components/store/GarmentImage"

export function ProductCard({ product }: { product: Product }) {
  const layout = useStorefront((state) => state.layout)
  const openQuick = useStorefront((state) => state.setQuickViewId)
  const price = effectivePrice(product)
  const onSale = product.salePrice !== undefined
  const color = product.colors[0] ?? "black"
  return (
    <article className="group relative">
      <Link
        href={`/store/product/${product.id}`}
        data-agent-id={`product-card-${product.id}`}
        data-product-id={product.id}
        data-price={price}
        data-color={color}
        data-is-new={product.isNew ? "1" : "0"}
        data-on-sale={onSale ? "1" : "0"}
        data-collection={product.collection}
        data-name={product.name}
        className="block"
      >
        <div className="relative overflow-hidden bg-[#ebe6dc]">
          <GarmentImage type={product.garmentType} color={color} className="aspect-[4/5] w-full" />
          {onSale ? (
            <span
              className={
                layout.showSaleBadgesProminently
                  ? "absolute top-3 left-3 bg-[#9f2d2d] px-2 py-1 text-[11px] font-semibold tracking-[0.16em] text-white uppercase"
                  : "absolute top-3 left-3 text-[10px] tracking-[0.2em] text-[#9f2d2d] uppercase"
              }
            >
              Sale
            </span>
          ) : null}
          {product.isNew ? (
            <span className="absolute top-3 right-3 text-[10px] tracking-[0.2em] uppercase">New</span>
          ) : null}
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] tracking-wide">{product.name}</h3>
          <p className="shrink-0 text-[13px] tabular-nums">
            {onSale ? (
              <>
                <span className={layout.showSaleBadgesProminently ? "font-semibold text-[#9f2d2d]" : "text-[#9f2d2d]"}>
                  {formatMoney(price)}
                </span>{" "}
                <span className="text-neutral-400 line-through">{formatMoney(product.price)}</span>
              </>
            ) : (
              formatMoney(product.price)
            )}
          </p>
        </div>
        <p className="mt-1 text-[10px] tracking-[0.18em] text-neutral-500 uppercase">
          {product.collection}
        </p>
      </Link>
      <button
        type="button"
        data-agent-id={`wishlist-btn-${product.id}`}
        aria-label={`Save ${product.name}`}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          addProductToWishlist(product)
        }}
        className="absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-full bg-white/90 text-sm"
      >
        ♡
      </button>
      <button
        type="button"
        data-agent-id={`quickview-btn-${product.id}`}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          openQuick(product.id)
        }}
        className={
          layout.quickViewEmphasis
            ? "absolute bottom-16 left-3 z-10 bg-black px-3 py-1.5 text-[10px] tracking-[0.18em] text-white uppercase"
            : "absolute bottom-16 left-3 z-10 bg-white/90 px-3 py-1.5 text-[10px] tracking-[0.18em] uppercase opacity-0 transition group-hover:opacity-100"
        }
      >
        Quick view
      </button>
    </article>
  )
}
