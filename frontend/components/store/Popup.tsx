"use client"

import { AdClose } from "@/components/store/ads/AdClose"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import type { HouseAd } from "@/lib/ads/catalog"

/** The popup slot's format: a dismissible modal. */
export function Popup({ ad, open, onClose }: { ad: HouseAd; open: boolean; onClose: (clicked: boolean) => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose(false)
      }}
    >
      <DialogContent showCloseButton={false} className="bg-[#f6f3ee] text-[#141414] sm:max-w-md">
        <div className="flex items-start justify-between gap-4">
          <p className="text-[10px] tracking-[0.22em] uppercase">Atelier Nine</p>
          <AdClose onClose={() => onClose(false)} />
        </div>
        <DialogTitle className="font-serif text-2xl">{ad.headline}</DialogTitle>
        {ad.body ? <DialogDescription className="text-[#141414]/70">{ad.body}</DialogDescription> : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onClose(true)}
            className="bg-[#141414] px-4 py-2 text-[11px] tracking-[0.16em] text-white uppercase"
          >
            {ad.cta}
          </button>
          <button
            type="button"
            onClick={() => onClose(false)}
            className="border border-[#141414] px-4 py-2 text-[11px] tracking-[0.16em] uppercase"
          >
            No thanks
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
