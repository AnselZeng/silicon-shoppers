"use client"

import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { CHECKOUT_COPY } from "@/lib/layout/types"
import { captureCheckout } from "@/lib/store/actions"
import { useStorefront } from "@/lib/store/storeState"
import { formatMoney } from "@/lib/utils"

export function VisaCheckout() {
  const router = useRouter()
  const phase = useStorefront((state) => state.checkoutPhase)
  const session = useStorefront((state) => state.visaSession)
  const layout = useStorefront((state) => state.layout)
  const open = phase === "session" && session !== null
  if (!session) return null
  const copy = CHECKOUT_COPY[session.mode]
  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false} className="bg-white text-[#141414] sm:max-w-md">
        <p className="text-[10px] tracking-[0.22em] text-neutral-500 uppercase">Visa Unified Checkout</p>
        <DialogTitle className="font-serif text-2xl">{copy.title}</DialogTitle>
        <DialogDescription className="text-[#141414]/70">
          Demo only · no Visa keys. {copy.detail}
        </DialogDescription>
        <div className="border border-[#e6e6e6] p-4 text-sm">
          <p>Visa •••• {session.last4}</p>
          <p className="mt-1 text-lg tabular-nums">{formatMoney(session.amount)}</p>
          {layout.checkout.loyaltyPrompt ? (
            <p className="mt-2 text-xs">This payment awards {Math.round(session.amount)} points.</p>
          ) : null}
          {layout.checkout.showTrustBadges ? (
            <p className="mt-2 text-[10px] tracking-[0.16em] uppercase">Visa Secure</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            const captured = captureCheckout()
            if (captured) router.push("/store/confirmation")
          }}
          className="bg-[#1a1f71] py-3 text-[11px] tracking-[0.18em] text-white uppercase"
        >
          Pay with Visa
        </button>
      </DialogContent>
    </Dialog>
  )
}
