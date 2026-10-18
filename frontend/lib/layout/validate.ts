import type { z } from "zod"
import { getAd, isAdId, type AdId } from "@/lib/ads/catalog"
import {
  INTRUSIVE_DROP_ORDER,
  MAX_INTRUSIVE,
  SLOT_MAX_ADS,
  TRIGGER_DEFAULTS,
  TRIGGER_RANGE,
  isIntrusiveSlot,
  type AdSlotId,
} from "@/lib/ads/types"
import { cleanCopy } from "@/lib/layout/copy"
import {
  COLOR_HIGHLIGHT_MAX,
  COPY_LIMITS,
  FOR_YOU_MAX,
  HOME_BLOCKS_MAX,
  HOME_BLOCKS_MIN,
  MODEL_SECTIONS,
  NAV_ITEMS_MIN,
  TILES_MAX,
  TILES_MIN,
  type ModelSection,
  type NavItemId,
} from "@/lib/layout/enums"
import { cloneLayout, DEFAULT_LAYOUT } from "@/lib/layout/presets"
import {
  AdIdSchema,
  AdOverrideSchema,
  AdPlacementSchema,
  CategorySchema,
  FILTER_SECTION_IDS,
  FilterSectionSchema,
  HomeBlockSchema,
  LayoutConfigSchema,
  LayoutReasonSchema,
  NavItemSchema,
  StoreColorSchema,
  type AdPlacement,
  type HomeBlock,
  type LayoutConfig,
} from "@/lib/layout/schema"
import { looksLikeV1, migrateV1 } from "@/lib/layout/v1"
import { modelLayout } from "@/lib/model/adapter"
import type { ModelContext } from "@/lib/model/homepage"
import {
  groundedNumbers,
  heroAdFor,
  modelCategoryOrder,
  modelHeroAd,
  modelReason,
  modelSectionOrder,
  newsletterAllowed,
} from "@/lib/model/policy"
import { getProduct, PRODUCTS } from "@/lib/store/catalog"
import { CATEGORIES, type Category, type Department } from "@/lib/store/types"

/**
 * One validator for every layout source (default, model layout, LLM, cached files).
 * Parses, fixes small problems in place and reports each fix. If the config can't be
 * parsed it falls back to the model layout, or to the house default with no model output.
 */

export interface ValidateContext {
  model?: ModelContext | null
}

export interface ValidationReport {
  changes: string[]
  fellBack: boolean
  error?: string
}

export interface ValidationResult {
  layout: LayoutConfig
  report: ValidationReport
}

type Rec = Record<string, unknown>

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function uniq<T>(xs: T[]): T[] {
  return xs.filter((x, i) => xs.indexOf(x) === i)
}

function sameList<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

// ---------- salvage: drop invalid list items before the structural parse ----------

function filterList(parent: unknown, key: string, schema: z.ZodType, label: string, changes: string[]) {
  if (!isRec(parent) || !Array.isArray(parent[key])) return
  const list = parent[key] as unknown[]
  const kept = list.filter((item) => schema.safeParse(item).success)
  if (kept.length !== list.length) changes.push(`${label}: dropped ${list.length - kept.length} invalid item(s)`)
  parent[key] = kept
}

function salvage(raw: unknown, changes: string[]): unknown {
  if (looksLikeV1(raw)) {
    changes.push("migrated a v1 config to v2")
    return migrateV1(raw)
  }
  if (!isRec(raw)) return raw
  const obj = JSON.parse(JSON.stringify(raw)) as Rec
  if (obj.version === undefined) obj.version = 2
  const nav = obj.nav
  filterList(nav, "order", NavItemSchema, "nav.order", changes)
  if (isRec(nav) && nav.highlight !== null && !NavItemSchema.safeParse(nav.highlight).success) {
    nav.highlight = null
    changes.push("nav.highlight: unknown item, cleared")
  }
  const home = obj.home
  if (isRec(home)) {
    home.forYouIds ??= []
    home.basketIds ??= []
  }
  filterList(home, "blocks", HomeBlockSchema, "home.blocks", changes)
  const listing = obj.listing
  if (isRec(listing)) listing.categoryOrder ??= [...CATEGORIES]
  filterList(listing, "filterOrder", FilterSectionSchema, "listing.filterOrder", changes)
  filterList(listing, "expandedFilters", FilterSectionSchema, "listing.expandedFilters", changes)
  filterList(listing, "colorHighlight", StoreColorSchema, "listing.colorHighlight", changes)
  filterList(listing, "categoryOrder", CategorySchema, "listing.categoryOrder", changes)
  if (isRec(listing)) filterList(listing.card, "badges", FilterBadge, "listing.card.badges", changes)
  const ads = obj.ads
  if (isRec(ads) && Array.isArray(ads.placements)) {
    for (const placement of ads.placements) filterList(placement, "adIds", AdIdSchema, "ads.placements.adIds", changes)
  }
  filterList(ads, "placements", AdPlacementSchema, "ads.placements", changes)
  const copy = obj.copy
  if (isRec(copy) && isRec(copy.adOverrides)) {
    for (const [key, value] of Object.entries(copy.adOverrides)) {
      if (!isAdId(key) || !AdOverrideSchema.safeParse(value).success) {
        delete copy.adOverrides[key]
        changes.push(`copy.adOverrides: dropped "${key}"`)
      }
    }
  }
  filterList(obj, "reasons", LayoutReasonSchema, "reasons", changes)
  return obj
}

const FilterBadge = LayoutConfigSchema.shape.listing.shape.card.shape.badges.element

// ---------- fixes ----------

const NAV_FALLBACK: NavItemId[] = ["women", "men", "new_in", "sale", "collections", "for_you"]

function departmentCategories(department: Department | null): Set<Category> {
  return new Set(PRODUCTS.filter((p) => !department || p.department === department).map((p) => p.category))
}

function sourceKey(block: HomeBlock): string | null {
  return block.type === "product_row" ? JSON.stringify(block.source) : null
}

function modelSectionOf(block: HomeBlock): ModelSection | null {
  if (block.type !== "product_row") return null
  const kind = block.source.kind
  return (MODEL_SECTIONS as readonly string[]).includes(kind) ? (kind as ModelSection) : null
}

function sectionRow(section: ModelSection): HomeBlock {
  return { type: "product_row", source: { kind: section }, limit: 4 }
}

function fixData(cfg: LayoutConfig, ctx: ValidateContext, changes: string[]) {
  const home = cfg.home
  const basket = uniq(home.basketIds).filter((id) => getProduct(id))
  if (!sameList(basket, home.basketIds)) changes.push("home.basketIds: removed unknown or repeated ids")
  home.basketIds = basket
  const inBasket = new Set(basket)
  const forYou = uniq(home.forYouIds)
    .filter((id) => getProduct(id) && !inBasket.has(id))
    .slice(0, FOR_YOU_MAX)
  if (!sameList(forYou, home.forYouIds)) changes.push("home.forYouIds: removed unknown, repeated or basket ids")
  home.forYouIds = forYou

  const order = ctx.model ? modelCategoryOrder(ctx.model.doc) : uniq([...cfg.listing.categoryOrder, ...CATEGORIES])
  if (!sameList(order, cfg.listing.categoryOrder)) {
    if (ctx.model) changes.push("listing.categoryOrder: set to the model's category_order")
    cfg.listing.categoryOrder = order
  }
}

function fixNav(cfg: LayoutConfig, changes: string[]) {
  const nav = cfg.nav
  const before = [...nav.order]
  let order = uniq(nav.order)
  if (cfg.home.forYouIds.length === 0) order = order.filter((id) => id !== "for_you")
  if (!order.includes("women") && !order.includes("men")) order.unshift(nav.department ?? "women")
  for (const id of NAV_FALLBACK) {
    if (order.length >= NAV_ITEMS_MIN) break
    if (order.includes(id) || (id === "for_you" && cfg.home.forYouIds.length === 0)) continue
    order.push(id)
  }
  if (!sameList(order, before)) changes.push(`nav.order: ${before.join(",")} -> ${order.join(",")}`)
  nav.order = order
  if (nav.highlight && !order.includes(nav.highlight)) {
    changes.push("nav.highlight: not in nav.order, cleared")
    nav.highlight = null
  }
}

function fixListing(cfg: LayoutConfig, changes: string[]) {
  const listing = cfg.listing
  const filters = uniq([...listing.filterOrder, ...FILTER_SECTION_IDS])
  if (!sameList(filters, listing.filterOrder)) changes.push("listing.filterOrder: added missing sections")
  listing.filterOrder = filters
  listing.expandedFilters = uniq(listing.expandedFilters)
  const colors = uniq(listing.colorHighlight).slice(0, COLOR_HIGHLIGHT_MAX)
  if (!sameList(colors, listing.colorHighlight)) changes.push(`listing.colorHighlight: kept ${colors.length}`)
  listing.colorHighlight = colors
  listing.card.badges = uniq(listing.card.badges)
}

function fixCopy(cfg: LayoutConfig, changes: string[]) {
  const copy = cfg.copy
  for (const key of ["intro", "story"] as const) {
    const value = copy[key]
    if (value === undefined) continue
    const clean = cleanCopy(value, COPY_LIMITS[key])
    if (clean !== value) changes.push(`copy.${key}: ${clean ? "cleaned" : "removed"}`)
    if (clean) copy[key] = clean
    else delete copy[key]
  }
  if (!copy.adOverrides) return
  for (const id of Object.keys(copy.adOverrides) as AdId[]) {
    const override = copy.adOverrides[id]
    if (!override) continue
    for (const field of ["headline", "cta"] as const) {
      const value = override[field]
      if (value === undefined) continue
      const clean = cleanCopy(value, COPY_LIMITS[field])
      if (clean !== value) changes.push(`copy.adOverrides.${id}.${field}: ${clean ? "cleaned" : "removed"}`)
      if (clean) override[field] = clean
      else delete override[field]
    }
    if (!override.headline && !override.cta) delete copy.adOverrides[id]
  }
}

function fixTrigger(placement: AdPlacement, changes: string[]) {
  const slot = placement.slot
  if (!isIntrusiveSlot(slot)) {
    if (placement.trigger !== undefined || placement.triggerValue !== undefined) {
      changes.push(`ads.${slot}: trigger only applies to intrusive slots, removed`)
    }
    delete placement.trigger
    delete placement.triggerValue
    return
  }
  const defaults = TRIGGER_DEFAULTS[slot as keyof typeof TRIGGER_DEFAULTS]
  if (!placement.trigger) {
    placement.trigger = defaults.trigger
    placement.triggerValue = defaults.triggerValue
    changes.push(`ads.${slot}: no trigger, used ${defaults.trigger}`)
  }
  if (slot === "interstitial" && placement.trigger !== "page_count" && placement.trigger !== "on_load") {
    changes.push(`ads.interstitial: shows between pages, trigger ${placement.trigger} -> page_count`)
    placement.trigger = "page_count"
    placement.triggerValue = 1
  }
  if (placement.trigger === "on_load" || placement.trigger === "exit_intent") {
    delete placement.triggerValue
    return
  }
  const [min, max] = TRIGGER_RANGE[placement.trigger]
  const fallback = placement.trigger === defaults.trigger ? defaults.triggerValue ?? min : min
  const value = placement.triggerValue ?? fallback
  const clamped = Math.min(max, Math.max(min, Math.round(value)))
  if (clamped !== placement.triggerValue) changes.push(`ads.${slot}: triggerValue set to ${clamped}`)
  placement.triggerValue = clamped
}

function fixAds(cfg: LayoutConfig, ctx: ValidateContext, changes: string[]) {
  const allowNewsletter = newsletterAllowed(ctx.model?.doc)
  const seen = new Set<AdSlotId>()
  const out: AdPlacement[] = []
  for (const placement of cfg.ads.placements) {
    const slot = placement.slot
    if (seen.has(slot)) {
      changes.push(`ads.${slot}: more than one placement, kept the first`)
      continue
    }
    let ids = uniq(placement.adIds)
    const fits = ids.filter((id) => getAd(id).slots.includes(slot))
    if (fits.length !== ids.length) changes.push(`ads.${slot}: removed ads that don't fit the slot`)
    ids = fits
    if (!allowNewsletter && ids.includes("newsletter")) {
      changes.push("ads: newsletter removed, the model's popups decision is off")
      ids = ids.filter((id) => id !== "newsletter")
    }
    if (ids.length > SLOT_MAX_ADS[slot]) {
      changes.push(`ads.${slot}: kept ${SLOT_MAX_ADS[slot]} of ${ids.length} ads`)
      ids = ids.slice(0, SLOT_MAX_ADS[slot])
    }
    if (ids.length === 0) {
      changes.push(`ads.${slot}: no usable ads, placement removed`)
      continue
    }
    const next: AdPlacement = { ...placement, adIds: ids }
    fixTrigger(next, changes)
    if (slot === "grid_tile") next.gridPosition = Math.max(2, Math.round(next.gridPosition ?? 4))
    else delete next.gridPosition
    seen.add(slot)
    out.push(next)
  }
  for (const slot of INTRUSIVE_DROP_ORDER) {
    if (out.filter((p) => isIntrusiveSlot(p.slot)).length <= MAX_INTRUSIVE) break
    const index = out.findIndex((p) => p.slot === slot)
    if (index >= 0) {
      out.splice(index, 1)
      changes.push(`ads.${slot}: dropped, at most ${MAX_INTRUSIVE} intrusive placements`)
    }
  }
  cfg.ads.placements = out
}

function fixTiles(categories: Category[], cfg: LayoutConfig, available: Set<Category>): Category[] {
  const order = cfg.listing.categoryOrder
  let tiles = uniq(categories).filter((c) => available.has(c))
  for (const c of order) {
    if (tiles.length >= TILES_MIN) break
    if (available.has(c) && !tiles.includes(c)) tiles.push(c)
  }
  tiles = [...tiles].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return tiles.slice(0, TILES_MAX)
}

function fixHome(cfg: LayoutConfig, ctx: ValidateContext, changes: string[]) {
  const home = cfg.home
  const department = cfg.nav.department
  const available = departmentCategories(department)
  const sources = new Set<string>()
  let blocks: HomeBlock[] = []
  for (const block of home.blocks) {
    if (block.type === "hero") {
      if (blocks.some((b) => b.type === "hero")) {
        changes.push("home.blocks: second hero removed")
        continue
      }
    }
    if (block.type === "product_row") {
      const key = sourceKey(block) ?? ""
      const kind = block.source.kind
      if (sources.has(key)) {
        changes.push(`home.blocks: repeated ${kind} row removed`)
        continue
      }
      if (kind === "buy_again" && home.basketIds.length === 0) {
        changes.push("home.blocks: buy_again row removed, the basket is empty")
        continue
      }
      if (kind === "for_you" && home.forYouIds.length === 0) {
        changes.push("home.blocks: for_you row removed, no ranked products")
        continue
      }
      if (block.source.kind === "category" && !available.has(block.source.category)) {
        changes.push(`home.blocks: ${block.source.category} row removed, none in ${department}`)
        continue
      }
      sources.add(key)
      if (block.title !== undefined) {
        const title = cleanCopy(block.title, COPY_LIMITS.rowTitle)
        if (title !== block.title) changes.push(`home.blocks: ${kind} title ${title ? "cleaned" : "removed"}`)
        block.title = title || undefined
        if (!title) delete block.title
      }
    }
    if (block.type === "editorial_text" && !cfg.copy[block.copyKey]) {
      changes.push(`home.blocks: editorial_text removed, copy.${block.copyKey} is empty`)
      continue
    }
    if (block.type === "ad_banner" && !getAd(block.adId).slots.includes("listing_banner")) {
      changes.push(`home.blocks: ad_banner ${block.adId} removed, it isn't a banner ad`)
      continue
    }
    if (block.type === "category_tiles") {
      const tiles = fixTiles(block.categories, cfg, available)
      if (!sameList(tiles, block.categories)) changes.push("home.blocks: category tiles set to the category order")
      blocks.push({ ...block, categories: tiles })
      continue
    }
    blocks.push(block)
  }

  const heroIndex = blocks.findIndex((b) => b.type === "hero")
  if (heroIndex > 0) {
    const [hero] = blocks.splice(heroIndex, 1)
    if (hero) blocks.unshift(hero)
    changes.push("home.blocks: hero moved to the top")
  }

  if (blocks.length < HOME_BLOCKS_MIN) {
    const sections = ctx.model ? modelSectionOrder(ctx.model.doc) : (["new_in", "bestsellers", "sale"] as ModelSection[])
    const candidates: HomeBlock[] = [
      ...sections.filter((s) => s !== "buy_again" || home.basketIds.length > 0).map(sectionRow),
      ...(home.forYouIds.length > 0 ? [{ type: "product_row", source: { kind: "for_you" }, limit: 8 } as HomeBlock] : []),
    ]
    for (const block of candidates) {
      if (blocks.length >= HOME_BLOCKS_MIN) break
      const key = sourceKey(block)
      if (key && sources.has(key)) continue
      if (key) sources.add(key)
      blocks.push(block)
      changes.push(`home.blocks: fewer than ${HOME_BLOCKS_MIN} blocks, added a row`)
    }
  }
  if (blocks.length > HOME_BLOCKS_MAX) {
    changes.push(`home.blocks: kept the first ${HOME_BLOCKS_MAX} blocks`)
    blocks = blocks.slice(0, HOME_BLOCKS_MAX)
  }

  if (ctx.model) {
    const order = modelSectionOrder(ctx.model.doc)
    const slots = blocks.map((b, i) => (modelSectionOf(b) ? i : -1)).filter((i) => i >= 0)
    const rows = slots.map((i) => blocks[i] as HomeBlock)
    const rank = (b: HomeBlock) => {
      const index = order.indexOf(modelSectionOf(b) as ModelSection)
      return index < 0 ? order.length : index
    }
    const sorted = [...rows].sort((a, b) => rank(a) - rank(b))
    if (sorted.some((b, i) => b !== rows[i])) {
      changes.push("home.blocks: model rows put back in the model's section_order")
      slots.forEach((slot, i) => {
        blocks[slot] = sorted[i] as HomeBlock
      })
    }
  }
  home.blocks = blocks

  const hasHero = blocks[0]?.type === "hero"
  const heroPlacement = cfg.ads.placements.find((p) => p.slot === "hero")
  if (hasHero && !heroPlacement) {
    const adId = ctx.model ? modelHeroAd(ctx.model.doc, department) : heroAdFor("editorial", department)
    cfg.ads.placements.push({ slot: "hero", adIds: [adId] })
    changes.push(`ads.hero: hero block had no ad, used ${adId}`)
  }
  if (!hasHero && heroPlacement) {
    cfg.ads.placements = cfg.ads.placements.filter((p) => p.slot !== "hero")
    changes.push("ads.hero: removed, there is no hero block")
  }
}

const NUMBER = /\d+(?:\.\d+)?/g

function fixReasons(cfg: LayoutConfig, ctx: ValidateContext, changes: string[]) {
  const doc = ctx.model?.doc
  const grounded = doc ? groundedNumbers(doc) : new Set<string>()
  const seen = new Set<string>()
  const out: LayoutConfig["reasons"] = []
  for (const reason of cfg.reasons) {
    if (seen.has(reason.field)) {
      changes.push(`reasons: second reason for ${reason.field} removed`)
      continue
    }
    if (reason.source === "model") {
      if (!doc || !reason.modelDecision) {
        changes.push(`reasons: model reason for ${reason.field} removed, no model decision to cite`)
        continue
      }
      const model = modelReason(doc, reason.modelDecision)
      out.push({ ...reason, text: model.text, class: model.class })
    } else {
      // Reasons may quote model figures; every number is checked against the model output below.
      const text = cleanCopy(reason.text, COPY_LIMITS.reason, { keepFigures: true })
      const numbers = reason.text.match(NUMBER) ?? []
      if (!text || numbers.some((n) => !grounded.has(n))) {
        changes.push(`reasons: LLM reason for ${reason.field} removed, ${text ? "it cites a number not in the model output" : "empty"}`)
        continue
      }
      const next = { ...reason, text }
      delete next.modelDecision
      out.push(next)
    }
    seen.add(reason.field)
  }
  cfg.reasons = out
}

/** Apply every rule to a structurally valid config. Mutates and returns it. */
export function fixLayout(cfg: LayoutConfig, ctx: ValidateContext = {}, changes: string[] = []): LayoutConfig {
  fixData(cfg, ctx, changes)
  fixNav(cfg, changes)
  fixListing(cfg, changes)
  fixCopy(cfg, changes)
  fixAds(cfg, ctx, changes)
  fixHome(cfg, ctx, changes)
  fixAds(cfg, ctx, [])
  fixReasons(cfg, ctx, changes)
  return cfg
}

export function fallbackLayout(ctx: ValidateContext = {}): LayoutConfig {
  const base = ctx.model ? modelLayout(ctx.model.doc, ctx.model.basketIds) : cloneLayout(DEFAULT_LAYOUT)
  return fixLayout(base, ctx)
}

export function validateLayout(raw: unknown, ctx: ValidateContext = {}): ValidationResult {
  const changes: string[] = []
  const parsed = LayoutConfigSchema.safeParse(salvage(raw, changes))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const error = issue ? `${issue.path.join(".") || "config"}: ${issue.message}` : "invalid config"
    return { layout: fallbackLayout(ctx), report: { changes: [], fellBack: true, error } }
  }
  const layout = fixLayout(parsed.data, ctx, changes)
  return { layout, report: { changes, fellBack: false } }
}
