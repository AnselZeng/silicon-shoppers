"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { LayoutFlash } from "@/components/store/LayoutFlash"
import { NAV_LABEL, navHref } from "@/lib/layout/links"
import { emitStoreEvent } from "@/lib/store/emit"
import { useStorefront } from "@/lib/store/storeState"
import { cn } from "@/lib/utils"

function navClass(highlight: boolean, sale: boolean): string {
  if (!highlight) return "hover:opacity-60"
  return cn(
    "font-semibold underline decoration-2 underline-offset-[6px] hover:opacity-60",
    sale && "text-[#9f2d2d]",
  )
}

export function Header() {
  const pathname = usePathname()
  const router = useRouter()
  const layout = useStorefront((state) => state.layout)
  const bagCount = useStorefront((state) => state.bag.reduce((sum, line) => sum + line.qty, 0))
  const wishCount = useStorefront((state) => state.wishlist.length)
  const openBag = useStorefront((state) => state.setBagOpen)
  const openWish = useStorefront((state) => state.setWishlistOpen)
  const [draft, setDraft] = useState("")
  const isPdp = pathname.startsWith("/store/product/")
  const links = layout.nav.order.map((id) => ({
    id,
    href: navHref(layout, id),
    label: NAV_LABEL[id],
    className: navClass(layout.nav.highlight === id, id === "sale"),
  }))

  function submitSearch(value: string) {
    const q = value.trim()
    if (!q) return
    emitStoreEvent("search_performed", { q })
    router.push(`/store/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[#e4dfd6] bg-[#f6f3ee]/95 backdrop-blur">
      <div className="flex items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6 sm:py-4">
        {isPdp ? (
          <button
            type="button"
            onClick={() => router.back()}
            className="text-[11px] tracking-[0.18em] uppercase"
          >
            Back
          </button>
        ) : null}
        <Link
          href="/store"
          className="shrink-0 font-serif text-[13px] tracking-[0.22em] uppercase sm:text-[15px] sm:tracking-[0.28em]"
        >
          Atelier Nine
        </Link>
        <nav className="relative hidden items-center gap-5 text-[11px] tracking-[0.18em] uppercase sm:flex">
          <LayoutFlash name="nav" className="-inset-x-3 -inset-y-2" tag="below" />
          {links.map((link) => (
            <Link key={link.id} href={link.href} className={link.className} style={{ viewTransitionName: `nav-${link.id}` }}>
              {link.label}
            </Link>
          ))}
        </nav>
        <form
          className="ml-auto min-w-0 flex-1 sm:flex-none"
          onSubmit={(event) => {
            event.preventDefault()
            submitSearch(draft)
          }}
        >
          <input
            value={draft}
            placeholder="Search"
            onChange={(event) => setDraft(event.target.value)}
            suppressHydrationWarning
            className={cn(
              "h-9 w-full border border-[#d9d3c8] bg-white px-3 text-sm outline-none sm:w-36",
              layout.nav.searchEmphasized && "sm:w-64 sm:ring-2 sm:ring-[#141414]",
            )}
          />
        </form>
        <button
          type="button"
          onClick={() => openWish(true)}
          className="shrink-0 text-[10px] tracking-[0.14em] uppercase sm:text-[11px] sm:tracking-[0.16em]"
        >
          Wishlist {wishCount > 0 ? `(${wishCount})` : ""}
        </button>
        <button
          type="button"
          onClick={() => openBag(true)}
          className="shrink-0 text-[10px] tracking-[0.14em] uppercase sm:text-[11px] sm:tracking-[0.16em]"
        >
          Bag {bagCount > 0 ? `(${bagCount})` : ""}
        </button>
      </div>
      <nav className="flex gap-4 overflow-x-auto px-4 pb-3 text-[10px] tracking-[0.16em] uppercase sm:hidden">
        {links.map((link) => (
          <Link key={`m-${link.id}`} href={link.href} className={cn("shrink-0", link.className)}>
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}
