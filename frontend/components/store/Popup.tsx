"use client"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { adContent, capKey, placementFor } from "@/lib/ads/placement"
import { emitStoreEvent } from "@/lib/store/emit"
import { useStorefront } from "@/lib/store/storeState"

export function Popup() {
  const open = useStorefront((state) => state.popupOpen)
  const layout = useStorefront((state) => state.layout)
  const dismiss = useStorefront((state) => state.dismissPopup)
  const markAd = useStorefront((state) => state.markAd)
  const id = placementFor(layout, "popup")?.adIds[0]
  if (!id) return null
  const ad = adContent(layout, id)
  const close = (clicked: boolean) => {
    emitStoreEvent(clicked ? "popup_clicked" : "popup_dismissed", { variant: ad.kind, adId: ad.id })
    markAd(capKey("popup", ad.id), "dismissed")
    dismiss()
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close(false)
      }}
    >
      <DialogContent showCloseButton={false} className="bg-[#f6f3ee] text-[#141414] sm:max-w-md">
        <p className="text-[10px] tracking-[0.22em] uppercase">Atelier Nine</p>
        <DialogTitle className="font-serif text-2xl">{ad.headline}</DialogTitle>
        {ad.body ? <DialogDescription className="text-[#141414]/70">{ad.body}</DialogDescription> : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => close(true)}
            className="bg-[#141414] px-4 py-2 text-[11px] tracking-[0.16em] text-white uppercase"
          >
            {ad.cta}
          </button>
          <button
            type="button"
            onClick={() => close(false)}
            className="border border-[#141414] px-4 py-2 text-[11px] tracking-[0.16em] uppercase"
          >
            No thanks
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
