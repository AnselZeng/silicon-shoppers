"use client"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { emitStoreEvent } from "@/lib/store/emit"
import { useStorefront } from "@/lib/store/storeState"

export function Popup() {
  const open = useStorefront((state) => state.popupOpen)
  const variant = useStorefront((state) => state.layout.popupVariant)
  const dismiss = useStorefront((state) => state.dismissPopup)
  const newsletter = variant === "newsletter"
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          dismiss()
          emitStoreEvent("popup_dismissed", { variant })
        }
      }}
    >
      <DialogContent showCloseButton={false} className="bg-[#f6f3ee] text-[#141414] sm:max-w-md">
        <p className="text-[10px] tracking-[0.22em] uppercase">Atelier Nine</p>
        <DialogTitle className="font-serif text-2xl">
          {newsletter ? "Notes from the atelier" : "The puffer just landed"}
        </DialogTitle>
        <DialogDescription className="text-[#141414]/70">
          {newsletter
            ? "Early access to sales and the next drop. One email, no weekly noise."
            : "Winter Puffer Jacket is in. Black and cream. Short run."}
        </DialogDescription>
        <div className="flex gap-2">
          <button
            type="button"
            data-agent-id="popup-cta"
            onClick={() => {
              emitStoreEvent("popup_clicked", { variant })
              dismiss()
            }}
            className="bg-[#141414] px-4 py-2 text-[11px] tracking-[0.16em] text-white uppercase"
          >
            {newsletter ? "Join the list" : "See the drop"}
          </button>
          <button
            type="button"
            data-agent-id="popup-close"
            onClick={() => {
              emitStoreEvent("popup_dismissed", { variant })
              dismiss()
            }}
            className="border border-[#141414] px-4 py-2 text-[11px] tracking-[0.16em] uppercase"
          >
            No thanks
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
