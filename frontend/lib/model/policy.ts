import type { AdId } from "@/lib/ads/catalog"
import { MODEL_SECTIONS, type ModelDecisionKey, type ModelSection } from "@/lib/layout/enums"
import type { DecisionClass, HMCategory, HMHero, HomepageDoc } from "@/lib/model/homepage"
import { HM_TO_APP_CATEGORIES, HM_TO_APP_DEPARTMENT } from "@/lib/model/mapping"
import { CATEGORIES, type Category, type Department } from "@/lib/store/types"

/** What the model decided, in store terms. Shared by modelLayout and the validator. */

function uniq<T>(xs: T[]): T[] {
  return xs.filter((x, i) => xs.indexOf(x) === i)
}

export function modelDepartment(doc: HomepageDoc): Department | null {
  return HM_TO_APP_DEPARTMENT[doc.layout.landing_department.value] ?? null
}

/** Store categories in the model's predicted order; unmapped categories keep their default position at the end. */
export function modelCategoryOrder(doc: HomepageDoc): Category[] {
  return uniq<Category>([...doc.layout.category_order.value.flatMap((c) => HM_TO_APP_CATEGORIES[c] ?? []), ...CATEGORIES])
}

export function modelSectionOrder(doc: HomepageDoc): ModelSection[] {
  return uniq(doc.layout.section_order.value.filter((s): s is ModelSection => MODEL_SECTIONS.includes(s)))
}

export function newsletterAllowed(doc: HomepageDoc | null | undefined): boolean {
  return doc ? doc.layout.popups.value === "on" : true
}

const CATEGORY_AD: Partial<Record<HMCategory, Record<Department, AdId | null>>> = {
  cat_garment_upper_body: { women: "cat_upper_women", men: "cat_upper_men" },
  cat_garment_lower_body: { women: "cat_lower_women", men: "cat_lower_men" },
  cat_garment_full_body: { women: "cat_full_women", men: null },
}

/**
 * Model hero -> house ad. discount -> the department's sale ad, new_drop -> its new-drop ad,
 * category -> the category ad for the top H&M group, editorial -> the collection ad.
 * Groups without a category ad (shoes, accessories, men's full body) fall back to the collection ad.
 */
export function heroAdFor(hero: HMHero, department: Department | null, topGroup?: HMCategory): AdId {
  const dept = department ?? "women"
  if (hero === "discount") return dept === "men" ? "sale_men" : "sale_women"
  if (hero === "new_drop") return dept === "men" ? "new_men" : "new_women"
  if (hero === "category" && topGroup) {
    const ad = CATEGORY_AD[topGroup]?.[dept]
    if (ad) return ad
  }
  return dept === "men" ? "collection_men" : "collection_women"
}

export function modelHeroAd(doc: HomepageDoc, department: Department | null): AdId {
  return heroAdFor(doc.layout.hero.value, department, doc.layout.category_order.value[0])
}

export function modelReason(doc: HomepageDoc, key: ModelDecisionKey): { text: string; class: DecisionClass } {
  const decision = doc.layout[key]
  return { text: decision.reason, class: decision.class }
}

/** Numbers an LLM reason may cite: anything that appears in the model's output. */
export function groundedNumbers(doc: HomepageDoc): Set<string> {
  const out = new Set<string>()
  const add = (n: number) => {
    out.add(String(n))
    out.add(String(Math.round(n)))
  }
  for (const decision of Object.values(doc.layout)) {
    for (const match of decision.reason.matchAll(/\d+(?:\.\d+)?/g)) out.add(match[0])
    if (typeof decision.value === "number") add(decision.value)
  }
  for (const group of Object.values(doc.predicted_mix)) {
    for (const share of Object.values(group as Record<string, number>)) add(share * 100)
  }
  if (doc.evidence) {
    add(doc.evidence.add_to_bags)
    add(doc.evidence.events)
  }
  if (doc.store_products) add(doc.store_products.length)
  return out
}
