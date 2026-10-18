import { describe, expect, test } from "vitest"
import { DEFAULT_LAYOUT } from "@/lib/layout/presets"
import { migrateV1, V1_DEFAULT_LAYOUT, type LayoutConfigV1 } from "@/lib/layout/v1"
import { validateLayout } from "@/lib/layout/validate"

const SALE_FIRST: LayoutConfigV1 = {
  defaultSort: "price_asc",
  filterOrder: ["sale", "price", "category", "size", "color", "collection"],
  expandedFilters: ["sale", "price"],
  heroVariant: "discount_banner",
  popupEnabled: true,
  popupVariant: "new_drop",
  gridDensity: 4,
  homeSectionOrder: ["sale_picks", "collections", "new_in", "bestsellers"],
  showSaleBadgesProminently: true,
  quickViewEmphasis: true,
  searchEmphasized: true,
  heroMinimized: true,
  checkoutVariant: "guest_fast",
  expressCheckout: true,
  showTrustBadges: true,
  conciergeEnabled: true,
  conciergeTone: "deals",
  loyaltyPrompt: true,
  colorMerchandising: "split_colors",
}

describe("v1 -> v2 mapping", () => {
  test("covers all 19 v1 fields", () => {
    expect(Object.keys(SALE_FIRST)).toHaveLength(19)
    const v2 = migrateV1(SALE_FIRST)
    const hero = v2.ads.placements.find((p) => p.slot === "hero")
    const popup = v2.ads.placements.find((p) => p.slot === "popup")
    const checks: Record<keyof LayoutConfigV1, unknown[]> = {
      defaultSort: [v2.listing.defaultSort, "price_asc"],
      filterOrder: [v2.listing.filterOrder, SALE_FIRST.filterOrder],
      expandedFilters: [v2.listing.expandedFilters, ["sale", "price"]],
      gridDensity: [v2.listing.gridDensity, 4],
      colorMerchandising: [v2.listing.colorMerchandising, "split_colors"],
      quickViewEmphasis: [v2.listing.card.quickView, "emphasized"],
      showSaleBadgesProminently: [v2.listing.card.priceStyle, "sale_emphasis"],
      searchEmphasized: [v2.nav.searchEmphasized, true],
      homeSectionOrder: [
        v2.home.blocks.map((b) => (b.type === "product_row" ? b.source.kind : b.type)),
        ["hero", "sale", "category_tiles", "new_in", "bestsellers"],
      ],
      heroVariant: [hero?.adIds, ["sale_women"]],
      heroMinimized: [v2.home.heroSize, "compact"],
      popupEnabled: [popup !== undefined, true],
      popupVariant: [popup?.adIds, ["new_women"]],
      checkoutVariant: [v2.checkout.variant, "guest_fast"],
      expressCheckout: [v2.checkout.expressCheckout, true],
      showTrustBadges: [v2.checkout.showTrustBadges, true],
      loyaltyPrompt: [v2.checkout.loyaltyPrompt, true],
      conciergeEnabled: [v2.concierge.enabled, true],
      conciergeTone: [v2.concierge.tone, "deals"],
    }
    for (const [field, [actual, expected]] of Object.entries(checks)) {
      expect(actual, field).toEqual(expected)
    }
  })

  test("false / off values map too", () => {
    const v2 = migrateV1(V1_DEFAULT_LAYOUT)
    expect(v2.listing.card).toMatchObject({ quickView: "button", priceStyle: "plain" })
    expect(v2.home.heroSize).toBe("full")
    expect(migrateV1({ ...V1_DEFAULT_LAYOUT, popupEnabled: false }).ads.placements.some((p) => p.slot === "popup")).toBe(false)
  })

  test("the house default is the migrated v1 default", () => {
    expect(migrateV1(V1_DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT)
  })

  test("a v1 config sent to the validator is migrated, not rejected", () => {
    const { layout, report } = validateLayout(SALE_FIRST)
    expect(report.fellBack).toBe(false)
    expect(layout.listing.defaultSort).toBe("price_asc")
  })
})
