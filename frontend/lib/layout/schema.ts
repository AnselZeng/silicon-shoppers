import { z } from "zod"
import { AD_SLOT_IDS, AD_TRIGGERS } from "@/lib/ads/types"
import {
  AD_IDS,
  CARD_BADGES,
  CHECKOUT_VARIANTS,
  COLOR_MERCHANDISING,
  CONCIERGE_TONES,
  COPY_LIMITS,
  FOR_YOU_MAX,
  MODEL_DECISION_KEYS,
  NAV_ITEM_IDS,
  REASON_CLASSES,
  STORE_COLOR_IDS,
  UNDER_PRICE_MAX,
} from "@/lib/layout/enums"
import { SORT_OPTIONS } from "@/lib/personas/schema"
import { CATEGORIES, COLLECTIONS } from "@/lib/store/types"

/**
 * Layout config v2. Structure only: lengths, counts and cross-field rules are
 * enforced by the validator (validate.ts), which fixes small problems instead of
 * rejecting the config. The limits are stated in each field's description so the
 * LLM sees them in the JSON Schema.
 */

export const FILTER_SECTION_IDS = ["sale", "price", "size", "color", "category", "collection"] as const

export const NavItemSchema = z.enum(NAV_ITEM_IDS)
export const AdIdSchema = z.enum(AD_IDS)
export const AdSlotSchema = z.enum(AD_SLOT_IDS)
export const CategorySchema = z.enum(CATEGORIES)
export const CollectionSchema = z.enum(COLLECTIONS)
export const StoreColorSchema = z.enum(STORE_COLOR_IDS)
export const SortOptionSchema = z.enum(SORT_OPTIONS)
export const FilterSectionSchema = z.enum(FILTER_SECTION_IDS)

export const NavSchema = z.object({
  order: z
    .array(NavItemSchema)
    .describe("Nav items shown, in order. 3–6 items. Leaving one out hides it. Keep at least one of women / men."),
  highlight: NavItemSchema.nullable().describe("One item drawn with emphasis, or null. Must be in order."),
  department: z
    .enum(["women", "men"])
    .nullable()
    .describe("Shopper's department. Makes links department-aware and filters home rows. null = both."),
  searchEmphasized: z.boolean().describe("Draw the search box wider and outlined."),
})

export const ProductSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("for_you") }).describe("The model's ranked products for this shopper."),
  z.object({ kind: z.literal("new_in") }).describe("Model section row: new arrivals."),
  z.object({ kind: z.literal("bestsellers") }).describe("Model section row: bestsellers."),
  z.object({ kind: z.literal("sale") }).describe("Model section row: sale."),
  z.object({ kind: z.literal("buy_again") }).describe("Model section row: the shopper's basket. Dropped when the basket is empty."),
  z.object({ kind: z.literal("under_price"), max: z.literal(UNDER_PRICE_MAX) }).describe("Products at or under a price."),
  z.object({ kind: z.literal("category"), category: CategorySchema }).describe("One store category."),
  z.object({ kind: z.literal("collection"), collection: CollectionSchema }).describe("One store collection."),
])

export const HomeBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hero") }).describe("Renders the hero ad placement. Must be the first block."),
  z
    .object({
      type: z.literal("product_row"),
      source: ProductSourceSchema,
      title: z.string().optional().describe(`Row title, plain text, at most ${COPY_LIMITS.rowTitle} characters.`),
      limit: z.literal([4, 8]),
    })
    .describe("A row of products. No two rows with the same source."),
  z
    .object({
      type: z.literal("category_tiles"),
      categories: z.array(CategorySchema).describe("3–6 categories. Shown in the model's category order."),
    })
    .describe("Category tiles linking to listings."),
  z.object({ type: z.literal("collection_spotlight"), collection: CollectionSchema }).describe("One collection, large."),
  z
    .object({ type: z.literal("editorial_text"), copyKey: z.enum(["intro", "story"]) })
    .describe("Shows copy.intro or copy.story. Dropped if that copy is empty."),
  z.object({ type: z.literal("ad_banner"), adId: AdIdSchema }).describe("A house ad as a banner. The ad must fit listing_banner."),
])

export const HomeSchema = z.object({
  blocks: z.array(HomeBlockSchema).describe("3–8 blocks, top to bottom."),
  heroSize: z.enum(["full", "compact"]),
  forYouIds: z.array(z.string()).describe(`Copied by code from the model's store_products, at most ${FOR_YOU_MAX}.`),
  basketIds: z.array(z.string()).describe("Copied by code from the persona's basket."),
})

export const CardSchema = z.object({
  priceStyle: z.enum(["plain", "sale_emphasis"]),
  showRating: z.boolean(),
  badges: z.array(z.enum(CARD_BADGES)).describe("Badges drawn on product cards."),
  quickView: z.enum(["button", "emphasized"]),
})

export const ListingSchema = z.object({
  defaultSort: SortOptionSchema,
  filterOrder: z.array(FilterSectionSchema).describe("All six filter sections, in order."),
  expandedFilters: z.array(FilterSectionSchema).describe("Filter sections open by default."),
  gridDensity: z.literal([2, 3, 4]),
  colorMerchandising: z.enum(COLOR_MERCHANDISING),
  colorHighlight: z.array(StoreColorSchema).describe("Up to 3 colors shown first on cards and in the color filter."),
  categoryOrder: z.array(CategorySchema).describe("Copied by code from the model's category_order."),
  card: CardSchema,
})

export const AdPlacementSchema = z.object({
  slot: AdSlotSchema,
  adIds: z.array(AdIdSchema).describe("1 ad, or 2–3 for top_strip and hero (carousel), up to 2 for grid_tile."),
  trigger: z.enum(AD_TRIGGERS).optional().describe("Intrusive slots only (popup, interstitial, sticky_footer)."),
  triggerValue: z
    .number()
    .optional()
    .describe("ms for delay, % for scroll_depth, page views for page_count."),
  gridPosition: z.number().int().optional().describe("grid_tile only: card index the tile goes before (2 or more)."),
})

export const AdsSchema = z.object({
  placements: z.array(AdPlacementSchema).describe("At most one placement per slot, at most 2 intrusive placements."),
})

export const AdOverrideSchema = z.object({
  headline: z.string().optional().describe(`At most ${COPY_LIMITS.headline} characters.`),
  cta: z.string().optional().describe(`At most ${COPY_LIMITS.cta} characters.`),
})

export const CopySchema = z.object({
  intro: z.string().optional().describe(`Editorial intro, at most ${COPY_LIMITS.intro} characters.`),
  story: z.string().optional().describe(`Editorial story, at most ${COPY_LIMITS.story} characters.`),
  adOverrides: z.partialRecord(AdIdSchema, AdOverrideSchema).optional().describe("Replacement ad text, keyed by ad id."),
})

export const CheckoutSchema = z.object({
  variant: z.enum(CHECKOUT_VARIANTS),
  expressCheckout: z.boolean(),
  showTrustBadges: z.boolean(),
  loyaltyPrompt: z.boolean(),
})

export const ConciergeSchema = z.object({
  enabled: z.boolean(),
  tone: z.enum(CONCIERGE_TONES),
})

const GROUPS = {
  nav: NavSchema,
  home: HomeSchema,
  listing: ListingSchema,
  ads: AdsSchema,
  copy: CopySchema,
  checkout: CheckoutSchema,
  concierge: ConciergeSchema,
}

type Groups = typeof GROUPS
type FieldPath = { [G in keyof Groups]: `${G}.${keyof Groups[G]["shape"] & string}` }[keyof Groups]

/** Every field a reason can explain, e.g. "nav.order". Generated from the group schemas. */
export const LAYOUT_FIELD_PATHS = Object.entries(GROUPS).flatMap(([group, schema]) =>
  Object.keys(schema.shape).map((key) => `${group}.${key}`),
) as [FieldPath, ...FieldPath[]]

export const LayoutReasonSchema = z.object({
  field: z.enum(LAYOUT_FIELD_PATHS),
  source: z.enum(["model", "llm"]),
  modelDecision: z.enum(MODEL_DECISION_KEYS).optional().describe("Required when source is model."),
  text: z
    .string()
    .describe(`Model reason (filled in by code) or LLM text, at most ${COPY_LIMITS.reason} characters, citing only numbers from the model output.`),
  class: z.enum(REASON_CLASSES).optional(),
})

export const LayoutConfigSchema = z.object({
  version: z.literal(2),
  ...GROUPS,
  reasons: z.array(LayoutReasonSchema),
})

/** What the LLM writes: everything except the fields code copies in afterwards. */
export const LlmLayoutSchema = LayoutConfigSchema.extend({
  home: HomeSchema.omit({ forYouIds: true, basketIds: true }),
  listing: ListingSchema.omit({ categoryOrder: true }),
})

export type LayoutConfig = z.infer<typeof LayoutConfigSchema>
export type LlmLayout = z.infer<typeof LlmLayoutSchema>
export type NavConfig = z.infer<typeof NavSchema>
export type HomeConfig = z.infer<typeof HomeSchema>
export type HomeBlock = z.infer<typeof HomeBlockSchema>
export type ProductSource = z.infer<typeof ProductSourceSchema>
export type ListingConfig = z.infer<typeof ListingSchema>
export type AdPlacement = z.infer<typeof AdPlacementSchema>
export type CopyConfig = z.infer<typeof CopySchema>
export type LayoutReason = z.infer<typeof LayoutReasonSchema>
export type LayoutFieldPath = LayoutReason["field"]
export type FilterSectionId = (typeof FILTER_SECTION_IDS)[number]
