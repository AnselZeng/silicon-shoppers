"use client"

import { useSimStore, type ViewportChoice } from "@/lib/state/simStore"

function shopUrl(route: string): string {
  if (route === "/store" || route === "") return "atelier-nine.shop"
  const path = route.replace(/^\/store/, "")
  return `atelier-nine.shop${path}`
}

export function BrowserChrome({ mode }: { mode: ViewportChoice }) {
  const route = useSimStore((state) => state.route)
  const url = shopUrl(route)

  if (mode === "mobile" || mode === "tablet") {
    return (
      <div className="shrink-0 bg-[#f4f1ea] text-[#1a1a1a]">
        <div className="flex h-8 items-center justify-between px-5 text-[11px] font-medium">
          <span>9:41</span>
          <span className="flex items-center gap-1 text-[10px] tracking-tight">
            <span aria-hidden>●●●</span>
            <span aria-hidden>5G</span>
            <span aria-hidden className="inline-block h-2.5 w-5 rounded-[2px] border border-current p-px">
              <span className="block h-full w-3/4 bg-current" />
            </span>
          </span>
        </div>
        <div className="px-3 pb-2">
          <div className="flex h-8 items-center justify-center gap-1.5 rounded-full bg-white px-3 text-[12px] text-neutral-700 shadow-sm ring-1 ring-black/5">
            <LockIcon />
            <span className="truncate">{url}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="shrink-0">
      <div className="flex h-10 items-end bg-[#dee1e6] px-3">
        <div className="mb-[11px] flex items-center gap-[6px]" aria-hidden>
          <span className="size-[11px] rounded-full bg-[#ff5f57]" />
          <span className="size-[11px] rounded-full bg-[#febc2e]" />
          <span className="size-[11px] rounded-full bg-[#28c840]" />
        </div>
        <div className="ml-3 flex h-8 max-w-[220px] min-w-0 items-center gap-2 rounded-t-lg bg-white px-3 text-[12px] text-neutral-700">
          <span className="size-3 rounded-sm bg-[#141414]" />
          <span className="truncate">ATELIER NINE</span>
        </div>
      </div>
      <div className="flex h-11 items-center gap-2 border-b border-black/5 bg-white px-3">
        <div className="flex items-center gap-2 px-1 text-[13px] text-neutral-400" aria-hidden>
          <span>←</span>
          <span>→</span>
          <span>↻</span>
        </div>
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full bg-[#f1f3f4] px-3 text-[12px] text-neutral-800">
          <LockIcon />
          <span className="truncate">{url}</span>
        </div>
      </div>
    </div>
  )
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0 text-neutral-500">
      <rect x="2.2" y="5" width="7.6" height="5.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4 5 V3.6 a2 2 0 0 1 4 0 V5" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}
