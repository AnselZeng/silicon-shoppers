import type { HMCategory, HMDepartment, HMHero, HMSection, HomepageDoc } from "@/lib/model/homepage"

export const MIX_DEPARTMENTS: { key: HMDepartment; label: string }[] = [
  { key: "dept_ladieswear", label: "Women" },
  { key: "dept_menswear", label: "Men" },
  { key: "dept_divided", label: "Divided" },
  { key: "dept_sport", label: "Sport" },
  { key: "dept_baby_children", label: "Kids" },
]

export const MIX_CATEGORIES: { key: HMCategory; label: string }[] = [
  { key: "cat_garment_upper_body", label: "Tops" },
  { key: "cat_garment_lower_body", label: "Bottoms" },
  { key: "cat_garment_full_body", label: "Dresses" },
  { key: "cat_shoes", label: "Shoes" },
  { key: "cat_accessories", label: "Accessories" },
  { key: "cat_underwear", label: "Underwear" },
  { key: "cat_swimwear", label: "Swim" },
  { key: "cat_other", label: "Other" },
]

export const MIX_SECTIONS: { key: HMSection; label: string }[] = [
  { key: "sale", label: "Sale" },
  { key: "new_in", label: "New in" },
  { key: "bestsellers", label: "Bestsellers" },
  { key: "buy_again", label: "Buy again" },
]

function topKey<K extends string>(map: Record<K, number>, keys: readonly K[]): K {
  return keys.reduce((best, key) => ((map[key] ?? 0) > (map[best] ?? 0) ? key : best))
}

function orderByShare<K extends string>(map: Record<K, number>, keys: readonly K[]): K[] {
  return [...keys].sort((a, b) => (map[b] ?? 0) - (map[a] ?? 0) || keys.indexOf(a) - keys.indexOf(b))
}

/** Keep a group as shares of one whole. The edited key takes its new value; the rest split what remains. */
export function rebalance<K extends string>(map: Record<K, number>, keys: readonly K[], key: K, next: number): Record<K, number> {
  const clamped = Math.min(1, Math.max(0, next))
  const others = keys.filter((item) => item !== key)
  const rest = 1 - clamped
  const otherSum = others.reduce((sum, item) => sum + (map[item] ?? 0), 0)
  const out = {} as Record<K, number>
  for (const item of keys) {
    if (item === key) out[item] = clamped
    else out[item] = otherSum > 0 ? ((map[item] ?? 0) / otherSum) * rest : rest / Math.max(1, others.length)
  }
  return out
}

function pct(share: number): number {
  return Math.round(share * 100)
}

/**
 * Rewrite the layout decisions from the predicted mix.
 * Run reads those decisions, so the numbers on the sliders are what the store uses.
 */
export function applyMix(doc: HomepageDoc): HomepageDoc {
  const department = doc.predicted_mix.department
  const category = doc.predicted_mix.category
  const section = doc.predicted_mix.section
  const deptKeys = MIX_DEPARTMENTS.map((item) => item.key)
  const catKeys = MIX_CATEGORIES.map((item) => item.key)
  const secKeys = MIX_SECTIONS.map((item) => item.key)
  const landing = topKey(department, deptKeys)
  const categories = orderByShare(category, catKeys)
  const sections = orderByShare(section, secKeys)
  const topSection = sections[0]
  const hero: HMHero = topSection === "sale" ? "discount" : topSection === "new_in" ? "new_drop" : "editorial"
  const deptLabel = MIX_DEPARTMENTS.find((item) => item.key === landing)?.label ?? landing
  const catLabel = MIX_CATEGORIES.find((item) => item.key === categories[0])?.label ?? categories[0]
  const secLabel = MIX_SECTIONS.find((item) => item.key === topSection)?.label ?? topSection
  const exploring = doc.browsing.exploration
  const returns = doc.browsing.multi_visit_research
  const grid = exploring >= 0.66 ? 4 : exploring <= 0.33 ? 2 : 3
  const sort = topSection === "sale" ? "price_asc" : topSection === "new_in" ? "newest" : doc.layout.default_sort.value

  return {
    ...doc,
    layout: {
      ...doc.layout,
      landing_department: {
        ...doc.layout.landing_department,
        value: landing,
        reason: `${deptLabel}: about ${pct(department[landing] ?? 0)}% of your next picks`,
      },
      category_order: {
        ...doc.layout.category_order,
        value: categories,
        reason: `${catLabel} first: about ${pct(category[categories[0]] ?? 0)}% of your next picks`,
      },
      section_order: {
        ...doc.layout.section_order,
        value: sections,
        reason: `${secLabel} first: about ${pct(section[topSection] ?? 0)}% of your next picks are likely to come from it`,
      },
      hero: {
        ...doc.layout.hero,
        value: hero,
        class: "Assumed",
        reason:
          hero === "discount"
            ? "Sale banner: Sale is your top section"
            : hero === "new_drop"
              ? "New-drop banner: New In is your top section"
              : "Editorial banner",
      },
      default_sort: {
        ...doc.layout.default_sort,
        value: sort,
        reason: sort === "price_asc" ? "Sorted price, low to high" : sort === "newest" ? "Sorted newest" : doc.layout.default_sort.reason,
      },
      price_filter_first: {
        ...doc.layout.price_filter_first,
        value: topSection === "sale",
        reason: topSection === "sale" ? "Price filter first: sale items predicted to matter" : "Default filters",
      },
      grid_columns: {
        ...doc.layout.grid_columns,
        value: grid,
        reason: grid === 4 ? "Denser grid: this shopper explores widely" : grid === 2 ? "Quieter grid: this shopper looks closely" : "Store default grid",
      },
      recently_viewed: {
        ...doc.layout.recently_viewed,
        value: returns >= 0.55 ? "prominent" : "default",
        reason: returns >= 0.55 ? "Recently viewed stays up: this shopper comes back" : "Store default until they return often",
      },
    },
  }
}
