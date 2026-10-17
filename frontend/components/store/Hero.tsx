"use client"

import Link from "next/link"
import { emitStoreEvent } from "@/lib/store/emit"
import { useStorefront } from "@/lib/store/storeState"
import type { HeroVariant } from "@/lib/layout/types"

const HERO: Record<
  HeroVariant,
  { kicker: string; title: string; body: string; cta: string; href: string; variant: string; className: string }
> = {
  editorial: {
    kicker: "Autumn / Winter",
    title: "Cut for the cold.",
    body: "A quieter wardrobe. Wool, poplin, and the new puffer.",
    cta: "Explore the edit",
    href: "/store/new-in",
    variant: "editorial",
    className: "bg-[#efeae2] text-[#141414]",
  },
  discount_banner: {
    kicker: "Private sale",
    title: "Up to 40% off.",
    body: "Sale prices on tees, trousers, and knits. No code.",
    cta: "Shop the sale",
    href: "/store/sale",
    variant: "discount",
    className: "bg-[#141414] text-[#f6f3ee]",
  },
  new_drop_banner: {
    kicker: "Just landed",
    title: "Winter Puffer.",
    body: "The launch jacket. Matte shell, short hem, two colors.",
    cta: "See the drop",
    href: "/store/product/w-winter-puffer",
    variant: "new_drop",
    className: "bg-[#6b2c3a] text-[#f6f3ee]",
  },
  collection_banner: {
    kicker: "Essentials",
    title: "The pieces you keep.",
    body: "Shirts, trousers, and the column coat. Same cut, every season.",
    cta: "Shop Essentials",
    href: "/store/women?collection=essentials",
    variant: "collection",
    className: "bg-[#3d4a3a] text-[#f6f3ee]",
  },
}

export function Hero({ compact = false }: { compact?: boolean }) {
  const layout = useStorefront((state) => state.layout)
  const hero = HERO[layout.heroVariant]
  const short = compact || layout.heroMinimized
  return (
    <section className={`${hero.className} ${short ? "px-4 py-6 sm:px-6" : "px-5 py-10 sm:px-8 sm:py-16"}`}>
      <p className="text-[10px] tracking-[0.28em] uppercase opacity-70">{hero.kicker}</p>
      <h1 className={`font-serif tracking-tight ${short ? "mt-1 text-3xl" : "mt-3 text-4xl sm:text-6xl"}`}>{hero.title}</h1>
      {short ? null : <p className="mt-4 max-w-md text-sm leading-relaxed opacity-80">{hero.body}</p>}
      <Link
        href={hero.href}
        data-agent-id="hero-banner-cta"
        data-banner={hero.variant}
        onClick={() => emitStoreEvent("banner_clicked", { variant: hero.variant })}
        className={`mt-5 inline-block border px-4 py-2 text-[11px] tracking-[0.18em] uppercase ${
          layout.heroVariant === "editorial" ? "border-[#141414]" : "border-white/70"
        }`}
      >
        {hero.cta}
      </Link>
    </section>
  )
}
