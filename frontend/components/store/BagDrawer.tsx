"use client"

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { CHECKOUT_COPY } from "@/lib/layout/types"
import { startCheckout } from "@/lib/store/actions"
import { bagSubtotal, useStorefront } from "@/lib/store/storeState"
import { formatMoney } from "@/lib/utils"

export function BagDrawer() {
  const open = useStorefront((state) => state.bagOpen)
  const setOpen = useStorefront((state) => state.setBagOpen)
  const bag = useStorefront((state) => state.bag)
  const layout = useStorefront((state) => state.layout)
  const total = bagSubtotal(bag)
  const copy = CHECKOUT_COPY[layout.checkout.variant]
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" showCloseButton={false} className="bg-[#f6f3ee] text-[#141414] sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-serif text-2xl">Bag</SheetTitle>
        </SheetHeader>
        {bag.length === 0 ? (
          <p className="px-4 text-sm text-neutral-600">Your bag is empty.</p>
        ) : (
          <ul className="flex flex-col gap-3 px-4">
            {bag.map((line) => (
              <li key={line.lineId} className="flex justify-between gap-3 text-sm">
                <span>
                  {line.name}
                  <span className="block text-xs text-neutral-500">
                    {line.color} / {line.size} · qty {line.qty}
                  </span>
                </span>
                <span className="tabular-nums">{formatMoney(line.unitPrice * line.qty)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-auto border-t border-[#e4dfd6] p-4">
          <div className="mb-3 flex justify-between text-sm">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatMoney(total)}</span>
          </div>
          {layout.checkout.loyaltyPrompt ? (
            <p className="mb-3 text-xs text-neutral-600">Earn {Math.round(total)} SoCal points with this order.</p>
          ) : null}
          {layout.checkout.showTrustBadges ? (
            <p className="mb-3 text-[10px] tracking-[0.16em] text-neutral-500 uppercase">Visa Secure · Buyer protection</p>
          ) : null}
          <p className="mb-3 text-xs text-neutral-600">
            {copy.title}. {copy.detail}
          </p>
          <button
            type="button"
            disabled={bag.length === 0}
            onClick={() => startCheckout()}
            className="w-full bg-[#141414] py-3 text-[11px] tracking-[0.18em] text-white uppercase disabled:opacity-40"
          >
            {layout.checkout.expressCheckout ? "Express checkout" : "Checkout"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
