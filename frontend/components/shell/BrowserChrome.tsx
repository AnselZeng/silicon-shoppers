"use client"

import { useSimStore } from "@/lib/state/simStore"

export function BrowserChrome() {
  const route = useSimStore((state) => state.route)
  return (
    <div className="flex h-8 items-center gap-2 border-b border-black/10 bg-[#eceae6] px-3 text-[11px] text-neutral-600">
      <span className="size-2 rounded-full bg-[#d0cdc6]" />
      <span className="size-2 rounded-full bg-[#d0cdc6]" />
      <span className="size-2 rounded-full bg-[#d0cdc6]" />
      <span className="ml-2 truncate">atelier-nine.shop{route === "/store" ? "" : route.replace("/store", "")}</span>
    </div>
  )
}
