import type { AdKind } from "@/lib/ads/types"

/** Fixed look per ad kind, inside the house palette. */

export const AD_KICKER: Record<AdKind, string> = {
  sale: "Private sale",
  new_drop: "Just landed",
  collection: "Autumn / Winter",
  category: "The edit",
  newsletter: "SoCal Atelier",
  shipping: "SoCal Atelier",
  loyalty: "SoCal points",
}

export const AD_TONE: Record<AdKind, { className: string; light: boolean }> = {
  sale: { className: "bg-[#141414] text-[#f6f3ee]", light: false },
  new_drop: { className: "bg-[#6b2c3a] text-[#f6f3ee]", light: false },
  collection: { className: "bg-[#efeae2] text-[#141414]", light: true },
  category: { className: "bg-[#3d4a3a] text-[#f6f3ee]", light: false },
  newsletter: { className: "bg-[#efeae2] text-[#141414]", light: true },
  shipping: { className: "bg-[#efeae2] text-[#141414]", light: true },
  loyalty: { className: "bg-[#3d4a3a] text-[#f6f3ee]", light: false },
}

/** Diagonal stripes for "pattern" ads. */
export const PATTERN_STYLE = {
  backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.07) 0 12px, transparent 12px 24px)",
}
