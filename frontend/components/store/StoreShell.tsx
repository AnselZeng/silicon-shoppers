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
import { isParentPayload, postSimMessage, readEnvelope } from "@/lib/sim/protocol"
import { emitStoreEvent, resetEmitDedupe, takeScrollMark } from "@/lib/store/emit"
import { useStorefront } from "@/lib/store/storeState"

function publishReady() {
  if (typeof window === "undefined" || window.parent === window) return
  postSimMessage(window.parent, { type: "store_ready" })
}

let layoutMotion: Promise<void> | null = null
let queuedLayout: (() => void) | null = null
let activeTransition: ViewTransition | null = null
let motionEpoch = 0

function isSkippedTransition(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

/** Animates a layout swap. A second swap waits, so the first one is not aborted mid-flight. */
function applyWithMotion(apply: () => void, immediate = false) {
  if (immediate) {
    motionEpoch += 1
    queuedLayout = null
    activeTransition?.skipTransition()
    activeTransition = null
    layoutMotion = null
    apply()
    return
  }
  const start = document.startViewTransition?.bind(document)
  if (!start) {
    apply()
    return
  }
  if (layoutMotion) {
    queuedLayout = apply
    return
  }
  const epoch = motionEpoch
  const transition = start(apply)
  activeTransition = transition
  transition.ready.catch((error: unknown) => {
    if (!isSkippedTransition(error)) console.error(error)
  })
  layoutMotion = transition.finished.then(
    () => undefined,
    (error: unknown) => {
      if (!isSkippedTransition(error)) console.error(error)
    },
  ).then(() => {
    if (epoch !== motionEpoch) return
    layoutMotion = null
    activeTransition = null
    const next = queuedLayout
    queuedLayout = null
    if (next) applyWithMotion(next)
  })
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
        resetEmitDedupe()
        useStorefront.getState().resetStorefront()
        routerRef.current.push("/store")
        window.setTimeout(publishReady, 140)
        return
      }
      if (payload.type === "set_layout") {
        applyWithMotion(
          () => useStorefront.getState().setLayout(payload.layout, { model: payload.model, presetName: payload.presetName }),
          payload.immediate === true,
        )
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
