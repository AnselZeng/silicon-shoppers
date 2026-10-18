"use client"

import Link from "next/link"
import type { HouseAd } from "@/lib/ads/catalog"
import { emitStoreEvent } from "@/lib/store/emit"

/** The top_strip slot's format: a thin bar above the header. */
export function PromoStrip({ ad }: { ad: HouseAd }) {
  return (
    <Link
      href={ad.href}
      onClick={() => emitStoreEvent("ad_clicked", { slot: "top_strip", adId: ad.id, kind: ad.kind })}
      className="block bg-[#141414] px-6 py-2 text-center text-[10px] tracking-[0.22em] text-[#f6f3ee] uppercase hover:opacity-90"
    >
      {ad.headline}
    </Link>
  )
}
