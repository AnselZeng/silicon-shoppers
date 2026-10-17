"use client"

import { useEffect } from "react"
import { useStorefront } from "@/lib/store/storeState"

export function LayoutToast() {
  const toast = useStorefront((state) => state.layoutToast)
  const dismiss = useStorefront((state) => state.dismissToast)
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => dismiss(), 3600)
    return () => window.clearTimeout(timer)
  }, [toast, dismiss])
  if (!toast) return null
  return (
    <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 border border-[#141414] bg-[#f6f3ee] px-4 py-2 text-[11px] tracking-[0.14em] uppercase shadow-md">
      {toast}
    </div>
  )
}
