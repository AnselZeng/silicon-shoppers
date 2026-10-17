"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { emitStoreEvent } from "@/lib/store/emit"
import { useStorefront } from "@/lib/store/storeState"
import { cn } from "@/lib/utils"

const LINKS = [
  { id: "nav-women", href: "/store/women", label: "Women" },
  { id: "nav-men", href: "/store/men", label: "Men" },
  { id: "nav-new-in", href: "/store/new-in", label: "New in" },
  { id: "nav-sale", href: "/store/sale", label: "Sale" },
  { id: "nav-collections", href: "/store/women", label: "Collections" },
] as const

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
            data-agent-id="nav-back"
            onClick={() => router.back()}
            className="text-[11px] tracking-[0.18em] uppercase"
          >
            Back
          </button>
        ) : (
          <button
            type="button"
            data-agent-id="nav-back"
            aria-label="Back"
            onClick={() => router.back()}
            className="fixed top-0 left-0 h-2 w-2 opacity-0"
          />
        )}
        <Link
          href="/store"
          data-agent-id="nav-home"
          className="shrink-0 font-serif text-[13px] tracking-[0.22em] uppercase sm:text-[15px] sm:tracking-[0.28em]"
        >
          Atelier Nine
        </Link>
        <nav className="hidden items-center gap-5 text-[11px] tracking-[0.18em] uppercase sm:flex">
          {LINKS.map((link) => (
            <Link key={link.id} href={link.href} data-agent-id={link.id} className="hover:opacity-60">
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
            data-agent-id="search-input"
            value={draft}
            placeholder="Search"
            onChange={(event) => setDraft(event.target.value)}
            className={cn(
              "h-9 w-full border border-[#d9d3c8] bg-white px-3 text-sm outline-none sm:w-36",
              layout.searchEmphasized && "sm:w-64 sm:ring-2 sm:ring-[#141414]",
            )}
          />
        </form>
        <button
          type="button"
          data-agent-id="wishlist-icon"
          data-count={String(wishCount)}
          onClick={() => openWish(true)}
          className="shrink-0 text-[10px] tracking-[0.14em] uppercase sm:text-[11px] sm:tracking-[0.16em]"
        >
          Wishlist {wishCount > 0 ? `(${wishCount})` : ""}
        </button>
        <button
          type="button"
          data-agent-id="bag-icon"
          data-count={String(bagCount)}
          onClick={() => openBag(true)}
          className="shrink-0 text-[10px] tracking-[0.14em] uppercase sm:text-[11px] sm:tracking-[0.16em]"
        >
          Bag {bagCount > 0 ? `(${bagCount})` : ""}
        </button>
      </div>
      <nav className="flex gap-4 overflow-x-auto px-4 pb-3 text-[10px] tracking-[0.16em] uppercase sm:hidden">
        {LINKS.map((link) => (
          <Link key={`m-${link.id}`} href={link.href} data-agent-id={link.id} className="shrink-0 hover:opacity-60">
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}
