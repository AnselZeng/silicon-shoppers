"use client"

import Link from "next/link"
import { adContent, placementFor } from "@/lib/ads/placement"
import type { AdKind } from "@/lib/ads/types"
import { emitStoreEvent } from "@/lib/store/emit"
import { useStorefront } from "@/lib/store/storeState"

const KICKER: Record<AdKind, string> = {
  sale: "Private sale",
  new_drop: "Just landed",
  collection: "Autumn / Winter",
  category: "The edit",
  newsletter: "Atelier Nine",
  shipping: "Atelier Nine",
  loyalty: "Atelier points",
}

const TONE: Record<AdKind, string> = {
  sale: "bg-[#141414] text-[#f6f3ee]",
  new_drop: "bg-[#6b2c3a] text-[#f6f3ee]",
  collection: "bg-[#efeae2] text-[#141414]",
  category: "bg-[#3d4a3a] text-[#f6f3ee]",
  newsletter: "bg-[#efeae2] text-[#141414]",
  shipping: "bg-[#efeae2] text-[#141414]",
  loyalty: "bg-[#3d4a3a] text-[#f6f3ee]",
}

export function Hero({ compact = false }: { compact?: boolean }) {
  const layout = useStorefront((state) => state.layout)
  const id = placementFor(layout, "hero")?.adIds[0]
  if (!id) return null
  const ad = adContent(layout, id)
  const short = compact || layout.home.heroSize === "compact"
  const light = TONE[ad.kind].includes("#efeae2")
  return (
    <section className={`${TONE[ad.kind]} ${short ? "px-4 py-6 sm:px-6" : "px-5 py-10 sm:px-8 sm:py-16"}`}>
      <p className="text-[10px] tracking-[0.28em] uppercase opacity-70">{KICKER[ad.kind]}</p>
      <h1 className={`font-serif tracking-tight ${short ? "mt-1 text-3xl" : "mt-3 text-4xl sm:text-6xl"}`}>{ad.headline}</h1>
      {short || !ad.body ? null : <p className="mt-4 max-w-md text-sm leading-relaxed opacity-80">{ad.body}</p>}
      <Link
        href={ad.href}
        onClick={() => emitStoreEvent("banner_clicked", { variant: ad.kind, adId: ad.id })}
        className={`mt-5 inline-block border px-4 py-2 text-[11px] tracking-[0.18em] uppercase ${
          light ? "border-[#141414]" : "border-white/70"
        }`}
      >
        {ad.cta}
      </Link>
    </section>
  )
}
