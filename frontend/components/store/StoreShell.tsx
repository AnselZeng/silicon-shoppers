"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef } from "react"
import { UI_CONFIG } from "@/config/ui"
import { BagDrawer } from "@/components/store/BagDrawer"
import { ClientOnly } from "@/components/store/ClientOnly"
import { Concierge } from "@/components/store/Concierge"
import { GhostCursor } from "@/components/store/GhostCursor"
import { Header } from "@/components/store/Header"
import { Hero } from "@/components/store/Hero"
import { LayoutToast } from "@/components/store/LayoutToast"
import { Popup } from "@/components/store/Popup"
import { PromoStrip } from "@/components/store/PromoStrip"
import { QuickView } from "@/components/store/QuickView"
import { VisaCheckout } from "@/components/store/VisaCheckout"
import { WishlistDrawer } from "@/components/store/WishlistDrawer"
import { isParentPayload, postSimMessage, readEnvelope, type AgentAction } from "@/lib/sim/protocol"
import { findAgentElement, readPageState, setNativeValue, sleep } from "@/lib/store/dom"
import { initPersonalization } from "@/lib/model/personalize"
import { emitStoreEvent, resetEmitDedupe, takeScrollMark } from "@/lib/store/emit"
import { useStorefront } from "@/lib/store/storeState"

function publishPage() {
  if (typeof window === "undefined" || window.parent === window) return
  postSimMessage(window.parent, { type: "page_state", state: readPageState() })
}

function publishReady() {
  if (typeof window === "undefined" || window.parent === window) return
  postSimMessage(window.parent, { type: "store_ready" })
}

function done(ok: boolean, error?: string) {
  if (typeof window === "undefined" || window.parent === window) return
  postSimMessage(window.parent, { type: "action_done", ok, error })
}

async function waitForHref(before: string) {
  const start = performance.now()
  while (performance.now() - start < 1600) {
    if (`${location.pathname}${location.search}` !== before) {
      await sleep(100)
      return
    }
    await sleep(30)
  }
}

async function waitForAgent(agentId: string, timeoutMs: number) {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    if (findAgentElement(agentId)) {
      await sleep(60)
      return
    }
    await sleep(40)
  }
}

async function moveTo(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  const speed = Math.max(useStorefront.getState().cursorSpeed, 0.5)
  useStorefront.getState().setCursor({
    x: rect.left + rect.width / 2,
    y: rect.top + Math.min(rect.height / 2, 30),
    visible: true,
    outlineId: el.dataset.agentId ?? null,
  })
  await sleep(UI_CONFIG.cursorBaseMs / speed)
}

async function execute(action: AgentAction, router: { push: (href: string) => void }) {
  if (action.type === "wait") {
    await sleep(action.ms)
    return
  }
  if (action.type === "navigate") {
    const before = `${location.pathname}${location.search}`
    router.push(action.href)
    await waitForHref(before)
    return
  }
  if (action.type === "scrollTo") {
    const max = document.documentElement.scrollHeight - window.innerHeight
    const top = (Math.min(100, Math.max(0, action.percent)) / 100) * Math.max(0, max)
    window.scrollTo({ top, behavior: "auto" })
    window.dispatchEvent(new Event("scroll"))
    await sleep(40)
    return
  }
  if (action.type === "type") {
    const el = findAgentElement(action.agentId)
    if (!(el instanceof HTMLInputElement)) throw new Error(`missing ${action.agentId}`)
    await moveTo(el)
    setNativeValue(el, action.text)
    if (action.agentId === "search-input") {
      emitStoreEvent("search_performed", { q: action.text })
      const before = `${location.pathname}${location.search}`
      router.push(`/store/search?q=${encodeURIComponent(action.text)}`)
      await waitForHref(before)
    }
    return
  }
  const el = findAgentElement(action.agentId)
  if (!el) throw new Error(`missing ${action.agentId}`)
  await moveTo(el)
  if (action.type === "hover") return
  useStorefront.getState().setCursor({ clicking: true })
  const before = `${location.pathname}${location.search}`
  el.click()
  await sleep(40)
  useStorefront.getState().setCursor({ clicking: false })
  const navigates =
    action.agentId.startsWith("nav-") ||
    action.agentId.startsWith("product-card-") ||
    action.agentId === "hero-banner-cta" ||
    action.agentId.startsWith("collection-tile-")
  if (navigates || `${location.pathname}${location.search}` !== before) {
    await waitForHref(before)
    if (action.agentId.startsWith("product-card-")) await waitForAgent("add-to-bag", 1200)
  } else {
    await sleep(180)
  }
}

export function StoreShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const routerRef = useRef(router)
  useEffect(() => {
    routerRef.current = router
  }, [router])
  const layout = useStorefront((state) => state.layout)
  const showElementIds = useStorefront((state) => state.showElementIds)
  const browseSort = useStorefront((state) => state.browseSort)
  const browseFilters = useStorefront((state) => state.browseFilters)
  const popupOpen = useStorefront((state) => state.popupOpen)
  const popupDismissed = useStorefront((state) => state.popupDismissed)
  const sessionNonce = useStorefront((state) => state.sessionNonce)
  const checkoutPhase = useStorefront((state) => state.checkoutPhase)

  useEffect(() => {
    initPersonalization()
  }, [])

  useEffect(() => {
    emitStoreEvent("page_view", { path: pathname })
    const timer = window.setTimeout(publishPage, 90)
    return () => window.clearTimeout(timer)
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
        window.setTimeout(() => {
          publishReady()
          publishPage()
        }, 140)
        return
      }
      if (payload.type === "set_layout") {
        useStorefront.getState().setLayout(payload.layout, payload.presetName ?? null)
        window.setTimeout(publishPage, 180)
        return
      }
      if (payload.type === "cursor_config") {
        useStorefront.getState().setCursor({ color: payload.color, visible: window.parent !== window })
        useStorefront.getState().setCursorSpeed(payload.speed)
        return
      }
      if (payload.type === "set_debug") {
        useStorefront.getState().setShowElementIds(payload.showElementIds)
        return
      }
      void (async () => {
        try {
          await execute(payload.action, routerRef.current)
          await sleep(200)
          publishPage()
          done(true)
        } catch (error) {
          publishPage()
          done(false, error instanceof Error ? error.message : "action failed")
        }
      })()
    }
    window.addEventListener("message", onMessage)
    publishReady()
    publishPage()
    return () => window.removeEventListener("message", onMessage)
  }, [])

  const popupState = !layout.popupEnabled ? "off" : popupOpen ? "open" : "closed"

  return (
    <div className={`storefront min-h-screen bg-[#f6f3ee] text-[#141414] ${showElementIds ? "show-agent-ids" : ""}`}>
      <div
        data-agent-id="page-meta"
        data-sort={browseSort}
        data-filters={browseFilters}
        data-popup={popupState}
        data-checkout={checkoutPhase}
        className="pointer-events-none fixed top-0 left-0 z-[60] h-px w-px opacity-0"
      />
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
        <GhostCursor />
        <LayoutToast />
      </ClientOnly>
    </div>
  )
}
