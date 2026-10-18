# Layout expansion plan (work plan step 1)

Status: proposal, revision 3 · Last updated: 2026-10-17

This is the detailed plan for step 1 of the [project plan](project-plan.md): expanding the layout options the LLM can choose from, and writing the design guideline the LLM follows. Other steps are only covered where they affect the schema.

Revision 2 incorporated the first review (`layout-expansion-plan-review.txt`) and the H&M model on `origin/pb-backend` (commit `96c88c9`). Revision 3 incorporates a second review against the backend scoring code (`backend/server/score.py`, `backend/server/app/lib/model/adapter.ts`).

## Decisions so far

| Question | Decision |
| --- | --- |
| Option groups | **Navigation**, **Ads and promotions**, **Content and merchandising**. Visual style is out of scope. |
| Ad type | **House ads only**: the store's own promotions. No sponsored ads. |
| LLM freedom | **Pick options + compose home sections + write short copy** within length limits. |
| Intrusive ad formats | **Included as options.** The model's `popups` setting controls only the **newsletter popup**. The **LLM decides** offer popups, interstitials and sticky footers from the shopper's features. |
| What the LLM reads | The **model's output** (`HomepageDoc`) **and the design guideline** (this plan's options, block library, ad catalog, rules and brand voice). |
| H&M departments | **Follow the backend:** Ladieswear and **Divided → women**, Menswear → men. Sport and Baby/Children are ignored. |
| Robot cursor and click classifier | **Removed**, before the schema change. Judges browse the generated store by hand. |

## Principles

1. **Schema first.** Every option is a typed field with a fixed set of values. The LLM fills the schema; it never writes JSX, CSS, URLs or product ids that aren't in an enum.
2. **Three layouts, one schema.** The store has a **default** layout, a **model layout** built by code from the model's output (`modelLayout(doc)`, no LLM), and an **LLM layout** that builds on the model layout. The demo can show all three in turn.
3. **The model decides what it can; the LLM fills the rest.** The LLM keeps validated decisions (see "Model policy" below), and designs what the model doesn't cover: ads, extra home blocks, nav and copy.
4. **Code copies data, the LLM designs.** Product ids (ranked products, the basket) are copied into the config by code, never written by the LLM.
5. **Grounded reasons only.** Every reason shown is the model's own reason string or cites a number in the model's output.
6. **One validator, run everywhere.** `setLayout` runs the validator, so every source goes through the same checks. Small problems are fixed in place. A broken LLM config falls back to the **model layout**, not a preset.
7. **Every option renders visibly.** A field that doesn't produce a visible difference between profiles isn't worth adding.

---

## Inputs: what the LLM receives

### 1. Model output (`HomepageDoc`)

Defined in `backend/server/app/lib/model/homepage.ts` on `origin/pb-backend`, and produced for store shoppers by `build_docs` in `backend/server/score.py`. The parts used:

| Field | What it is | Used for |
| --- | --- | --- |
| `layout.landing_department` | H&M department with reason (`validated: false` in the current build) | `nav.department`, nav order, department-aware links and rows |
| `layout.category_order` | H&M product groups in predicted order (validated) | `category_tiles` order, category filter order |
| `layout.section_order` | `new_in` / `sale` / `bestsellers` / `buy_again` (validated) | Order of the model's section rows |
| `layout.default_sort` | Sort with reason | `listing.defaultSort` |
| `layout.hero` | `editorial` / `discount` / `new_drop` / `category` | Which hero ad to choose |
| `layout.grid_columns` | 2 / 3 / 4 | `listing.gridDensity` |
| `layout.filter_order`, `price_filter_first` | Filter order | `listing.filterOrder` |
| `layout.color_highlight` | H&M colours the shopper buys | `listing.colorHighlight` |
| `layout.popups` | on / off; currently always `off` ("No newsletter sign-up on record", `score.py:117`) | **Newsletter popup only** |
| `predicted_mix` | Predicted shares by category, department and section | LLM's choice of ads, blocks and copy; `rankCatalog` fallback |
| `store_products` | Up to 24 ranked store product ids, excluding items already in the basket (`rank_store`, `score.py:173`) | `home.forYouIds`, copied by code |
| `evidence` | Number of add-to-bags behind the prediction | Shown in the pipeline view |

Not used in this step: `recently_viewed`, `compare_panel`, `cart_reminder`, `browsing`, and `products` (H&M articles, which aren't in our catalog).

**H&M → store mapping:** port the existing tables from `backend/server/app/lib/model/adapter.ts`: `HM_TO_APP_CATEGORIES`, `HM_TO_APP_COLOR`, `HM_TO_APP_DEPARTMENT`. They already match the backend's ranking (`rank_store` treats women as Ladieswear + Divided). Don't write a second mapping.

### 2. Model policy

`validated` is set **once per decision type for the whole model build**, not per shopper (`score.py:90`). In the current build, `category_order` and `section_order` are validated and `landing_department` is not. The rule:

- **Validated decisions are kept.** The model's section rows (New in, Sale, Bestsellers, Buy again) appear in the model's relative order for every shopper. Category tiles and the category filter follow `category_order`. The validator enforces both.
- **The LLM composes around them.** It can add hero, category tiles, collection spotlights, editorial text, ad banners and extra category/collection/price rows anywhere between or around the model's rows. It can leave a model row out, but not reorder them.
- **Unvalidated decisions can be changed** (landing department, sort, hero, grid, filters, colour highlight), with the reason marked `source: "llm"`. Unchanged ones keep the model's reason and class label, e.g. landing department shows as "Assumed".

### 3. Design guideline

Generated from code so it never drifts from what the store can render:

- **The schema** (from zod, via `z.toJSONSchema()`), with a one-line description per field.
- **The home block library** and its rules, including the model policy above.
- **The house ad catalog**: id, kind, department, default copy, which slots it fits, and who it suits.
- **The rules**: ad caps, intrusive-ad guidance, copy limits.
- **Brand voice** for copy: short, plain, no exclamation marks, no invented discounts or prices.

Source: `lib/layout/guideline.ts` builds the prompt text. A readable copy lives in `docs/design-guideline.md`, regenerated with a script.

---

## Target schema (v2)

```ts
interface LayoutConfig {
  version: 2
  nav: NavConfig
  home: HomeConfig
  listing: ListingConfig
  ads: AdsConfig
  copy: CopyConfig
  checkout: CheckoutConfig    // existing fields, unchanged
  concierge: ConciergeConfig  // existing fields, unchanged
  reasons: LayoutReason[]
}

interface LayoutReason {
  field: LayoutFieldPath            // enum of field paths, e.g. "nav.order"
  source: "model" | "llm"
  modelDecision?: ModelDecisionKey  // when source = "model"
  text: string                      // model reason string, or LLM text ≤ 120 chars citing input numbers only
  class?: "Tested" | "Estimated" | "Assumed" | "Based on your settings"
}
```

### Data the store needs, copied by code

The store runs in an iframe and only receives `set_layout { layout }` (`protocol.ts:74`). So data from the model and the persona is copied into the config **by code after the LLM call**, never by the LLM:

```ts
interface HomeConfig {
  // ...blocks and heroSize, see Group 3
  forYouIds: string[]    // from store_products, in order, ≤ 24
  basketIds: string[]    // the persona's basket
}
```

This keeps one protocol message, and a cached config works on its own. `rankCatalog` (ported from the backend adapter) is run in the parent page when building the model layout; its `predicted_mix` fallback fills `forYouIds` if `store_products` is missing.

Because `rank_store` leaves out basket items, `for_you` and `buy_again` never overlap, and the For You page has at most 24 products.

### v1 → v2 field mapping

| v1 field | v2 location | Notes |
| --- | --- | --- |
| `defaultSort` | `listing.defaultSort` | |
| `filterOrder` | `listing.filterOrder` | |
| `expandedFilters` | `listing.expandedFilters` | |
| `gridDensity` | `listing.gridDensity` | |
| `colorMerchandising` | `listing.colorMerchandising` | |
| `quickViewEmphasis` | `listing.card.quickView` | `true` → `"emphasized"`, `false` → `"button"` |
| `showSaleBadgesProminently` | `listing.card.priceStyle` | `true` → `"sale_emphasis"` |
| `searchEmphasized` | `nav.searchEmphasized` | |
| `homeSectionOrder` | `home.blocks` | Each section becomes a `product_row` / `category_tiles` block |
| `heroVariant` | `ads.placements[slot=hero]` | Variants become hero house ads |
| `heroMinimized` | `home.heroSize` | `true` → `"compact"` |
| `popupEnabled`, `popupVariant` | `ads.placements[slot=popup]` | No placement = no popup |
| `checkoutVariant`, `expressCheckout`, `showTrustBadges` | `checkout.*` | Unchanged |
| `loyaltyPrompt` | `checkout.loyaltyPrompt` | Still drives `BagDrawer`, `VisaCheckout` and loyalty awarding in `actions.ts` |
| `conciergeEnabled`, `conciergeTone` | `concierge.*` | Unchanged |

---

## Group 1: Navigation

**Now:** `Header.tsx` renders a hard-coded `LINKS` array. "Collections" always links to `/store/women`.

```ts
type NavItemId = "women" | "men" | "new_in" | "sale" | "collections" | "for_you"

interface NavConfig {
  order: NavItemId[]                 // items shown, in order; 3–6 items
  highlight: NavItemId | null        // one item drawn with emphasis
  department: "women" | "men" | null // from landing_department (Ladieswear/Divided → women, Menswear → men)
  searchEmphasized: boolean
}
```

- Leaving an item out of `order` hides it. At least one of `women` / `men` must stay visible.
- `department` makes links department-aware: "Collections" and collection tiles go to `/store/men?collection=…` for a menswear shopper.
- The thin bar above the header is **only** the `top_strip` ad slot.

**Work:** a nav item registry in `Header.tsx`; highlight styling; department-aware hrefs in `Header.tsx` and `HomeView.tsx`.

**Done when:** a menswear-heavy profile shows `Men` first, and its collection links land in menswear.

**Effort:** small.

---

## Group 2: Ads and promotions

**Now:** no ad system. `Hero.tsx` has 4 fixed variants, `PromoStrip.tsx` derives its text from the hero, and `Popup.tsx` has 2 variants. `StoreShell.tsx:233` also renders a compact hero on every listing page.

### 2a. House ad catalog

`lib/ads/catalog.ts`. The LLM picks ads by id from a generated enum.

```ts
interface HouseAd {
  id: AdId                      // enum generated from the catalog
  kind: "sale" | "new_drop" | "collection" | "category" | "newsletter" | "shipping" | "loyalty"
  department: "women" | "men" | "all"
  hmCategory?: "cat_garment_upper_body" | "cat_garment_lower_body" | "cat_garment_full_body"  // category ads only
  headline: string
  body?: string
  cta: string
  href: string                  // internal route; department-aware
  visual: "garment" | "pattern" | "type_only"
  slots: AdSlotId[]
  suits?: string                // guideline text in the model's feature names, e.g. "high markdown_affinity"
}
```

**Catalog contents (about 17 ads):**

| Kind | Ads | Count |
| --- | --- | --- |
| `category` | Upper body, lower body, full body; one per department (no men's full body: the store has no men's dresses) | 5 |
| `sale` | One per department | 2 |
| `new_drop` | One per department | 2 |
| `collection` | One per department (e.g. Essentials, Winter Edit) | 2 |
| `newsletter` | Sign-up offer (popup only; shown only if the model's `popups` is `on`) | 1 |
| `shipping` | Free shipping threshold | 1 |
| `loyalty` | Points / perks | 1 |
| offers | Sale offer for popup / interstitial / sticky footer, one per department, plus one "all" | 3 |

**Model hero → ad:** `discount` → the department's sale ad; `new_drop` → its new-drop ad; `category` → the category ad for the model's top H&M group and department; `editorial` → the collection ad. When the top group is shoes or accessories (no category ad), fall back to the collection ad.

### 2b. Slots (where)

| Slot | Where | Pages | Intrusive | Format |
| --- | --- | --- | --- | --- |
| `top_strip` | Thin bar above the header | All | No | static or carousel |
| `hero` | Home hero | Home only | No | static or carousel |
| `listing_banner` | Banner above the product grid; replaces today's compact hero on listings | Listings | No | static |
| `grid_tile` | Ad card inside a listing grid | Listings only | No | static |
| `popup` | Modal | Any | Yes | dismissible |
| `interstitial` | Full-screen overlay between page loads | Listing ↔ product transitions | Yes | dismissible |
| `sticky_footer` | Fixed bar at the bottom | All | Yes | dismissible |

Deferred: `sidebar_card`, `pdp_cross_sell`, `bag_upsell`.

### 2c. Placement

```ts
interface AdPlacement {
  slot: AdSlotId
  adIds: AdId[]                 // 1, or 2–3 for carousel slots
  trigger?: "on_load" | "delay" | "scroll_depth" | "exit_intent" | "page_count"  // intrusive slots only
  triggerValue?: number         // ms (delay), % (scroll_depth), n (page_count)
  gridPosition?: number         // grid_tile only; clamped to 2..(cards − 1)
}

interface AdsConfig {
  placements: AdPlacement[]
}
```

- **Format is fixed per slot**, not chosen by the LLM.
- **Frequency caps are constants per slot** (`popup` and `interstitial`: once per session; `sticky_footer`: until dismissed).
- **Intrusiveness is derived** (count of intrusive placements), shown in the pipeline view.
- **Exit intent** works because judges browse with a real mouse: it fires when the pointer leaves through the top of the viewport.
- **Guideline for intrusive ads:** offer popups and sticky footers suit high `markdown_affinity`; interstitials for new drops suit high `novelty_affinity`; shoppers with low evidence (few add-to-bags) or a strong single-category focus get none. This is guidance in the prompt, not code.

### Rules the validator enforces

- At most one placement per slot; `grid_tile` at most 2 per listing.
- Each ad's `slots` must include the slot it's placed in; each `adId` must exist.
- The `newsletter` ad is removed unless the model's `popups` is `on`. Other intrusive ads are the LLM's choice.
- At most 2 intrusive placements. Extra ones are dropped in this order: `interstitial` first, then `popup`, then `sticky_footer`.
- Caps survive `setLayout` and reset only on a new session (`sessionNonce`). Today `setLayout` re-arms the popup (`storeState.ts:119`); that changes.

### Work

- `lib/ads/catalog.ts`, `lib/ads/types.ts`.
- `<AdSlot slot="…">`: looks up the placement and renders its fixed format.
- Refactor `Hero`, `PromoStrip` and `Popup` to render through `AdSlot`. Replace the compact listing hero in `StoreShell.tsx` with `listing_banner`.
- New: grid tile (in `ProductGrid`), interstitial, sticky footer. Every dismissible ad uses one shared close control.
- `useAdTrigger` hook for delay, scroll depth, exit intent and page count.
- Store events `ad_shown`, `ad_clicked`, `ad_dismissed` for the pipeline log.

**Done when:** a high-`markdown_affinity` profile gets a sale hero, sale grid tiles and an offer popup from the LLM, while a low-evidence profile gets no popup, interstitial or sticky footer.

**Effort:** large (about half of step 1).

---

## Group 3: Content and merchandising

**Now:** the home page renders 4 section types in a configurable order. `rankCatalog` in the frontend's `lib/model/adapter.ts` is a stub; a working version exists in the backend's adapter.

### 3a. Home composition

```ts
type ProductSource =
  | { kind: "for_you" }                              // home.forYouIds
  | { kind: "new_in" }                               // model section row
  | { kind: "bestsellers" }                          // model section row
  | { kind: "sale" }                                 // model section row
  | { kind: "buy_again" }                            // model section row; home.basketIds
  | { kind: "under_price"; max: 50 | 100 | 150 }
  | { kind: "category"; category: Category }
  | { kind: "collection"; collection: CollectionName }

type HomeBlock =
  | { type: "hero" }                                 // renders the hero ad placement
  | { type: "product_row"; source: ProductSource; title?: string; limit: 4 | 8 }
  | { type: "category_tiles"; categories: Category[] }   // 3–6 tiles, in category_order
  | { type: "collection_spotlight"; collection: CollectionName }
  | { type: "editorial_text"; copyKey: "intro" | "story" }
  | { type: "ad_banner"; adId: AdId }

interface HomeConfig {
  blocks: HomeBlock[]         // 3–8 blocks
  heroSize: "full" | "compact"
  forYouIds: string[]         // copied by code
  basketIds: string[]         // copied by code
}
```

Rules:
- **Model section rows keep the model's order.** `new_in`, `sale`, `bestsellers` and `buy_again` rows appear in `section_order`'s relative order. The LLM may drop one, and may place other blocks between them.
- **Category tiles follow `category_order`.**
- **One source of truth for the hero:** no `hero` block means no hero. If present, it must be first. If it has no hero placement, the validator fills in the ad chosen from the model's `hero` decision.
- 3–8 blocks; no two `product_row`s with the same source.
- **No duplicate products across rows:** rows are filled in order, and a product already shown is skipped.
- Every row source except `for_you` and `buy_again` is filtered to `nav.department` when set.
- `product_row.title` follows the copy rules (≤ 32 characters, plain text).
- A `buy_again` row is dropped when `basketIds` is empty.

### 3b. For You page

- New route `app/store/for-you/page.tsx`, listing `home.forYouIds` in order (at most 24).
- Needs a new `ListingMode` (`lib/store/types.ts:75`), plus updates to `modePath`, `baseProducts` in `filtering.ts`, and the title in `ListingView`.
- Wrap it in `<Suspense>` like `app/store/men/page.tsx` (required by `cacheComponents: true`, since `ListingView` uses `useSearchParams`).

### 3c. Listing and product cards

```ts
interface ListingConfig {
  defaultSort: SortOption
  filterOrder: FilterSectionId[]
  expandedFilters: FilterSectionId[]
  gridDensity: 2 | 3 | 4
  colorMerchandising: ColorMerchandising
  colorHighlight: StoreColor[]
  card: {
    priceStyle: "plain" | "sale_emphasis"
    showRating: boolean
    badges: ("new" | "sale" | "bestseller")[]
    quickView: "button" | "emphasized"
  }
}
```

### 3d. Copy

```ts
interface CopyConfig {
  intro?: string            // ≤ 200 chars, editorial_text
  story?: string            // ≤ 400 chars, editorial_text
  adOverrides?: Partial<Record<AdId, { headline?: string; cta?: string }>>  // headline ≤ 40, cta ≤ 20
}
```

- One path for ad and hero text: `adOverrides`, keyed by ad id.
- The validator trims over-length text, strips markup and URLs, and removes any price or percentage that doesn't match the catalog.

**Done when:** two contrasting profiles produce different home pages: different blocks and products, with the model's section rows in the model's order and no product repeated across rows.

**Effort:** medium.

---

## Cross-cutting work

| Task | Files | Notes |
| --- | --- | --- |
| Remove the simulator first | `lib/sim/*`, `GhostCursor`, `TraitEditor`, `PERSONA_LAYOUTS` | Project plan step 0. `runner.ts:182-199` reads `PERSONA_LAYOUTS` and v1 fields; the agent and evidence rules depend on v1 events. Removing them first means the schema change doesn't port code that's about to be deleted. |
| Schema v2 + migration | `lib/layout/types.ts`, `lib/layout/presets.ts` | `DEFAULT_LAYOUT` moves to v2. `PERSONA_LAYOUTS` is gone. Remaining v1 readers (store components, `actions.ts`, `preview.ts`, `PersonaPanel.tsx`) move in one change. |
| Port the backend adapter | `lib/model/adapter.ts`, `lib/model/homepage.ts` | Port from `backend/server/app/lib/model/` on `pb-backend`: `HomepageDoc` type, the `HM_TO_APP_*` tables, `rankCatalog`, and `modelLayout()`, converted to output v2. `modelLayout` is the model layout and the fallback. |
| Validator | `lib/layout/validate.ts` (new) | Add `zod` as a direct dependency (4.6.7 is already in `node_modules` transitively). Parse, fix, report what changed, else fall back to `modelLayout(doc)`, or `DEFAULT_LAYOUT` with no model doc. Assume the LLM provider won't enforce lengths or cross-field rules. |
| Validation everywhere | `lib/store/storeState.ts` | `setLayout` calls the validator. `readEnvelope` (`protocol.ts:103`) only casts the payload. |
| Generated enums | `lib/layout/enums.ts` | `AdId` from the ad catalog, `LayoutFieldPath` from the schema. Discriminated unions convert cleanly to JSON Schema. |
| Design guideline | `lib/layout/guideline.ts`, `docs/design-guideline.md` | See Inputs §3. |
| Preview | `lib/layout/preview.ts`, `PersonaPanel.tsx` | Show default / model / LLM layouts and their reasons. |
| Sample model output | `public/model/` | A `HomepageDoc` from the store scoring path (`build_docs`) with `store_products`, requested from the backend. Not committed today. H&M samples won't work: their products are H&M articles. |
| Tests | New (Vitest) | Validator rules (section order kept, intrusive caps, newsletter gating); ported mapping; "two contrasting profiles give different home rows and nav". |

## Suggested order

0. **Remove the robot cursor and click classifier** (small). Project plan step 0.
1. **Schema v2, validator, `DEFAULT_LAYOUT` migration** (large, but smaller after step 0).
2. **Port the backend adapter to v2: model layout, mapping, `rankCatalog`, `for_you`, department-aware sources** (medium). Needs the sample model output.
3. **Navigation** (small).
4. **Home block composition** (medium).
5. **Ad catalog, `AdSlot`, refactor Hero/PromoStrip/Popup, listing banner** (medium).
6. **Grid tile, interstitial, sticky footer, triggers** (medium).
7. **Copy overrides and card options** (small).
8. **Design guideline generator** (small). Can start any time after step 1.

After step 1, steps 2–4 and steps 5–6 can be built in parallel.

## Out of scope

- Visual style (theme, colours, typography).
- Sponsored ads.
- Real product images.
- The LLM route, persona builder and demo screen. These are other steps of the [project plan](project-plan.md).

## Open questions

1. **Thin men's categories:** some men's categories have only 2–3 products (jeans 2; tshirts, jackets and shoes 3 each). Should the catalog grow, or should single-category rows require at least 4 products?
2. **Ad catalog content:** who writes the ~17 house ads? A first draft can be generated and reviewed.
