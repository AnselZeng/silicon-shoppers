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

/**
 * Where grid tiles go in a listing of `cards` cards: before card gridPosition, the second
 * tile 6 cards later. Positions are clamped to 2..(cards - 1); fewer than 3 cards, no tiles.
 */
export function tilePositions(cards: number, placement: AdPlacement | undefined): number[] {
  if (!placement || cards < 3) return []
  const clamp = (n: number) => Math.min(cards - 1, Math.max(2, n))
  const first = clamp(placement.gridPosition ?? 4)
  const positions = placement.adIds.map((_, i) => clamp(first + i * 6))
  return positions.filter((p, i) => positions.indexOf(p) === i)
}
