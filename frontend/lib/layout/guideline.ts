import { z } from "zod"
import { AD_IDS, getAd } from "@/lib/ads/catalog"
import {
  AD_SLOT_IDS,
  INTRUSIVE_DROP_ORDER,
  MAX_INTRUSIVE,
  SLOT_CAP,
  SLOT_DESCRIPTION,
  SLOT_FORMAT,
  SLOT_MAX_ADS,
  TRIGGER_DEFAULTS,
  TRIGGER_RANGE,
} from "@/lib/ads/types"
import {
  COPY_LIMITS,
  HOME_BLOCKS_MAX,
  HOME_BLOCKS_MIN,
  NAV_ITEMS_MAX,
  NAV_ITEMS_MIN,
  TILES_MAX,
  TILES_MIN,
} from "@/lib/layout/enums"
import { HomeBlockSchema, LlmLayoutSchema, ProductSourceSchema } from "@/lib/layout/schema"

/**
 * The design guideline the LLM follows, generated from the code so it never drifts from what the
 * store can render: the schema, the home block library, the house ad catalog and the rules.
 * docs/design-guideline.md is a copy (npm run guideline).
 */

function literal(schema: z.ZodType, key: string): string {
  const shape = (schema as unknown as { shape: Record<string, { value?: unknown }> }).shape
  return String(shape[key]?.value ?? "")
}

function table(head: string[], rows: string[][]): string {
  const esc = (cell: string) => cell.replace(/\|/g, "\\|").replace(/\n/g, " ")
  return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`)].join("\n")
}

export function layoutJsonSchema(): object {
  return z.toJSONSchema(LlmLayoutSchema)
}

function blockLibrary(): string {
  const blocks = HomeBlockSchema.options.map((option) => [`\`${literal(option, "type")}\``, option.description ?? ""])
  const sources = ProductSourceSchema.options.map((option) => [`\`${literal(option, "kind")}\``, option.description ?? ""])
  return [
    table(["Block type", "What it is"], blocks),
    "",
    "Product row sources:",
    "",
    table(["Source kind", "What it shows"], sources),
  ].join("\n")
}

function slotTable(): string {
  return table(
    ["Slot", "Where", "Format", "Ads per placement", "Frequency cap"],
    AD_SLOT_IDS.map((slot) => [
      `\`${slot}\``,
      SLOT_DESCRIPTION[slot],
      SLOT_FORMAT[slot],
      String(SLOT_MAX_ADS[slot]),
      SLOT_CAP[slot].replace(/_/g, " "),
    ]),
  )
}

function adTable(): string {
  return table(
    ["Ad id", "Kind", "Department", "Headline", "CTA", "Fits slots", "Suits"],
    AD_IDS.map((id) => {
      const ad = getAd(id)
      return [`\`${id}\``, ad.kind, ad.department, ad.headline, ad.cta, ad.slots.join(", "), ad.suits ?? ""]
    }),
  )
}

const TRIGGERS = Object.entries(TRIGGER_RANGE)
  .map(([trigger, [min, max]]) => `${trigger} ${min}–${max}`)
  .join(", ")

export function designGuideline(): string {
  return `# SOCAL ATELIER design guideline

Generated from the code by \`lib/layout/guideline.ts\`. Do not edit by hand; run \`npm run guideline\`.

You design the storefront for one shopper. You fill in a fixed layout schema; you never write
pages, components, CSS, URLs or product ids. Product ids (the model's ranked products and the
shopper's basket) are copied into your layout by code after you answer.

## What you read

1. **The model's output** (\`HomepageDoc\`): layout decisions, each with a value, a class label
   (Tested / Estimated / Assumed / Based on your settings), a \`validated\` flag and a reason;
   \`predicted_mix\` (predicted shares by H&M category group, department and section);
   \`evidence.add_to_bags\` (how many add-to-bags the prediction rests on).
2. **The house default layout**: the store everyone gets. You turn the model's output into this
   shopper's layout; code doesn't build one from the model on its own.
3. **This guideline.**

H&M departments map to the store's: Ladieswear and Divided → women, Menswear → men. Sport and
Baby/Children have no store department.

## Model policy

- **Validated decisions are kept.** The model's section rows (\`new_in\`, \`sale\`, \`bestsellers\`,
  \`buy_again\` product rows) appear in the order of the model's \`section_order\`. You may leave one
  out and put other blocks between them, but not reorder them. Category tiles and the category
  filter follow \`category_order\`. Code enforces both.
- **You design what the model doesn't cover:** ads, the blocks around the model's rows, nav and copy.
- **Unvalidated decisions can be changed** (landing department, sort, hero, grid, filters, color
  highlight). If you change one, add a reason with \`source: "llm"\`.
- **The newsletter popup** is shown only when the model's \`popups\` decision is \`on\`. Other
  intrusive ads are your choice.

## Reasons

Give one reason per field you decide, at most ${COPY_LIMITS.reason} characters.

- To keep a model decision, use \`source: "model"\` and the \`modelDecision\` key; code fills in the
  model's own reason text and class label.
- Your own reasons use \`source: "llm"\` and may cite only numbers that appear in the model's output
  (shares as whole percentages, e.g. 0.41 → 41%, or the add-to-bag count). A reason citing any other
  number is removed.

## Navigation

${NAV_ITEMS_MIN}–${NAV_ITEMS_MAX} items from \`nav.order\`, in order; leaving one out hides it. Keep at least one of
\`women\` / \`men\`. \`for_you\` needs ranked products. \`highlight\` draws one item with emphasis.
\`department\` makes Collections and category links land in that department and filters home rows
(all sources except \`for_you\` and \`buy_again\`).

## Home block library

${HOME_BLOCKS_MIN}–${HOME_BLOCKS_MAX} blocks. No hero block means no hero; if there is one it is first, and its ad comes
from the \`hero\` placement (filled from the model's hero decision if you leave it out). No two
product rows with the same source. Rows are filled top to bottom and a product already shown is
skipped, so put the rows that matter most first. Category tiles: ${TILES_MIN}–${TILES_MAX}, in the model's
category order. \`ad_banner\` takes an ad that fits \`listing_banner\`.

${blockLibrary()}

## Ad slots

${slotTable()}

## House ad catalog

${adTable()}

## Ad rules (enforced by code)

- At most one placement per slot. Each ad must list the slot it's placed in.
- At most ${MAX_INTRUSIVE} intrusive placements (popup, interstitial, sticky_footer). Extra ones are dropped in
  this order: ${INTRUSIVE_DROP_ORDER.join(", then ")}.
- \`trigger\` and \`triggerValue\` apply to intrusive slots only. Ranges: ${TRIGGERS}.
  Defaults: popup ${TRIGGER_DEFAULTS.popup.trigger} ${TRIGGER_DEFAULTS.popup.triggerValue} ms, sticky footer
  ${TRIGGER_DEFAULTS.sticky_footer.trigger} ${TRIGGER_DEFAULTS.sticky_footer.triggerValue}%, interstitial after
  ${TRIGGER_DEFAULTS.interstitial.triggerValue} listing ↔ product move (interstitials take only on_load or page_count).
- \`gridPosition\` (grid_tile only) is the card the tile goes before, from 2.

## Intrusive ads: guidance

- Offer popups and sticky footers suit a high \`markdown_affinity\` (sale leads \`section_order\`,
  a high predicted sale share).
- A new-drop interstitial suits a high \`novelty_affinity\` (new_in leads \`section_order\`).
- Shoppers with low evidence (few add-to-bags) or a strong single-category focus get none.
- Fewer is better. One well-placed intrusive ad beats two.

## Copy

- \`copy.intro\` at most ${COPY_LIMITS.intro} characters, \`copy.story\` at most ${COPY_LIMITS.story}; both shown only through an
  \`editorial_text\` block.
- \`copy.adOverrides\` replaces an ad's headline (at most ${COPY_LIMITS.headline}) or CTA (at most ${COPY_LIMITS.cta}).
- Product row titles at most ${COPY_LIMITS.rowTitle} characters.
- Code strips markup and URLs, trims to the limit, and removes any price or percentage the catalog
  doesn't have.

## Brand voice

Short and plain. No exclamation marks. No invented discounts, prices or urgency ("last chance",
"only 2 left"). Name the clothes, not the shopper. Quiet confidence: "Cut for the cold." not
"You'll love these amazing coats!"

## Output schema (JSON Schema)

\`\`\`json
${JSON.stringify(layoutJsonSchema(), null, 2)}
\`\`\`
`
}
