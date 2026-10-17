"use client"

import { useStorefront } from "@/lib/store/storeState"

export function PromoStrip() {
  const variant = useStorefront((state) => state.layout.heroVariant)
  const copy =
    variant === "discount_banner"
      ? "Private sale — up to 40% off selected pieces"
      : variant === "new_drop_banner"
        ? "New drop — the Winter Puffer is in"
        : variant === "collection_banner"
          ? "Essentials — the pieces that stay"
          : "Complimentary shipping over $150"
  return (
    <div
      data-agent-id="promo-strip"
      className="bg-[#141414] px-6 py-2 text-center text-[10px] tracking-[0.22em] text-[#f6f3ee] uppercase"
    >
      {copy}
    </div>
  )
}
