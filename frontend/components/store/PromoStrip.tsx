"use client"

import { adContent, placementFor } from "@/lib/ads/placement"
import { useStorefront } from "@/lib/store/storeState"

export function PromoStrip() {
  const layout = useStorefront((state) => state.layout)
  const id = placementFor(layout, "top_strip")?.adIds[0]
  if (!id) return null
  return (
    <div className="bg-[#141414] px-6 py-2 text-center text-[10px] tracking-[0.22em] text-[#f6f3ee] uppercase">
      {adContent(layout, id).headline}
    </div>
  )
}
