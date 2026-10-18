import { getAd, type AdId, type HouseAd } from "@/lib/ads/catalog"
import type { AdSlotId } from "@/lib/ads/types"
import type { AdPlacement, LayoutConfig } from "@/lib/layout/types"

export function placementFor(layout: LayoutConfig, slot: AdSlotId): AdPlacement | undefined {
  return layout.ads.placements.find((placement) => placement.slot === slot)
}

/** The ad as shown: catalog copy with the layout's overrides applied. */
export function adContent(layout: LayoutConfig, id: AdId): HouseAd {
  const ad = getAd(id)
  const override = layout.copy.adOverrides?.[id]
  return {
    ...ad,
    headline: override?.headline ?? ad.headline,
    cta: override?.cta ?? ad.cta,
  }
}

export function capKey(slot: AdSlotId, id: AdId): string {
  return `${slot}:${id}`
}

export function intrusiveCount(layout: LayoutConfig): number {
  return layout.ads.placements.filter((p) => p.slot === "popup" || p.slot === "interstitial" || p.slot === "sticky_footer").length
}
