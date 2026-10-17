"use client"

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useStorefront } from "@/lib/store/storeState"
import { formatMoney } from "@/lib/utils"

export function WishlistDrawer() {
  const open = useStorefront((state) => state.wishlistOpen)
  const setOpen = useStorefront((state) => state.setWishlistOpen)
  const wishlist = useStorefront((state) => state.wishlist)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" showCloseButton={false} className="bg-[#f6f3ee] text-[#141414] sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-serif text-2xl">Wishlist</SheetTitle>
        </SheetHeader>
        {wishlist.length === 0 ? (
          <p className="px-4 text-sm text-neutral-600">Nothing saved yet.</p>
        ) : (
          <ul className="flex flex-col gap-3 px-4">
            {wishlist.map((item) => (
              <li key={item.productId} className="flex justify-between text-sm">
                <span>
                  {item.name}
                  <span className="block text-xs text-neutral-500">{item.color}</span>
                </span>
                <span>{formatMoney(item.price)}</span>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  )
}
