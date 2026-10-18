"use client"

import Link from "next/link"
import { GarmentImage } from "@/components/store/GarmentImage"
import type { HouseAd } from "@/lib/ads/catalog"
import { AD_KICKER, AD_TONE, PATTERN_STYLE } from "@/lib/ads/style"
import { useAdShown } from "@/lib/ads/useAdShown"
import { emitStoreEvent } from "@/lib/store/emit"
import { cn } from "@/lib/utils"

/** The grid_tile slot's format: an ad card the size of a product card. */
export function AdTile({ ad }: { ad: HouseAd }) {
  const tone = AD_TONE[ad.kind]
  useAdShown("grid_tile", ad.id, ad.kind)
  return (
    <Link
      href={ad.href}
      onClick={() => emitStoreEvent("ad_clicked", { slot: "grid_tile", adId: ad.id, kind: ad.kind })}
      className={cn("flex aspect-[4/5] flex-col justify-between p-5", tone.className)}
      style={ad.visual === "pattern" ? PATTERN_STYLE : undefined}
    >
      <p className="text-[10px] tracking-[0.28em] uppercase opacity-70">{AD_KICKER[ad.kind]}</p>
      {ad.visual === "garment" && ad.garment ? (
        <GarmentImage type={ad.garment} color={tone.light ? "black" : "cream"} className="mx-auto h-32 w-24" />
      ) : null}
      <div>
        <h3 className="font-serif text-2xl leading-tight tracking-tight">{ad.headline}</h3>
        <span
          className={cn(
            "mt-3 inline-block border px-3 py-1.5 text-[10px] tracking-[0.18em] uppercase",
            tone.light ? "border-[#141414]" : "border-white/70",
          )}
        >
          {ad.cta}
        </span>
      </div>
    </Link>
  )
}
