"use client"

import Link from "next/link"
import { GarmentImage } from "@/components/store/GarmentImage"
import type { HouseAd } from "@/lib/ads/catalog"
import { AD_KICKER, AD_TONE, PATTERN_STYLE } from "@/lib/ads/style"
import type { AdSlotId } from "@/lib/ads/types"
import { emitStoreEvent } from "@/lib/store/emit"
import { cn } from "@/lib/utils"

/** A static banner: home ad_banner blocks and the listing_banner slot. */
export function AdBanner({ ad, slot, className }: { ad: HouseAd; slot: AdSlotId | "home_block"; className?: string }) {
  const tone = AD_TONE[ad.kind]
  return (
    <section
      className={cn("flex items-center gap-6 overflow-hidden px-6 py-6", tone.className, className)}
      style={ad.visual === "pattern" ? PATTERN_STYLE : undefined}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[10px] tracking-[0.28em] uppercase opacity-70">{AD_KICKER[ad.kind]}</p>
        <h2 className="mt-1 font-serif text-2xl tracking-tight sm:text-3xl">{ad.headline}</h2>
        {ad.body ? <p className="mt-2 max-w-lg text-sm opacity-80">{ad.body}</p> : null}
      </div>
      <Link
        href={ad.href}
        onClick={() => emitStoreEvent("ad_clicked", { slot, adId: ad.id, kind: ad.kind })}
        className={cn(
          "shrink-0 border px-4 py-2 text-[11px] tracking-[0.18em] uppercase",
          tone.light ? "border-[#141414]" : "border-white/70",
        )}
      >
        {ad.cta}
      </Link>
      {ad.visual === "garment" && ad.garment ? (
        <GarmentImage type={ad.garment} color={tone.light ? "black" : "cream"} className="hidden h-28 w-24 shrink-0 sm:block" />
      ) : null}
    </section>
  )
}
