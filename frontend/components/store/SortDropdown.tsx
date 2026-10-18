"use client"

import { useState } from "react"
import { SORT_LABEL, SORT_OPTIONS, type SortOption } from "@/lib/personas/schema"

export function SortDropdown({
  sort,
  onSort,
}: {
  sort: SortOption
  onSort: (sort: SortOption) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="border border-[#d9d3c8] bg-white px-3 py-2 text-[11px] tracking-[0.14em] uppercase"
      >
        Sort · {SORT_LABEL[sort]}
      </button>
      {open ? (
        <ul className="absolute right-0 z-20 mt-1 min-w-48 border border-[#d9d3c8] bg-white shadow-sm">
          {SORT_OPTIONS.map((option) => (
            <li key={option}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onSort(option)
                }}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-[#f6f3ee] ${
                  option === sort ? "font-medium" : ""
                }`}
              >
                {SORT_LABEL[option]}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
