"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef } from "react"
import { UI_CONFIG } from "@/config/ui"
import { BagDrawer } from "@/components/store/BagDrawer"
import { ClientOnly } from "@/components/store/ClientOnly"
import { Concierge } from "@/components/store/Concierge"
import { Header } from "@/components/store/Header"
import { Hero } from "@/components/store/Hero"
import { LayoutToast } from "@/components/store/LayoutToast"
import { Popup } from "@/components/store/Popup"
import { PromoStrip } from "@/components/store/PromoStrip"
import { QuickView } from "@/components/store/QuickView"
import { VisaCheckout } from "@/components/store/VisaCheckout"
import { WishlistDrawer } from "@/components/store/WishlistDrawer"
import { isParentPayload, postSimMessage, readEnvelope } from "@/lib/sim/protocol"
import { emitStoreEvent, resetEmitDedupe, takeScrollMark } from "@/lib/store/emit"
import { useStorefront } from "@/lib/store/storeState"

function publishReady() {
  if (typeof window === "undefined" || window.parent === window) return
  postSimMessage(window.parent, { type: "store_ready" })
}

export function StoreShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const routerRef = useRef(router)
  const layout = useStorefront((state) => state.layout)
  const popupDismissed = useStorefront((state) => state.popupDismissed)
  const sessionNonce = useStorefront((state) => state.sessionNonce)

  useEffect(() => {
    routerRef.current = router
  }, [router])

  useEffect(() => {
    emitStoreEvent("page_view", { path: pathname })
  }, [pathname])

  useEffect(() => {
    if (pathname !== "/store" || !layout.popupEnabled || popupDismissed) return
    const timer = window.setTimeout(() => {
      const state = useStorefront.getState()
      if (!state.layout.popupEnabled || state.popupDismissed) return
      state.setPopupOpen(true)
      emitStoreEvent("popup_shown", { variant: state.layout.popupVariant })
    }, UI_CONFIG.popupDelayMs)
    return () => window.clearTimeout(timer)
  }, [pathname, layout.popupEnabled, popupDismissed, sessionNonce])

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
        resetEmitDedupe()
        useStorefront.getState().resetStorefront()
        routerRef.current.push("/store")
        window.setTimeout(publishReady, 140)
        return
      }
      if (payload.type === "set_layout") {
        useStorefront.getState().setLayout(payload.layout, payload.presetName ?? null)
      }
    }
    window.addEventListener("message", onMessage)
    publishReady()
    return () => window.removeEventListener("message", onMessage)
  }, [])

  return (
    <div className="storefront min-h-screen bg-[#f6f3ee] text-[#141414]">
      <PromoStrip />
      <Header />
      {pathname === "/store" || pathname.startsWith("/store/product/") ? null : <Hero compact />}
      <main>{children}</main>
      <ClientOnly>
        <Popup />
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
