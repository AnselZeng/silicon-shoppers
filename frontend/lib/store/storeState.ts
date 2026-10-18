"use client"

import { create } from "zustand"
import { DEFAULT_LAYOUT, cloneLayout } from "@/lib/layout/presets"
import type { LayoutConfig } from "@/lib/layout/types"
import { validateLayout, type ValidationReport } from "@/lib/layout/validate"
import type { ModelContext } from "@/lib/model/homepage"
import type { MockCapture, MockSession } from "@/lib/visa/mock"

export interface BagLine {
  lineId: string
  productId: string
  name: string
  color: string
  size: string
  unitPrice: number
  qty: number
}

export interface WishlistItem {
  productId: string
  name: string
  price: number
  color: string
}

export type CheckoutPhase = "idle" | "session" | "paid"

interface StorefrontState {
  layout: LayoutConfig
  layoutPresetName: string | null
  layoutToast: string | null
  layoutReport: ValidationReport | null
  /**
   * Boxes on what a layout step is changing, keyed by view-transition name. Shown before the
   * change and kept through it; `leaving` fades them out.
   */
  layoutFlash: { names: Record<string, string>; leaving: boolean }
  /** Ads already shown or dismissed this session, keyed "slot:adId". Survives setLayout; cleared on reset. */
  adCaps: Record<string, "shown" | "dismissed">
  /** Page views this session (page_count trigger). */
  pagesViewed: number
  /** Listing <-> product page moves this session (interstitial trigger). */
  transitions: number
  lastPath: string | null
  interstitialOpen: boolean
  stickyFooterOpen: boolean
  bag: BagLine[]
  wishlist: WishlistItem[]
  popupOpen: boolean
  quickViewId: string | null
  bagOpen: boolean
  wishlistOpen: boolean
  checkoutPhase: CheckoutPhase
  visaSession: MockSession | null
  order: MockCapture | null
  conciergeOpen: boolean
  conciergeAnswer: string | null
  selectedColor: Record<string, string>
  selectedSize: Record<string, string>
  sessionNonce: number
  setLayout: (raw: unknown, options?: { model?: ModelContext | null; presetName?: string | null }) => void
  /** Shows one already-validated stage of a layout swap. The final stage also records the report and toast. */
  showLayoutStep: (layout: LayoutConfig, final?: { report: ValidationReport; presetName: string | null }) => void
  setLayoutFlash: (names: Record<string, string>) => void
  fadeLayoutFlash: () => void
  markAd: (key: string, state: "shown" | "dismissed") => void
  notePage: (path: string) => void
  setInterstitialOpen: (open: boolean) => void
  setStickyFooterOpen: (open: boolean) => void
  dismissToast: () => void
  setPopupOpen: (open: boolean) => void
  dismissPopup: () => void
  setQuickViewId: (id: string | null) => void
  setBagOpen: (open: boolean) => void
  setWishlistOpen: (open: boolean) => void
  addToBag: (line: Omit<BagLine, "lineId" | "qty"> & { qty?: number }) => void
  addWishlist: (item: WishlistItem) => void
  setCheckoutPhase: (phase: CheckoutPhase) => void
  setVisaSession: (session: MockSession | null) => void
  setOrder: (order: MockCapture | null) => void
  setConciergeOpen: (open: boolean) => void
  setConciergeAnswer: (answer: string | null) => void
  selectColor: (productId: string, color: string) => void
  selectSize: (productId: string, size: string) => void
  resetStorefront: () => void
}

let lineSeq = 1

const NO_FLASH = { names: {}, leaving: false }

function isProductPath(path: string): boolean {
  return path.startsWith("/store/product/")
}

const LISTING_PATHS = ["/store/women", "/store/men", "/store/new-in", "/store/sale", "/store/search", "/store/for-you"]

function isListingPath(path: string): boolean {
  return LISTING_PATHS.includes(path)
}

export const useStorefront = create<StorefrontState>((set) => ({
  layout: cloneLayout(DEFAULT_LAYOUT),
  layoutPresetName: null,
  layoutToast: null,
  layoutReport: null,
  layoutFlash: NO_FLASH,
  adCaps: {},
  pagesViewed: 0,
  transitions: 0,
  lastPath: null,
  interstitialOpen: false,
  stickyFooterOpen: false,
  bag: [],
  wishlist: [],
  popupOpen: false,
  quickViewId: null,
  bagOpen: false,
  wishlistOpen: false,
  checkoutPhase: "idle",
  visaSession: null,
  order: null,
  conciergeOpen: false,
  conciergeAnswer: null,
  selectedColor: {},
  selectedSize: {},
  sessionNonce: 0,
  setLayout: (raw, options = {}) => {
    const { layout, report } = validateLayout(raw, { model: options.model })
    const presetName = options.presetName ?? null
    set({
      layout,
      layoutReport: report,
      layoutPresetName: presetName,
      layoutToast: presetName ? `Layout personalized for: ${presetName}` : null,
      layoutFlash: NO_FLASH,
    })
  },
  showLayoutStep: (layout, final) =>
    set({
      layout,
      ...(final
        ? {
            layoutReport: final.report,
            layoutPresetName: final.presetName,
            layoutToast: final.presetName ? `Layout personalized for: ${final.presetName}` : null,
          }
        : {}),
    }),
  setLayoutFlash: (names) => set({ layoutFlash: { names, leaving: false } }),
  fadeLayoutFlash: () => set((current) => ({ layoutFlash: { ...current.layoutFlash, leaving: true } })),
  markAd: (key, state) => set((current) => ({ adCaps: { ...current.adCaps, [key]: state } })),
  notePage: (path) =>
    set((current) => {
      if (current.lastPath === path) return current
      const prev = current.lastPath
      const moved =
        prev !== null && ((isListingPath(prev) && isProductPath(path)) || (isProductPath(prev) && isListingPath(path)))
      return {
        lastPath: path,
        pagesViewed: current.pagesViewed + 1,
        transitions: current.transitions + (moved ? 1 : 0),
      }
    }),
  setInterstitialOpen: (open) => set({ interstitialOpen: open }),
  setStickyFooterOpen: (open) => set({ stickyFooterOpen: open }),
  dismissToast: () => set({ layoutToast: null }),
  setPopupOpen: (open) => set({ popupOpen: open }),
  dismissPopup: () => set({ popupOpen: false }),
  setQuickViewId: (id) => set({ quickViewId: id }),
  setBagOpen: (open) => set({ bagOpen: open }),
  setWishlistOpen: (open) => set({ wishlistOpen: open }),
  addToBag: (line) =>
    set((state) => {
      const existing = state.bag.find(
        (item) =>
          item.productId === line.productId && item.color === line.color && item.size === line.size,
      )
      if (existing) {
        return {
          bag: state.bag.map((item) =>
            item.lineId === existing.lineId ? { ...item, qty: item.qty + (line.qty ?? 1) } : item,
          ),
          bagOpen: true,
        }
      }
      lineSeq += 1
      return {
        bag: [
          ...state.bag,
          {
            lineId: `line-${lineSeq}`,
            productId: line.productId,
            name: line.name,
            color: line.color,
            size: line.size,
            unitPrice: line.unitPrice,
            qty: line.qty ?? 1,
          },
        ],
        bagOpen: true,
      }
    }),
  addWishlist: (item) =>
    set((state) => {
      if (state.wishlist.some((entry) => entry.productId === item.productId)) return state
      return { wishlist: [...state.wishlist, item], wishlistOpen: true }
    }),
  setCheckoutPhase: (phase) => set({ checkoutPhase: phase }),
  setVisaSession: (session) => set({ visaSession: session }),
  setOrder: (order) => set({ order }),
  setConciergeOpen: (open) => set({ conciergeOpen: open }),
  setConciergeAnswer: (answer) => set({ conciergeAnswer: answer }),
  selectColor: (productId, color) =>
    set((state) => ({ selectedColor: { ...state.selectedColor, [productId]: color } })),
  selectSize: (productId, size) =>
    set((state) => ({ selectedSize: { ...state.selectedSize, [productId]: size } })),
  resetStorefront: () =>
    set((state) => ({
      layout: cloneLayout(DEFAULT_LAYOUT),
      layoutPresetName: null,
      layoutToast: null,
      layoutReport: null,
      layoutFlash: NO_FLASH,
      adCaps: {},
      pagesViewed: 0,
      transitions: 0,
      lastPath: null,
      interstitialOpen: false,
      stickyFooterOpen: false,
      bag: [],
      wishlist: [],
      popupOpen: false,
      quickViewId: null,
      bagOpen: false,
      wishlistOpen: false,
      checkoutPhase: "idle",
      visaSession: null,
      order: null,
      conciergeOpen: false,
      conciergeAnswer: null,
      selectedColor: {},
      selectedSize: {},
      sessionNonce: state.sessionNonce + 1,
    })),
}))

export function bagSubtotal(lines: BagLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0)
}
