import type { NavItemId } from "@/lib/layout/enums"
import type { LayoutConfig } from "@/lib/layout/types"
import type { Category, CollectionName } from "@/lib/store/types"
import { collectionSlug } from "@/lib/utils"

/** The shopper's department, or Women when the layout has not chosen one. */

export function departmentPath(layout: LayoutConfig): string {
  return `/store/${layout.nav.department ?? "women"}`
}

export function collectionHref(layout: LayoutConfig, collection: CollectionName): string {
  const base = layout.nav.department ? departmentPath(layout) : "/store/search"
  return `${base}?collection=${collectionSlug(collection)}`
}

export function categoryHref(layout: LayoutConfig, category: Category): string {
  const base = layout.nav.department ? departmentPath(layout) : "/store/search"
  return `${base}?category=${category}`
}

export const NAV_LABEL: Record<NavItemId, string> = {
  women: "Women",
  men: "Men",
  new_in: "New in",
  sale: "Sale",
  collections: "Collections",
  for_you: "For you",
}

export function navHref(layout: LayoutConfig, id: NavItemId): string {
  switch (id) {
    case "women":
      return "/store/women"
    case "men":
      return "/store/men"
    case "new_in":
      return "/store/new-in"
    case "sale":
      return "/store/sale"
    case "collections":
      return departmentPath(layout)
    case "for_you":
      return "/store/for-you"
  }
}
