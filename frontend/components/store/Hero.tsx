"use client"

import Link from "next/link"
import type { HouseAd } from "@/lib/ads/catalog"
import { AD_KICKER, AD_TONE, PATTERN_STYLE } from "@/lib/ads/style"
import { GarmentImage } from "@/components/store/GarmentImage"
import { emitStoreEvent } from "@/lib/store/emit"
import { cn } from "@/lib/utils"

/** The hero slot's format: one house ad, large or compact, with dots when it rotates. */
export function Hero({
  ad,
  compact,
  count = 1,
  index = 0,
  onPick,
}: {
  ad: HouseAd
  compact: boolean
  count?: number
  index?: number
  onPick?: (index: number) => void
}) {
  const tone = AD_TONE[ad.kind]
  return (
    <section
      className={cn("relative flex items-center gap-8", tone.className, compact ? "px-4 py-6 sm:px-6" : "px-5 py-10 sm:px-8 sm:py-16")}
      style={ad.visual === "pattern" ? PATTERN_STYLE : undefined}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[10px] tracking-[0.28em] uppercase opacity-70">{AD_KICKER[ad.kind]}</p>
        <h1 className={cn("font-serif tracking-tight", compact ? "mt-1 text-3xl" : "mt-3 text-4xl sm:text-6xl")}>{ad.headline}</h1>
        {compact || !ad.body ? null : <p className="mt-4 max-w-md text-sm leading-relaxed opacity-80">{ad.body}</p>}
        <Link
          href={ad.href}
          onClick={() => emitStoreEvent("ad_clicked", { slot: "hero", adId: ad.id, kind: ad.kind })}
          className={cn(
            "mt-5 inline-block border px-4 py-2 text-[11px] tracking-[0.18em] uppercase",
            tone.light ? "border-[#141414]" : "border-white/70",
          )}
        >
          {ad.cta}
        </Link>
      </div>
      {!compact && ad.visual === "garment" && ad.garment ? (
        <GarmentImage type={ad.garment} color={tone.light ? "black" : "cream"} className="hidden h-60 w-48 shrink-0 md:block" />
      ) : null}
      {count > 1 ? (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Show ad ${i + 1}`}
              onClick={() => onPick?.(i)}
              className={cn("size-2 rounded-full", i === index ? "bg-current" : "bg-current opacity-30")}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
