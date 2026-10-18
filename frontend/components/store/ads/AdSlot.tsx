"use client"

import { useRouter } from "next/navigation"
import { AdBanner } from "@/components/store/ads/AdBanner"
import { Hero } from "@/components/store/Hero"
import { Popup } from "@/components/store/Popup"
import { PromoStrip } from "@/components/store/PromoStrip"
import { adContent, capKey, placementFor } from "@/lib/ads/placement"
import type { AdSlotId } from "@/lib/ads/types"
import type { InlineAdSlot } from "@/lib/layout/steps"
import { useAdShown } from "@/lib/ads/useAdShown"
import { useRotation } from "@/lib/ads/useRotation"
import { emitStoreEvent } from "@/lib/store/emit"
import { useStorefront } from "@/lib/store/storeState"

/**
 * Looks up the layout's placement for a slot and renders the slot's fixed format.
 * No placement, no ad. grid_tile is drawn by ProductGrid; the intrusive slots by IntrusiveAds.
 */
export function AdSlot({ slot, compact = false }: { slot: Exclude<AdSlotId, "grid_tile">; compact?: boolean }) {
  const layout = useStorefront((state) => state.layout)
  const placement = placementFor(layout, slot)
  const ids = placement?.adIds ?? []
  const [index, setIndex] = useRotation(ids.length, `${slot}:${ids.join(",")}`)
  const id = ids[index]
  const ad = id ? adContent(layout, id) : null
  useAdShown(slot, slot === "popup" ? undefined : id, ad?.kind)
  if (!ad) return null
  switch (slot) {
    case "top_strip":
      return (
        <InlineSlot slot={slot}>
          <PromoStrip ad={ad} />
        </InlineSlot>
      )
    case "hero":
      return (
        <InlineSlot slot={slot}>
          <Hero
            ad={ad}
            compact={compact || layout.home.heroSize === "compact"}
            count={ids.length}
            index={index}
            onPick={setIndex}
          />
        </InlineSlot>
      )
    case "listing_banner":
      return (
        <InlineSlot slot={slot}>
          <AdBanner ad={ad} slot="listing_banner" className="mb-6" />
        </InlineSlot>
      )
    case "popup":
      return <PopupSlot />
    default:
      return null
  }
}

/** Names the slot for view transitions, so a layout step can play the ad-replace animation on it. */
function InlineSlot({ slot, children }: { slot: InlineAdSlot; children: React.ReactNode }) {
  return (
    <div data-ad-slot={slot} style={{ viewTransitionName: `adslot-${slot}` }}>
      {children}
    </div>
  )
}

function PopupSlot() {
  const router = useRouter()
  const layout = useStorefront((state) => state.layout)
  const open = useStorefront((state) => state.popupOpen)
  const dismiss = useStorefront((state) => state.dismissPopup)
  const markAd = useStorefront((state) => state.markAd)
  const id = placementFor(layout, "popup")?.adIds[0]
  if (!id) return null
  const ad = adContent(layout, id)
  return (
    <Popup
      ad={ad}
      open={open}
      onClose={(clicked) => {
        emitStoreEvent(clicked ? "ad_clicked" : "ad_dismissed", { slot: "popup", adId: ad.id, kind: ad.kind })
        markAd(capKey("popup", ad.id), "dismissed")
        dismiss()
        if (clicked && ad.kind !== "newsletter") router.push(ad.href)
      }}
    />
  )
}
