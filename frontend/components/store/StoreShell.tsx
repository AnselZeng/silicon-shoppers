"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
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
import { hasLiveLayout, initPersonalization } from "@/lib/model/personalize"
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

const HISTORY_KEY = "atelier_frame_history"

type FrameHistory = { entries: string[]; index: number }

function framePath(pathname: string, search: string): string {
  return search ? `${pathname}?${search}` : pathname
}

function readFrameHistory(path: string): FrameHistory {
  const fresh = { entries: [path], index: 0 }
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
  if (nav?.type !== "reload") return fresh
  try {
    const saved = JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? "") as FrameHistory
    if (Array.isArray(saved.entries) && saved.entries[saved.index] === path) return saved
  } catch {
    /* a new visit starts at this page */
  }
  return fresh
}

export function StoreShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  const path = framePath(pathname, search)
  const router = useRouter()
  const routerRef = useRef(router)
  const historyRef = useRef<FrameHistory>({ entries: [], index: 0 })
  const popped = useRef(false)
  /** Set before router.back/forward. Next updates the path without a popstate we can rely on. */
  const move = useRef<"back" | "forward" | null>(null)

  useEffect(() => {
    routerRef.current = router
  }, [router])

  useEffect(() => {
    initPersonalization()
  }, [])

  useEffect(() => {
    const onPop = () => {
      popped.current = true
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  useEffect(() => {
    emitStoreEvent("page_view", { path })
    useStorefront.getState().notePage(pathname)
    const hist = historyRef.current
    const goingBack = move.current === "back" || (popped.current && path === hist.entries[hist.index - 1])
    const goingForward = move.current === "forward" || (popped.current && path === hist.entries[hist.index + 1])
    if (hist.entries.length === 0) {
      historyRef.current = readFrameHistory(path)
    } else if (goingBack && path === hist.entries[hist.index - 1]) {
      hist.index -= 1
    } else if (goingForward && path === hist.entries[hist.index + 1]) {
      hist.index += 1
    } else if (hist.entries[hist.index] !== path) {
      const entries = hist.entries.slice(0, hist.index + 1)
      entries.push(path)
      hist.entries = entries
      hist.index = entries.length - 1
    }
    popped.current = false
    move.current = null
    const current = historyRef.current
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(current))
    } catch {
      /* private mode: the arrows still work until a reload */
    }
    postToShell({
      type: "history_state",
      canBack: current.index > 0,
      canForward: current.index < current.entries.length - 1,
      path,
    })
  }, [path, pathname])

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
      if (payload.type === "history") {
        if (payload.action === "reload") {
          window.location.reload()
          return
        }
        const hist = historyRef.current
        if (payload.action === "back" && hist.index > 0) {
          move.current = "back"
          routerRef.current.back()
        }
        if (payload.action === "forward" && hist.index < hist.entries.length - 1) {
          move.current = "forward"
          routerRef.current.forward()
        }
        return
      }
      if (payload.type === "set_layout") {
        if (payload.automatic && hasLiveLayout()) return
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
