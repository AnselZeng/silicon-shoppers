"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { AdClose } from "@/components/store/ads/AdClose"
import { GarmentImage } from "@/components/store/GarmentImage"
import { adContent, capKey, placementFor } from "@/lib/ads/placement"
import { AD_KICKER, AD_TONE, PATTERN_STYLE } from "@/lib/ads/style"
import { useAdTrigger } from "@/lib/ads/useAdTrigger"
import { emitStoreEvent } from "@/lib/store/emit"
import { useStorefront } from "@/lib/store/storeState"
import { cn } from "@/lib/utils"

/** Opens the popup when its trigger fires. Once per session per ad. */
function PopupTrigger() {
  const layout = useStorefront((state) => state.layout)
  const placement = placementFor(layout, "popup")
  const id = placement?.adIds[0]
  const capped = useStorefront((state) => (id ? Boolean(state.adCaps[capKey("popup", id)]) : true))
  const fired = useAdTrigger(placement, !capped)
  useEffect(() => {
    if (!fired || !id) return
    const state = useStorefront.getState()
    if (state.adCaps[capKey("popup", id)]) return
    state.markAd(capKey("popup", id), "shown")
    state.setPopupOpen(true)
    emitStoreEvent("ad_shown", { slot: "popup", adId: id })
  }, [fired, id])
  return null
}

/** Full-screen overlay between a listing and a product page. Once per session per ad. */
function Interstitial() {
  const router = useRouter()
  const layout = useStorefront((state) => state.layout)
  const open = useStorefront((state) => state.interstitialOpen)
  const setOpen = useStorefront((state) => state.setInterstitialOpen)
  const placement = placementFor(layout, "interstitial")
  const id = placement?.adIds[0]
  const capped = useStorefront((state) => (id ? Boolean(state.adCaps[capKey("interstitial", id)]) : true))
  const fired = useAdTrigger(placement, !capped)
  useEffect(() => {
    if (!fired || !id) return
    const state = useStorefront.getState()
    if (state.adCaps[capKey("interstitial", id)]) return
    state.markAd(capKey("interstitial", id), "shown")
    state.setInterstitialOpen(true)
    emitStoreEvent("ad_shown", { slot: "interstitial", adId: id })
  }, [fired, id])
  if (!open || !id) return null
  const ad = adContent(layout, id)
  const tone = AD_TONE[ad.kind]
  const close = (clicked: boolean) => {
    emitStoreEvent(clicked ? "ad_clicked" : "ad_dismissed", { slot: "interstitial", adId: ad.id, kind: ad.kind })
    useStorefront.getState().markAd(capKey("interstitial", ad.id), "dismissed")
    setOpen(false)
    if (clicked) router.push(ad.href)
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ad.headline}
      className={cn("fixed inset-0 z-[65] flex flex-col items-center justify-center gap-6 px-8 text-center", tone.className)}
      style={ad.visual === "pattern" ? PATTERN_STYLE : undefined}
    >
      <AdClose onClose={() => close(false)} light={tone.light} className="absolute top-5 right-5" />
      <p className="text-[10px] tracking-[0.28em] uppercase opacity-70">{AD_KICKER[ad.kind]}</p>
      {ad.visual === "garment" && ad.garment ? (
        <GarmentImage type={ad.garment} color={tone.light ? "black" : "cream"} className="h-56 w-44" />
      ) : null}
      <h2 className="max-w-2xl font-serif text-5xl tracking-tight">{ad.headline}</h2>
      {ad.body ? <p className="max-w-md text-sm opacity-80">{ad.body}</p> : null}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => close(true)}
          className={cn("border px-5 py-2 text-[11px] tracking-[0.18em] uppercase", tone.light ? "border-[#141414]" : "border-white/70")}
        >
          {ad.cta}
        </button>
        <button type="button" onClick={() => close(false)} className="px-5 py-2 text-[11px] tracking-[0.18em] uppercase opacity-70">
          Continue
        </button>
      </div>
    </div>
  )
}

/** Fixed bar at the bottom of every page. Stays closed once dismissed this session. */
function StickyFooter() {
  const layout = useStorefront((state) => state.layout)
  const placement = placementFor(layout, "sticky_footer")
  const id = placement?.adIds[0]
  const dismissed = useStorefront((state) => (id ? state.adCaps[capKey("sticky_footer", id)] === "dismissed" : true))
  const fired = useAdTrigger(placement, !dismissed)
  const visible = fired && !dismissed && id !== undefined
  useEffect(() => {
    useStorefront.getState().setStickyFooterOpen(visible)
    if (visible && id) emitStoreEvent("ad_shown", { slot: "sticky_footer", adId: id })
  }, [visible, id])
  if (!visible || !id) return null
  const ad = adContent(layout, id)
  const tone = AD_TONE[ad.kind]
  const dismiss = () => {
    emitStoreEvent("ad_dismissed", { slot: "sticky_footer", adId: ad.id, kind: ad.kind })
    useStorefront.getState().markAd(capKey("sticky_footer", ad.id), "dismissed")
  }
  return (
    <div
      className={cn("fixed inset-x-0 bottom-0 z-50 flex items-center gap-4 px-6 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.12)]", tone.className)}
      style={ad.visual === "pattern" ? PATTERN_STYLE : undefined}
    >
      <p className="min-w-0 flex-1 truncate text-sm">
        <span className="font-serif text-lg">{ad.headline}</span>
        {ad.body ? <span className="ml-3 hidden opacity-80 md:inline">{ad.body}</span> : null}
      </p>
      <Link
        href={ad.href}
        onClick={() => emitStoreEvent("ad_clicked", { slot: "sticky_footer", adId: ad.id, kind: ad.kind })}
        className={cn("shrink-0 border px-4 py-1.5 text-[11px] tracking-[0.18em] uppercase", tone.light ? "border-[#141414]" : "border-white/70")}
      >
        {ad.cta}
      </Link>
      <AdClose onClose={dismiss} light={tone.light} />
    </div>
  )
}

/** The intrusive slots: popup trigger, interstitial and sticky footer. */
export function IntrusiveAds() {
  return (
    <>
      <PopupTrigger />
      <Interstitial />
      <StickyFooter />
    </>
  )
}
