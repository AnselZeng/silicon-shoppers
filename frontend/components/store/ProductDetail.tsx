"use client"

import { useEffect } from "react"
import { GarmentImage } from "@/components/store/GarmentImage"
import { COLOR_HEX } from "@/config/ui"
import { addProductToBag, addProductToWishlist } from "@/lib/store/actions"
import { getProduct } from "@/lib/store/catalog"
import { emitStoreEvent } from "@/lib/store/emit"
import { reviewsFor } from "@/lib/store/reviews"
import { useStorefront } from "@/lib/store/storeState"
import { effectivePrice } from "@/lib/store/types"
import { formatMoney } from "@/lib/utils"

export function ProductDetail({ id }: { id: string }) {
  const product = getProduct(id)
  const selectedColor = useStorefront((state) => state.selectedColor[id])
  const selectedSize = useStorefront((state) => state.selectedSize[id])
  const selectColor = useStorefront((state) => state.selectColor)
  const selectSize = useStorefront((state) => state.selectSize)

  useEffect(() => {
    if (!product) return
    emitStoreEvent("product_viewed", {
      productId: product.id,
      isNew: product.isNew,
      onSale: product.salePrice !== undefined,
      collection: product.collection,
      price: effectivePrice(product),
    })
  }, [product])

  if (!product) {
    return <p className="px-6 py-16 text-sm">This piece is no longer in the edit.</p>
  }

  const color = selectedColor ?? product.colors[0] ?? "black"
  const size = selectedSize ?? (product.sizes.includes("M") ? "M" : product.sizes[0] ?? "OS")
  const reviews = reviewsFor(product.id)

  return (
    <div
      className="grid gap-10 px-6 py-10 lg:grid-cols-[1.1fr_0.9fr]"
    >
      <div>
        <GarmentImage type={product.garmentType} color={color} className="w-full bg-[#ebe6dc]" />
        <div className="mt-3 flex gap-2">
          {product.colors.map((swatch) => (
            <button
              key={swatch}
              type="button"
              onClick={() => selectColor(product.id, swatch)}
              className={`h-16 w-14 border ${swatch === color ? "border-[#141414]" : "border-transparent"}`}
            >
              <GarmentImage type={product.garmentType} color={swatch} className="h-full w-full" />
            </button>
          ))}
        </div>
      </div>
      <div className="lg:sticky lg:top-20 lg:self-start">
        <p className="text-[10px] tracking-[0.22em] text-neutral-500 uppercase">{product.collection}</p>
        <h1 className="mt-2 font-serif text-4xl tracking-tight">{product.name}</h1>
        <p className="mt-4 text-lg tabular-nums">
          {product.salePrice ? (
            <>
              <span className="text-[#9f2d2d]">{formatMoney(product.salePrice)}</span>{" "}
              <span className="text-neutral-400 line-through">{formatMoney(product.price)}</span>
            </>
          ) : (
            formatMoney(product.price)
          )}
        </p>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-neutral-700">{product.description}</p>
        <div className="mt-6 flex gap-2">
          {product.colors.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={swatch}
              onClick={() => selectColor(product.id, swatch)}
              className={`size-7 rounded-full border ${swatch === color ? "ring-2 ring-[#141414] ring-offset-2" : "border-black/10"}`}
              style={{ background: COLOR_HEX[swatch] }}
            />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {product.sizes.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => selectSize(product.id, option)}
              className={`min-w-10 border px-3 py-2 text-xs ${option === size ? "border-[#141414] bg-[#141414] text-white" : "border-[#d9d3c8]"}`}
            >
              {option}
            </button>
          ))}
        </div>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => addProductToBag(product)}
            className="bg-[#141414] px-6 py-3 text-[11px] tracking-[0.18em] text-white uppercase"
          >
            Add to bag
          </button>
          <button
            type="button"
            onClick={() => addProductToWishlist(product)}
            className="border border-[#141414] px-6 py-3 text-[11px] tracking-[0.18em] uppercase"
          >
            Wishlist
          </button>
        </div>
        <p className="mt-6 text-xs text-neutral-500">
          {product.rating.toFixed(1)} · {product.reviewCount} reviews
        </p>
        <section className="mt-8 border-t border-[#e4dfd6] pt-6">
          <h2 className="text-[11px] tracking-[0.2em] uppercase">Reviews</h2>
          <ul className="mt-4 flex flex-col gap-4">
            {reviews.map((review) => (
              <li key={review.id}>
                <p className="text-sm font-medium">{review.title}</p>
                <p className="text-xs text-neutral-500">
                  {review.author} · {review.rating}/5 · {review.date}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-neutral-700">{review.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
