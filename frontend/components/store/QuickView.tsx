"use client"

import { useEffect } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { GarmentImage } from "@/components/store/GarmentImage"
import { addProductToBag, addProductToWishlist } from "@/lib/store/actions"
import { getProduct } from "@/lib/store/catalog"
import { emitStoreEvent } from "@/lib/store/emit"
import { useStorefront } from "@/lib/store/storeState"
import { effectivePrice } from "@/lib/store/types"
import { formatMoney } from "@/lib/utils"

export function QuickView() {
  const id = useStorefront((state) => state.quickViewId)
  const close = useStorefront((state) => state.setQuickViewId)
  const product = id ? getProduct(id) : undefined

  useEffect(() => {
    if (!product) return
    emitStoreEvent("quickview_opened", {
      productId: product.id,
      isNew: product.isNew,
      onSale: product.salePrice !== undefined,
      collection: product.collection,
    })
  }, [product])

  return (
    <Sheet open={Boolean(product)} onOpenChange={(open) => !open && close(null)}>
      <SheetContent side="right" showCloseButton={false} className="w-[380px] bg-[#f6f3ee] text-[#141414] sm:max-w-md">
        {product ? (
          <div
            data-agent-id="quickview-root"
            data-product-id={product.id}
            data-price={effectivePrice(product)}
            data-color={product.colors[0] ?? "black"}
            data-is-new={product.isNew ? "1" : "0"}
            data-on-sale={product.salePrice !== undefined ? "1" : "0"}
            data-collection={product.collection}
            data-name={product.name}
          >
            <SheetHeader>
              <SheetTitle className="font-serif text-2xl">{product.name}</SheetTitle>
            </SheetHeader>
            <GarmentImage type={product.garmentType} color={product.colors[0] ?? "black"} className="mt-2 w-full" />
            <p className="mt-3 text-sm">{formatMoney(effectivePrice(product))}</p>
            <p className="mt-2 text-sm text-neutral-600">{product.description}</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                data-agent-id="add-to-bag"
                onClick={() => addProductToBag(product)}
                className="bg-[#141414] px-4 py-2 text-[11px] tracking-[0.16em] text-white uppercase"
              >
                Add to bag
              </button>
              <button
                type="button"
                data-agent-id="add-to-wishlist"
                onClick={() => addProductToWishlist(product)}
                className="border border-[#141414] px-4 py-2 text-[11px] tracking-[0.16em] uppercase"
              >
                Save
              </button>
              <button
                type="button"
                data-agent-id="quickview-close"
                onClick={() => close(null)}
                className="px-3 text-[11px] tracking-[0.16em] uppercase"
              >
                Close
              </button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
