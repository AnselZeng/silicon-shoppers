"use client"

import { create } from "zustand"
import { PERSONA_ACCENTS } from "@/config/ui"
import { DEFAULT_LAYOUT, cloneLayout } from "@/lib/layout/presets"
import type { LayoutConfig } from "@/lib/layout/types"
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

export interface CursorState {
  x: number
  y: number
  visible: boolean
  clicking: boolean
  outlineId: string | null
  color: string
}

export type CheckoutPhase = "idle" | "session" | "paid"

interface StorefrontState {
  layout: LayoutConfig
  layoutPresetName: string | null
  layoutToast: string | null
  cursor: CursorState
  cursorSpeed: number
  bag: BagLine[]
  wishlist: WishlistItem[]
  popupOpen: boolean
  popupDismissed: boolean
  showElementIds: boolean
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
  browseSort: string
  browseFilters: string
  sessionNonce: number
  setLayout: (layout: LayoutConfig, presetName?: string | null) => void
  dismissToast: () => void
  setCursor: (patch: Partial<CursorState>) => void
  setCursorSpeed: (speed: number) => void
  setPopupOpen: (open: boolean) => void
  dismissPopup: () => void
  setShowElementIds: (show: boolean) => void
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
  setBrowse: (sort: string, filters: string) => void
  resetStorefront: () => void
}

const initialCursor = (): CursorState => ({
  x: 80,
  y: 80,
  visible: false,
  clicking: false,
  outlineId: null,
  color: PERSONA_ACCENTS.price_hunter,
})

let lineSeq = 1

export const useStorefront = create<StorefrontState>((set) => ({
  layout: cloneLayout(DEFAULT_LAYOUT),
  layoutPresetName: null,
  layoutToast: null,
  cursor: initialCursor(),
  cursorSpeed: 1,
  bag: [],
  wishlist: [],
  popupOpen: false,
  popupDismissed: false,
  showElementIds: false,
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
  browseSort: "relevance",
  browseFilters: "",
  sessionNonce: 0,
  setLayout: (layout, presetName) =>
    set({
      layout: cloneLayout(layout),
      layoutPresetName: presetName ?? null,
      layoutToast: presetName ? `Layout personalized for: ${presetName}` : null,
      popupOpen: false,
      popupDismissed: !layout.popupEnabled,
    }),
  dismissToast: () => set({ layoutToast: null }),
  setCursor: (patch) => set((state) => ({ cursor: { ...state.cursor, ...patch } })),
  setCursorSpeed: (speed) => set({ cursorSpeed: speed }),
  setPopupOpen: (open) => set({ popupOpen: open }),
  dismissPopup: () => set({ popupOpen: false, popupDismissed: true }),
  setShowElementIds: (show) => set({ showElementIds: show }),
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
  setBrowse: (sort, filters) => set({ browseSort: sort, browseFilters: filters }),
  resetStorefront: () =>
    set((state) => ({
      layout: cloneLayout(DEFAULT_LAYOUT),
      layoutPresetName: null,
      layoutToast: null,
      cursor: initialCursor(),
      cursorSpeed: 1,
      bag: [],
      wishlist: [],
      popupOpen: false,
      popupDismissed: false,
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
      browseSort: "relevance",
      browseFilters: "",
      sessionNonce: state.sessionNonce + 1,
    })),
}))

export function bagSubtotal(lines: BagLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0)
}
