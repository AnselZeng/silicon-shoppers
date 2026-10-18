import { blockName } from "@/lib/layout/home"
import type { HomeBlock, LayoutConfig } from "@/lib/layout/types"

/**
 * One visible stage of a layout swap. `flash` maps a view-transition name to the tag drawn on it.
 * `focus` is where the store scrolls before playing the stage: the page top, the view-transition
 * name of the block now sitting where the first change lands, or null to stay put.
 */
export interface LayoutStep {
  label: string
  layout: LayoutConfig
  flash: Record<string, string>
  focus: "top" | string | null
}

/** Home blocks are placed in at most this many passes, so long pages don't stretch the sequence. */
const BLOCK_PASSES = 3

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

function blockTag(block: HomeBlock, index: number, before: HomeBlock[]): string | null {
  const name = blockName(block)
  const prev = before.findIndex((item) => blockName(item) === name)
  if (prev === -1) return "New"
  if (prev > index) return "Moved up"
  if (prev < index) return "Moved down"
  return same(before[prev], block) ? null : "Updated"
}

/** The block currently at the first position that changes; the last block when only appending. */
function firstChange(before: HomeBlock[], after: HomeBlock[]): string | null {
  const index = after.findIndex((block, i) => !before[i] || !same(before[i], block))
  const end = index === -1 ? (before.length > after.length ? after.length : -1) : index
  if (end === -1) return null
  const anchor = before[Math.min(end, before.length - 1)]
  return anchor ? blockName(anchor) : null
}

/**
 * Splits a swap from `from` to `to` into stages the audience can follow: nav, then
 * hero and ads, then home blocks in a few passes, then listing, cards and checkout.
 * Stages that change nothing are dropped. The last stage is always `to` itself.
 * Intermediate layouts mix validated parts of both configs and skip the validator.
 */
export function layoutSteps(from: LayoutConfig, to: LayoutConfig): LayoutStep[] {
  const steps: LayoutStep[] = []
  let current = from
  const push = (label: string, layout: LayoutConfig, flash: Record<string, string>, focus: LayoutStep["focus"]) => {
    if (same(current, layout)) return
    steps.push({ label, layout, flash, focus })
    current = layout
  }

  push(`nav · ${to.nav.order.join(" ")}`, { ...current, nav: to.nav }, { nav: "Reordered" }, "top")

  push(
    "hero and ads",
    { ...current, ads: to.ads, copy: to.copy, home: { ...current.home, heroSize: to.home.heroSize } },
    { hero: "New hero" },
    "top",
  )

  const target = to.home.blocks
  const home = { ...current.home, forYouIds: to.home.forYouIds, basketIds: to.home.basketIds }
  const passSize = Math.max(1, Math.ceil(Math.max(target.length - 1, 1) / BLOCK_PASSES))
  for (let end = 1 + passSize; ; end += passSize) {
    const last = end >= target.length
    const placed = target.slice(0, Math.min(end, target.length))
    const names = new Set(placed.map(blockName))
    const blocks = last ? target : [...placed, ...current.home.blocks.filter((block) => !names.has(blockName(block)))]
    const before = current.home.blocks
    const flash: Record<string, string> = {}
    blocks.forEach((block, index) => {
      const tag = blockTag(block, index, before)
      if (tag && names.has(blockName(block))) flash[blockName(block)] = tag
    })
    const changed = Object.entries(flash).map(([name, tag]) => `${name} ${tag.toLowerCase()}`)
    const label = changed.length > 0 ? `home · ${changed.join(", ")}` : "home · products re-ranked"
    push(label, { ...current, home: { ...home, blocks } }, flash, firstChange(before, blocks))
    if (last) break
  }

  push(
    `listing · ${to.listing.defaultSort} · filters lead with ${to.listing.filterOrder[0] ?? "category"}`,
    to,
    same(current.listing, to.listing) ? {} : { hero: "Sort & filters" },
    "top",
  )

  if (steps.length > 0) steps[steps.length - 1] = { ...steps[steps.length - 1], layout: to }
  return steps
}
