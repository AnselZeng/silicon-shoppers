import { UI_CONFIG } from "@/config/ui"
import type { StoreColor } from "@/config/ui"
import { collectionSlug } from "@/lib/utils"
import type { Persona } from "@/lib/personas/schema"
import type { SortOption } from "@/lib/personas/schema"
import type { AgentAction, PageState, VisibleElement } from "@/lib/sim/protocol"
import { STORE_COLORS } from "@/config/ui"

export interface AgentMemory {
  steps: number
  consideredIds: string[]
  reviewsReadFor: string[]
  wishlistedIds: string[]
  popupHandled: boolean
  bannerClicked: boolean
  landed: boolean
  scrollTargetReached: boolean
  addedToBag: boolean
  openedBag: boolean
  startedCheckout: boolean
  paid: boolean
  askedConcierge: boolean
  searched: boolean
  sortMenuOpened: boolean
  bagWaited: boolean
  checkoutWaited: boolean
}

export interface PolicyResult {
  action: AgentAction
  reason: string
  endSession?: boolean
}

interface Candidate {
  action: AgentAction
  reason: string
  score: number
  endSession?: boolean
}

export function createMemory(): AgentMemory {
  return {
    steps: 0,
    consideredIds: [],
    reviewsReadFor: [],
    wishlistedIds: [],
    popupHandled: false,
    bannerClicked: false,
    landed: false,
    scrollTargetReached: false,
    addedToBag: false,
    openedBag: false,
    startedCheckout: false,
    paid: false,
    askedConcierge: false,
    searched: false,
    sortMenuOpened: false,
    bagWaited: false,
    checkoutWaited: false,
  }
}

function find(page: PageState, agentId: string): VisibleElement | undefined {
  return page.elements.find((element) => element.agentId === agentId)
}

function isHome(route: string): boolean {
  return route === "/store"
}

function isListing(route: string): boolean {
  return (
    route.startsWith("/store/women") ||
    route.startsWith("/store/men") ||
    route.startsWith("/store/new-in") ||
    route.startsWith("/store/sale") ||
    route.startsWith("/store/search")
  )
}

function isPdp(route: string): boolean {
  return route.startsWith("/store/product/")
}

function productIdFromCard(agentId: string): string | null {
  if (agentId.startsWith("product-card-")) return agentId.slice("product-card-".length)
  if (agentId.startsWith("quickview-btn-")) return agentId.slice("quickview-btn-".length)
  return null
}

function isColor(value: string): value is StoreColor {
  return (STORE_COLORS as readonly string[]).includes(value)
}

export function convictionScore(
  persona: Persona,
  hint: { price?: number; color?: string; isNew?: boolean; onSale?: boolean; collection?: string },
): number {
  const price = hint.price ?? persona.traits.maxBudget
  let score = 35
  const sensitivity = persona.traits.priceSensitivity / 100
  if (hint.onSale) score += 28 * sensitivity + 10
  if (price <= persona.traits.maxBudget) score += 18
  else score -= Math.min(45, (price - persona.traits.maxBudget) / 5)
  if (hint.color && isColor(hint.color) && persona.traits.colorPreference.includes(hint.color)) {
    score += 14
  }
  if (hint.isNew) score += persona.traits.noveltySeeking / 6
  if (hint.collection === "Essentials") score += persona.traits.brandCollectionLoyalty / 6
  if (price <= 60 && sensitivity > 0.6) score += 8
  return Math.max(0, Math.min(100, Math.round(score)))
}

function landingNav(persona: Persona): string {
  if (persona.traits.preferredDepartment === "men") return "nav-men"
  if (persona.traits.preferredDepartment === "women") return "nav-women"
  return persona.traits.brandCollectionLoyalty >= 70 ? "nav-women" : "nav-new-in"
}

function searchText(persona: Persona): string {
  const color = persona.traits.colorPreference[0] ?? "black"
  if (persona.traits.preferredDepartment === "men") return `${color} shirt`
  return `${color} knit`
}

interface DesiredFilter {
  key: string
  agentId: string
  sectionId: string
}

function desiredFilter(persona: Persona): DesiredFilter | null {
  const first = persona.traits.firstFilterUsed
  if (first === "none") return null
  if (first === "sale") {
    return { key: "sale", agentId: "filter-sale-toggle", sectionId: "filter-section-sale" }
  }
  if (first === "size") {
    return {
      key: `size:${persona.traits.sizePreference}`,
      agentId: `filter-size-${persona.traits.sizePreference}`,
      sectionId: "filter-section-size",
    }
  }
  if (first === "color") {
    const color = persona.traits.colorPreference[0] ?? "black"
    return {
      key: `color:${color}`,
      agentId: `filter-color-${color}`,
      sectionId: "filter-section-color",
    }
  }
  if (first === "category") {
    const category = persona.traits.preferredDepartment === "men" ? "shirts" : "knitwear"
    return {
      key: `category:${category}`,
      agentId: `filter-category-${category}`,
      sectionId: "filter-section-category",
    }
  }
  const slug = collectionSlug(UI_CONFIG.loyalistCollection)
  return {
    key: `collection:${slug}`,
    agentId: `filter-collection-${slug}`,
    sectionId: "filter-section-collection",
  }
}

function currentProduct(page: PageState): VisibleElement | undefined {
  return find(page, "pdp-root") ?? find(page, "quickview-root")
}

function sync(page: PageState, memory: AgentMemory) {
  const meta = find(page, "page-meta")
  if (meta?.popup === "off") memory.popupHandled = true
  const bagCount = Number(find(page, "bag-icon")?.count ?? "0")
  if (bagCount > 0) memory.addedToBag = true
  if (find(page, "checkout-btn")) memory.openedBag = true
  if (find(page, "visa-pay-btn")) memory.startedCheckout = true
  if (page.route.startsWith("/store/confirmation") || meta?.checkout === "paid") memory.paid = true
  if (isListing(page.route) || isPdp(page.route) || page.route.startsWith("/store/search")) {
    memory.landed = true
  }
  const seen = currentProduct(page)
  const seenId = seen?.productId
  if (seenId && !memory.consideredIds.includes(seenId)) memory.consideredIds.push(seenId)
}

function pickBest(candidates: Candidate[]): Candidate | null {
  let best: Candidate | null = null
  for (const candidate of candidates) {
    if (!best || candidate.score > best.score) best = candidate
  }
  return best
}

function stepCap(persona: Persona): number {
  return (
    20 +
    persona.traits.productsViewedBeforeDecision * 5 +
    Math.round(persona.traits.sessionPatience / 2)
  )
}

export const agentPolicy = {
  nextAction(
    page: PageState,
    persona: Persona,
    rng: { next: () => number },
    memory: AgentMemory,
  ): PolicyResult {
    sync(page, memory)
    const jitter = () => rng.next() * 8
    const candidates: Candidate[] = []
    const traits = persona.traits
    const meta = find(page, "page-meta")
    const filters = (meta?.filters ?? "").split(",").filter(Boolean)
    const currentSort = (meta?.sort ?? null) as SortOption | null
    const popupClose = find(page, "popup-close")
    const cap = stepCap(persona)

    if (memory.paid || page.route.startsWith("/store/confirmation")) {
      memory.steps += 1
      return { action: { type: "wait", ms: 80 }, reason: "payment captured, end session", endSession: true }
    }

    if (popupClose && !memory.popupHandled) {
      if (traits.popupTolerance < 50) {
        candidates.push({
          action: { type: "click", agentId: "popup-close" },
          reason: "dismiss popup — tolerance is low",
          score: 260 + jitter(),
        })
      } else if (find(page, "popup-cta")) {
        candidates.push({
          action: { type: "click", agentId: "popup-cta" },
          reason: "take the popup offer",
          score: 260 + jitter(),
        })
      }
    } else if (!memory.popupHandled && isHome(page.route) && memory.steps < 6 && meta?.popup !== "off") {
      candidates.push({
        action: { type: "wait", ms: 700 },
        reason: "wait for the homepage popup",
        score: 240 + jitter(),
      })
    }

    const checkoutVisible = Boolean(find(page, "checkout-btn"))
    const payVisible = Boolean(find(page, "visa-pay-btn"))

    if (memory.addedToBag && payVisible && !memory.paid) {
      candidates.push({
        action: { type: "click", agentId: "visa-pay-btn" },
        reason: "pay with the mock Visa button",
        score: 280 + jitter(),
      })
    } else if (memory.addedToBag && memory.startedCheckout && !payVisible) {
      candidates.push({
        action: { type: "wait", ms: 320 },
        reason: "wait for Visa checkout to paint",
        score: 250 + jitter(),
      })
    } else if (memory.addedToBag && checkoutVisible && !memory.startedCheckout) {
      candidates.push({
        action: { type: "click", agentId: "checkout-btn" },
        reason: "open checkout from the bag",
        score: 270 + jitter(),
      })
    } else if (memory.addedToBag && memory.openedBag && !checkoutVisible) {
      candidates.push({
        action: { type: "wait", ms: 320 },
        reason: "wait for the bag sheet to paint",
        score: 250 + jitter(),
      })
    } else if (memory.addedToBag && !memory.openedBag && find(page, "bag-icon")) {
      candidates.push({
        action: { type: "click", agentId: "bag-icon" },
        reason: "open the bag",
        score: 265 + jitter(),
      })
    }

    if (!memory.landed && !popupClose) {
      if (traits.usesSearch > 55 && find(page, "search-input")) {
        candidates.push({
          action: { type: "type", agentId: "search-input", text: searchText(persona) },
          reason: `search for “${searchText(persona)}”`,
          score: 210 + jitter(),
        })
      } else {
        const nav = landingNav(persona)
        if (find(page, nav)) {
          candidates.push({
            action: { type: "click", agentId: nav },
            reason: `land via ${nav}`,
            score: 210 + jitter(),
          })
        }
      }
    }

    const hero = find(page, "hero-banner-cta")
    if (hero && !memory.bannerClicked && traits.bannerClickRate >= 40 && !popupClose) {
      const variant = hero.banner ?? ""
      const matches = traits.bannerTrigger === "any" || variant === traits.bannerTrigger
      if (matches) {
        candidates.push({
          action: { type: "click", agentId: "hero-banner-cta" },
          reason: `click the ${variant || "hero"} banner`,
          score: 30 + traits.bannerClickRate * 0.35 + jitter(),
        })
      }
    }

    if (
      (isListing(page.route) || isHome(page.route)) &&
      !popupClose &&
      memory.landed &&
      !find(page, "quickview-root") &&
      !find(page, "visa-pay-btn")
    ) {
      const pref = traits.defaultSortPreference
      if (isListing(page.route) && currentSort && currentSort !== pref) {
        const optionId = `sort-option-${pref}`
        if (find(page, optionId)) {
          candidates.push({
            action: { type: "click", agentId: optionId },
            reason: `sort by ${pref}`,
            score: 200 + jitter(),
          })
        } else if (find(page, "sort-dropdown")) {
          candidates.push({
            action: { type: "click", agentId: "sort-dropdown" },
            reason: "open the sort menu",
            score: 198 + jitter(),
          })
        }
      }

      const filter = desiredFilter(persona)
      if (isListing(page.route) && filter && !filters.includes(filter.key)) {
        if (find(page, filter.agentId)) {
          candidates.push({
            action: { type: "click", agentId: filter.agentId },
            reason: `apply ${filter.key}`,
            score: 190 + jitter(),
          })
        } else if (find(page, filter.sectionId)) {
          candidates.push({
            action: { type: "click", agentId: filter.sectionId },
            reason: `expand ${filter.sectionId}`,
            score: 188 + jitter(),
          })
        } else {
          candidates.push({
            action: { type: "scrollTo", percent: Math.min(92, Math.max(page.scrollPercent + 28, 36)) },
            reason: "scroll the filter into view",
            score: 186 + jitter(),
          })
        }
      }

      const sortReady = !isListing(page.route) || !currentSort || currentSort === pref
      const filterReady = !isListing(page.route) || !filter || filters.includes(filter.key)
      if (
        isListing(page.route) &&
        sortReady &&
        filterReady &&
        !memory.scrollTargetReached &&
        memory.consideredIds.length >= 2 &&
        traits.scrollDepth >= 25
      ) {
        candidates.push({
          action: { type: "scrollTo", percent: traits.scrollDepth },
          reason: `scroll to ${traits.scrollDepth}%`,
          score: 148 + jitter(),
        })
      }

      const needMore = memory.consideredIds.length < traits.productsViewedBeforeDecision
      if (isHome(page.route) && memory.landed && needMore) {
        const nav = landingNav(persona)
        if (find(page, nav)) {
          candidates.push({
            action: { type: "click", agentId: nav },
            reason: "return to the department listing",
            score: 196 + jitter(),
          })
        }
      }

      if (sortReady && filterReady && (isListing(page.route) || isHome(page.route))) {
        const cards = page.elements.filter((element) => element.agentId.startsWith("product-card-"))
        const pool = needMore
          ? cards.filter((card) => {
              const id = card.productId ?? productIdFromCard(card.agentId)
              return id !== null && !memory.consideredIds.includes(id)
            })
          : cards
        let bestCard: VisibleElement | null = null
        let bestConviction = -1
        for (const card of pool) {
          const score = convictionScore(persona, {
            price: card.price,
            color: card.color,
            isNew: card.isNew,
            onSale: card.onSale,
            collection: card.collection,
          })
          if (score > bestConviction) {
            bestConviction = score
            bestCard = card
          }
        }
        if (bestCard && !needMore && bestConviction < traits.addToCartThreshold && page.scrollPercent > 12) {
          candidates.push({
            action: { type: "scrollTo", percent: 0 },
            reason: "scroll back to pieces that fit the budget",
            score: 208 + jitter(),
          })
        } else if (bestCard && (needMore || bestConviction >= traits.addToCartThreshold)) {
          const id = bestCard.productId ?? productIdFromCard(bestCard.agentId) ?? ""
          const quickId = `quickview-btn-${id}`
          const buyNow = !needMore
          if (needMore && traits.imageVsTextAttention > 60 && find(page, quickId)) {
            candidates.push({
              action: { type: "click", agentId: quickId },
              reason: `quick view ${bestCard.name ?? id}`,
              score: 172 + jitter(),
            })
          } else {
            candidates.push({
              action: { type: "click", agentId: bestCard.agentId },
              reason: buyNow ? `reopen ${bestCard.name ?? id} to buy` : `open ${bestCard.name ?? id}`,
              score: (buyNow ? 214 : 172) + jitter(),
            })
          }
        } else if (needMore && isListing(page.route)) {
          if (find(page, "load-more")) {
            candidates.push({
              action: { type: "click", agentId: "load-more" },
              reason: "load more products",
              score: 166 + jitter(),
            })
          }
          candidates.push({
            action: { type: "scrollTo", percent: Math.min(96, Math.max(page.scrollPercent + 30, 40)) },
            reason: "scroll to reveal more products",
            score: 164 + jitter(),
          })
        }
      }
    }

    const quickRoot = find(page, "quickview-root")
    const pdp = find(page, "pdp-root")
    const focus = quickRoot ?? pdp
    if (focus && !popupClose) {
      const productId = focus.productId ?? ""
      const conviction = convictionScore(persona, {
        price: focus.price,
        color: focus.color,
        isNew: focus.isNew,
        onSale: focus.onSale,
        collection: focus.collection,
      })
      const ready =
        memory.consideredIds.length >= traits.productsViewedBeforeDecision &&
        conviction >= traits.addToCartThreshold
      if (ready && find(page, "add-to-bag")) {
        candidates.push({
          action: { type: "click", agentId: "add-to-bag" },
          reason: `add to bag (conviction ${conviction})`,
          score: 230 + jitter(),
        })
      }
      if (
        isPdp(page.route) &&
        !find(page, "add-to-bag") &&
        memory.consideredIds.length >= traits.productsViewedBeforeDecision &&
        !memory.addedToBag
      ) {
        candidates.push({
          action:
            page.scrollPercent < 55
              ? { type: "scrollTo", percent: Math.min(70, page.scrollPercent + 24) }
              : { type: "wait", ms: 280 },
          reason: page.scrollPercent < 55 ? "scroll the add-to-bag button into view" : "wait for the product page to paint",
          score: 236 + jitter(),
        })
      }
      if (
        !ready &&
        traits.readsReviews &&
        pdp &&
        productId &&
        !memory.reviewsReadFor.includes(productId)
      ) {
        candidates.push({
          action: { type: "scrollTo", percent: 85 },
          reason: "read reviews",
          score: 160 + jitter(),
        })
      }
      if (
        traits.usesWishlist > 55 &&
        productId &&
        !memory.wishlistedIds.includes(productId) &&
        (find(page, "add-to-wishlist") || find(page, `wishlist-btn-${productId}`))
      ) {
        const wishlistId = find(page, "add-to-wishlist")
          ? "add-to-wishlist"
          : `wishlist-btn-${productId}`
        candidates.push({
          action: { type: "click", agentId: wishlistId },
          reason: "save to wishlist",
          score: 145 + jitter(),
        })
      }
      if (!ready && quickRoot && find(page, "quickview-close")) {
        candidates.push({
          action: { type: "click", agentId: "quickview-close" },
          reason: "close quick view and keep browsing",
          score: 130 + jitter(),
        })
      }
      if (!ready && pdp && find(page, "nav-back")) {
        candidates.push({
          action: { type: "click", agentId: "nav-back" },
          reason: "back to the listing",
          score: 125 + jitter(),
        })
      }
    }

    if (
      !memory.askedConcierge &&
      find(page, "concierge-toggle") &&
      memory.consideredIds.length >= 1 &&
      memory.consideredIds.length < traits.productsViewedBeforeDecision &&
      !memory.addedToBag
    ) {
      candidates.push({
        action: { type: "click", agentId: "concierge-toggle" },
        reason: "peek at the concierge",
        score: 28 + jitter(),
      })
    }
    if (memory.askedConcierge === false && find(page, "concierge-ask-0") && find(page, "concierge-panel")) {
      candidates.push({
        action: { type: "click", agentId: "concierge-ask-0" },
        reason: "ask the concierge a canned question",
        score: 36 + jitter(),
      })
    }

    if (memory.steps > cap && !memory.addedToBag) {
      if (find(page, "add-to-bag")) {
        candidates.push({
          action: { type: "click", agentId: "add-to-bag" },
          reason: "session cap — add the open product",
          score: 300 + jitter(),
        })
      } else {
        const card = page.elements.find((element) => element.agentId.startsWith("product-card-"))
        if (card) {
          candidates.push({
            action: { type: "click", agentId: card.agentId },
            reason: "session cap — open a product to buy",
            score: 300 + jitter(),
          })
        }
      }
    }

    if (memory.steps > cap + 12 && memory.addedToBag && find(page, "bag-icon") && !payVisible) {
      candidates.push({
        action: { type: "click", agentId: checkoutVisible ? "checkout-btn" : "bag-icon" },
        reason: "session cap — force checkout",
        score: 310 + jitter(),
      })
    }

    if (candidates.length === 0) {
      const card = page.elements.find((element) => element.agentId.startsWith("product-card-"))
      const nav = landingNav(persona)
      if (card && memory.consideredIds.length >= traits.productsViewedBeforeDecision) {
        candidates.push({
          action: { type: "click", agentId: card.agentId },
          reason: "reopen a product to decide",
          score: 40,
        })
      } else if (isPdp(page.route)) {
        candidates.push({
          action: { type: "scrollTo", percent: Math.min(80, page.scrollPercent + 20) },
          reason: "stay on the product page",
          score: 30,
        })
      } else if (isHome(page.route) && find(page, nav)) {
        candidates.push({
          action: { type: "click", agentId: nav },
          reason: "leave home for the department",
          score: 40,
        })
      } else if (!isHome(page.route) && find(page, "nav-home")) {
        candidates.push({
          action: { type: "click", agentId: "nav-home" },
          reason: "nothing else matched — return home",
          score: 20,
        })
      } else {
        candidates.push({
          action: { type: "wait", ms: 400 },
          reason: "nothing else matched — wait",
          score: 10,
        })
      }
    }

    const best = pickBest(candidates)
    if (!best) {
      return { action: { type: "wait", ms: 200 }, reason: "no action", endSession: true }
    }

    remember(best, page, persona, memory)
    memory.steps += 1
    if (memory.steps > cap + 24 && !memory.paid) {
      return { ...best, reason: `${best.reason} (giving up)`, endSession: true }
    }
    return { action: best.action, reason: best.reason, endSession: best.endSession }
  },
}

function remember(best: Candidate, page: PageState, persona: Persona, memory: AgentMemory) {
  const action = best.action
  if (action.type === "click" && (action.agentId === "popup-close" || action.agentId === "popup-cta")) {
    memory.popupHandled = true
  }
  if (action.type === "click" && action.agentId === "hero-banner-cta") memory.bannerClicked = true
  if (action.type === "click" && action.agentId.startsWith("nav-") && action.agentId !== "nav-back") {
    memory.landed = true
  }
  if (action.type === "type" && action.agentId === "search-input") {
    memory.landed = true
    memory.searched = true
  }
  if (action.type === "click" && action.agentId === "sort-dropdown") memory.sortMenuOpened = true
  if (action.type === "scrollTo" && !isPdp(page.route) && !find(page, "quickview-root")) {
    if (action.percent >= persona.traits.scrollDepth - 1) memory.scrollTargetReached = true
  }
  if (action.type === "scrollTo" && (isPdp(page.route) || find(page, "pdp-root"))) {
    const id = find(page, "pdp-root")?.productId
    if (id && !memory.reviewsReadFor.includes(id)) memory.reviewsReadFor.push(id)
  }
  if (action.type === "click") {
    if (action.agentId === "add-to-bag") memory.addedToBag = true
    if (action.agentId === "bag-icon") memory.openedBag = true
    if (action.agentId === "checkout-btn") memory.startedCheckout = true
    if (action.agentId === "visa-pay-btn") memory.paid = true
    if (action.agentId === "concierge-toggle" || action.agentId.startsWith("concierge-ask-")) {
      memory.askedConcierge = true
    }
    if (action.agentId === "add-to-wishlist" || action.agentId.startsWith("wishlist-btn-")) {
      const id =
        find(page, "pdp-root")?.productId ??
        find(page, "quickview-root")?.productId ??
        action.agentId.replace("wishlist-btn-", "")
      if (id && !memory.wishlistedIds.includes(id)) memory.wishlistedIds.push(id)
    }
  }
}
