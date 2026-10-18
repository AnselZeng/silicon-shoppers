"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef } from "react"
import { AdSlot } from "@/components/store/ads/AdSlot"
import { IntrusiveAds } from "@/components/store/ads/IntrusiveAds"
import { BagDrawer } from "@/components/store/BagDrawer"
import { ClientOnly } from "@/components/store/ClientOnly"
import { Concierge } from "@/components/store/Concierge"
import { Header } from "@/components/store/Header"
import { LayoutToast } from "@/components/store/LayoutToast"
import { QuickView } from "@/components/store/QuickView"
import { VisaCheckout } from "@/components/store/VisaCheckout"
import { WishlistDrawer } from "@/components/store/WishlistDrawer"
import { initPersonalization } from "@/lib/model/personalize"
import { isParentPayload, postSimMessage, readEnvelope, type StorePayload } from "@/lib/sim/protocol"
import { applyLayoutNow, cancelLayoutMotion, playLayout } from "@/lib/store/layoutMotion"
import { emitStoreEvent, resetEmitDedupe, takeScrollMark } from "@/lib/store/emit"
import { useStorefront } from "@/lib/store/storeState"

function postToShell(payload: StorePayload) {
  if (typeof window === "undefined" || window.parent === window) return
  postSimMessage(window.parent, payload)
}

function publishReady() {
  postToShell({ type: "store_ready" })
}

export function StoreShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const routerRef = useRef(router)

  useEffect(() => {
    routerRef.current = router
  }, [router])

  useEffect(() => {
    initPersonalization()
  }, [])

  useEffect(() => {
    emitStoreEvent("page_view", { path: pathname })
    useStorefront.getState().notePage(pathname)
  }, [pathname])

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      const pct = max <= 8 ? 100 : (window.scrollY / max) * 100
      for (const mark of [25, 50, 75, 100]) {
        if (pct >= mark && takeScrollMark(mark)) {
          emitStoreEvent("scroll_depth", { percent: mark })
        }
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const parsed = readEnvelope(event.data)
      if (!parsed || !isParentPayload(parsed.payload)) return
      const payload = parsed.payload
      if (payload.type === "reset") {
        cancelLayoutMotion()
        resetEmitDedupe()
        useStorefront.getState().resetStorefront()
        routerRef.current.push("/store")
        window.setTimeout(publishReady, 140)
        return
      }
      if (payload.type === "set_layout") {
        const options = { model: payload.model, presetName: payload.presetName }
        if (payload.immediate === true) {
          applyLayoutNow(payload.layout, options)
          return
        }
        playLayout(payload.layout, options, {
          onStep: (index, total, label) => postToShell({ type: "layout_step", index, total, label }),
          onSettled: () => postToShell({ type: "layout_settled" }),
        })
      }
    }
    window.addEventListener("message", onMessage)
    publishReady()
    return () => window.removeEventListener("message", onMessage)
  }, [])

  return (
    <div className="storefront min-h-screen bg-[#f6f3ee] text-[#141414]">
      <AdSlot slot="top_strip" />
      <Header />
      <main>{children}</main>
      <ClientOnly>
        <AdSlot slot="popup" />
        <IntrusiveAds />
        <QuickView />
        <BagDrawer />
        <WishlistDrawer />
        <VisaCheckout />
        <Concierge />
        <LayoutToast />
      </ClientOnly>
    </div>
  )
}
