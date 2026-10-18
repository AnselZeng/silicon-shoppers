"use client"

import { cn } from "@/lib/utils"

/** The one close control every dismissible ad uses. */
export function AdClose({ onClose, className, light = true }: { onClose: () => void; className?: string; light?: boolean }) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClose}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm leading-none",
        light ? "border-[#141414]/30 text-[#141414] hover:bg-[#141414]/5" : "border-white/40 text-white hover:bg-white/10",
        className,
      )}
    >
      ✕
    </button>
  )
}
