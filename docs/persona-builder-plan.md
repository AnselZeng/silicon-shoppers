# Persona builder plan (work plan step 2)

Status: proposal, revision 1 · Last updated: 2026-10-17

This is the detailed plan for step 2 of the [project plan](project-plan.md): the persona builder. The judge sets a few sliders, gets a basket of store products, edits it by hand if they want, and that basket is what the model scores in step 3. Other steps are only covered where they affect the persona or the basket.

Step 2 needs nothing from step 1 ([layout-expansion-plan.md](layout-expansion-plan.md)) and can run alongside it. It touches `lib/personas/`, `lib/state/personaStore.ts` and the persona half of the shell, not the store or the layout schema.

## Decisions so far

| Question | Decision |
| --- | --- |
| What a persona is | **A shopping profile plus a basket.** The profile (sliders) generates the basket. The basket is what leaves the browser. |
| Old behaviour traits | **Removed.** Price sensitivity, max budget, novelty and department preference are replaced by the new profile. Old saved/exported personas are migrated, not rejected. |
| Determinism | **Same profile + same seed = same basket.** A "Reroll" button changes the seed, nothing else does. |
| Hand edits | **Kept across slider changes.** Products added by hand are pinned, products removed by hand are excluded. The generator fills the rest. |
| Basket size | **3–20, default 12.** Below 10 the builder warns that the model won't change the landing department (project plan, step 3). |
| Where personas live | **Browser only** (`localStorage`), plus JSON export/import. No backend storage. |
| Cached demo profiles | **Built-in presets are personas like any other**, with a pinned basket and a link to their cached model and LLM output (filled in by steps 3 and 4). |

## What the model actually reads from a basket

The generator should only control things the model can see. From `backend/server/catalog.py` and `score.py` on `origin/pb-backend`, each basket item becomes an add-to-bag event, and the model reads, per item:

| Store field | What the model sees | Consequence for the builder |
| --- | --- | --- |
| `category` | H&M product group (`APP_TO_HM_CATEGORY`) | Upper body covers 5 store categories, so "shirts vs. knitwear" is invisible to the model. |
| `department` | Ladieswear / Menswear | The men/women slider is the main lever for landing department. |
| `salePrice` present | On markdown | Sale share is read directly. |
| `isNew` | New flag | New-arrival share is read directly. |
| effective price | **Price percentile within the H&M group**, not the absolute price | "Price level" must be a within-group percentile, computed the same way (`percent_rank` over effective price per group), or the slider and the model disagree. |
| chosen colour | H&M master colour of **the colour picked for that item**; the first listed colour if none is sent | Each basket item carries a chosen colour. `cream → White` and `camel → Beige` merge on the model side. |
| event day | Events are grouped per (day, product, colour), capped at 3 | Each item carries a purchase day. No duplicate items in one basket. |
| popularity | Popularity percentile | Not a slider. The generator mildly prefers popular items so baskets look realistic. |

## Catalog limits

The 84-product catalog (`lib/store/catalog.ts`) is small and uneven. The generator has to deal with this honestly instead of pretending every slider combination is possible.

| | Women | Men |
| --- | --- | --- |
| Products | 52 | 32 |
| On sale | 15 | **7** |
| New | 18 | **9** |
| Sale and new | 8 in total | |

Effective prices run from 22 to 240 (median 106). Colours with fewest products: beige (9), cream (11), olive (12).

So a 20-item basket that is 100% menswear and 100% sale can't exist. The generator fills what it can, then relaxes the constraint with the least weight (see "Generator"), and reports what it got, e.g. "Sale 35% (asked 100%): only 7 men's sale products exist."

## Data model

Replaces `PersonaTraits`, `PersonaId`, `DepartmentPref`, `PERSONA_LABEL` and `isPersonaId` in `lib/personas/schema.ts`. Defined with zod so import, `localStorage` and tests share one parser.

```ts
/** Slider values. All shares are 0–100. */
interface PersonaProfile {
  menShare: number        // share of basket items from menswear
  saleShare: number       // share bought on markdown
  newShare: number        // share that were new arrivals
  priceLevel: number      // target price percentile within the H&M group (0 = cheapest, 100 = priciest)
  colors: StoreColor[]    // 0–3 favourite colours
  basketSize: number      // 3–20
  seed: number            // changed only by Reroll
}

interface BasketItem {
  productId: string
  color: StoreColor       // one of the product's colours
  daysAgo: number         // purchase day, 0 = today
}

interface BasketEdits {
  pinned: BasketItem[]    // added by hand; always in the basket
  excluded: string[]      // product ids removed by hand; never generated
}

interface Persona {
  version: 2
  id: string
  name: string
  note?: string           // one line shown under the name
  preset: boolean         // built-in; can be reset, not deleted
  profile: PersonaProfile
  edits: BasketEdits
  /** Cached model + LLM output for this exact basket (steps 3 and 4). */
  cache?: { profileId: string; basketKey: string }
}

/** Result of the generator. Derived, never stored on its own. */
interface GeneratedBasket {
  items: BasketItem[]
  achieved: { menShare: number; saleShare: number; newShare: number; priceLevel: number; colorShare: number }
  notes: string[]         // shortfalls and warnings, in plain words
  key: string             // stable hash of the items, used to match cached output
}
```

The basket is **derived** from `profile` + `edits` by the generator (memoised in a selector), not stored. That keeps one source of truth. Exports include the derived basket as well, so the exact basket can be reproduced even if the catalog or the generator changes later.

`SORT_OPTIONS`, `SortOption` and `SORT_LABEL` are store concepts that happen to live in `lib/personas/schema.ts`. They move to `lib/store/sorting.ts` first (nine importers, mechanical change), so the persona module only holds persona code.

## Generator

`lib/personas/generate.ts`, pure and deterministic: `generateBasket(profile, edits, catalog = PRODUCTS): GeneratedBasket`. Uses `mulberry32(profile.seed)` from `lib/sim/rng.ts` (move it to `lib/rng.ts` if step 0 removes `lib/sim/`).

1. **Start from pins.** Pinned items go in first, in order. If there are more pins than `basketSize`, the basket is just the pins and a note says so.
2. **Department quotas.** Split the remaining slots with largest-remainder rounding: `round(remaining × menShare / 100)` men, the rest women. If a department runs out of candidates, the leftover slots move to the other department and a note is added.
3. **Attribute targets per department.** Target counts for sale and new in each department, again by largest remainder over the whole basket (pins count towards them).
4. **Greedy fill.** For each empty slot, score every candidate in that department that isn't already picked or excluded:

   ```
   score = 3·saleFit + 3·newFit + 2·priceFit + 1.5·colorFit + 0.5·popularity + 0.3·jitter
   ```

   - `saleFit` / `newFit`: 1 if the product has the attribute the remaining quota still needs (or lacks it when the quota is full), else 0.
   - `priceFit`: `1 − |pricePercentile − priceLevel| / 100`.
   - `colorFit`: 1 if the product comes in a favourite colour, else 0 (0.5 for everything when no favourites are set).
   - `popularity`: catalog popularity / 100.
   - `jitter`: seeded random in [0, 1), so rerolls give different but equally good baskets.

   Pick the highest score, update the running counts, repeat. The weights mean sale and new quotas give way before price, and price before colour, when the catalog can't satisfy all of them.
5. **Colour per item.** The first favourite colour the product comes in; otherwise its first listed colour (the same fallback the backend uses).
6. **Purchase days.** Spread items over the last 56 days, evenly with seeded jitter. An item can't be bought before it was created (`createdAt`), so new-arrival items land in the recent days. Pins keep their own `daysAgo`.
7. **Report.** Compute the achieved shares and price level, and add a note for any target more than 15 points off, naming the cause from the table above.

`pricePercentile` lives in `lib/personas/pricing.ts`: for each H&M group, `percent_rank` of effective price among store products in that group, computed once at module load. It mirrors `catalog.py` so the slider and the model measure the same thing. A test compares a few values against numbers taken from the Python side.

## Persona store

`lib/state/personaStore.ts` is rewritten around the new model and keeps the actions the shell already uses.

| Action | Behaviour |
| --- | --- |
| `select(id)` | Unchanged. |
| `updateProfile(id, patch)` | Clamps values to their ranges. Clears `cache` if the basket key changes. |
| `reroll(id)` | New seed from `Date.now()`. Pins and exclusions are kept. |
| `pin(id, productId, color?)` / `unpin` | Add by hand, or undo it. Pinning also removes the product from `excluded`. |
| `exclude(id, productId)` | Remove by hand. If the item was pinned, unpin instead. |
| `setItemColor(id, productId, color)` | Pins the item with that colour, so the choice sticks. |
| `clearEdits(id)` | Back to a purely generated basket. |
| `create()` | New custom persona from a neutral profile (50/50, 20% sale, 30% new, price 50, 12 items). |
| `duplicate(id)` / `rename` / `remove` | As today. Presets can't be removed, only reset. |
| `resetOne(id)` / `reset()` | As today, against the new presets. |
| `exportPersona(id)` | JSON with the persona **and** its derived basket. |
| `importPersona(raw)` | Parses v2, or migrates v1 (below). Ids that clash get a suffix, as today. |

**Persistence:** zustand `persist` with `localStorage` key `silicon-shoppers.personas`, `version: 2`, saving `personas` and `selectedId`. Reads and writes go through try/catch, and the store falls back to the presets when storage is empty or blocked. Presets are always re-read from code, so a code update to a preset reaches judges who already opened the demo, unless they edited it.

**v1 migration** (stored state and imported files): `preferredDepartment` women/men/both → `menShare` 10/90/50, `priceSensitivity` → `saleShare` (same value, capped at 80), `noveltySeeking` → `newShare`, `maxBudget` → `priceLevel` (20→10, 400→95, linear), `colorPreference` → first three `colors`, basket size 12, seed from the id's hash. Lossy, but it gives a sensible persona rather than an error.

## Presets

The four old personas (price hunter, trend seeker, mission shopper, brand loyalist) describe behaviour the model can't read. They're replaced by presets written in terms the model *does* read, matching the fixture shoppers in `public/model/fixtures/` so that step 3's cached output lines up:

| Preset | menShare | sale | new | price | colours | size | Expected model effect |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Menswear sale buyer | 90 | 70 | 10 | 25 | black, navy, grey | 12 | Men first, discount hero, Sale row high |
| Womenswear new-arrival buyer | 5 | 10 | 75 | 70 | black, burgundy, camel | 14 | Women first, new-drop hero, dresses up the category order |
| Young budget womenswear (Divided) | 0 | 55 | 30 | 15 | black, white, navy | 11 | Women first, lower body high, low price filter first |
| Premium mixed | 45 | 0 | 25 | 90 | black, cream, navy | 12 | Close split, editorial hero, high-price sort |
| Low-evidence shopper | 50 | 20 | 30 | 50 | none | 3 | Stays near the store average; shows the <10 warning |

Each preset is profile + seed, plus hand pins where a preset needs a specific product (for example the season-launch puffer for the new-arrival buyer). A snapshot test pins each preset's generated basket, so a catalog or generator change that would silently invalidate cached model output fails CI instead. When the hand-written fixtures are replaced with real model output in step 3, they're regenerated from these baskets, and `index.json`'s `basket` field is read from the preset rather than written by hand.

Which presets to ship is the project plan's open question 2. The table is a proposal; five is about what a judge will click through.

## Shell UI

The persona half of `PersonaPanel.tsx` and all of `TraitEditor.tsx` are replaced. The panel is about 450 × 440 px on a 1280-wide screen, so the builder uses tabs (`components/ui/tabs.tsx`) instead of one long scroll.

```
┌ Personas ─────────────────────────────────────┐
│ [Menswear sale] [Women new-in] [Divided] [+]  │  chips; preset or "Custom" label
├───────────────────────────────────────────────┤
│ Menswear sale buyer ✎      Duplicate Export … │
│ ┌ Profile ┬ Basket (12) ┐                     │
│ │ Women ───────●── Men            90% men     │
│ │ Sale buys ─────●──────          70% → 58%   │  target → achieved
│ │ New arrivals ●─────────         10%         │
│ │ Price level  ──●───────         Budget      │
│ │ Colours  ● ● ● ○ ○ ○ ○ ○ ○ ○                 │
│ │ Basket size ───●───            12 items     │
│ │ ⚠ Only 7 men's sale products exist.         │
│ │ [Reroll]                                    │
└───────────────────────────────────────────────┘
```

**Profile tab** (`components/shell/persona/ProfileEditor.tsx`): the sliders above, reusing `SliderRow` from `TraitEditor`. Each shows the target and, when different, the achieved value. Price level shows a word (Budget / Mid / Premium) next to the number. Notes from the generator appear under the sliders. A basket under 10 items gets a persistent warning.

**Basket tab** (`components/shell/persona/BasketEditor.tsx`): one compact row per item: small `GarmentImage`, name, department letter, price (sale price struck through), Sale / New badges, colour swatches (click to change the chosen colour), a pin icon for hand-added items, and a remove button. Above the list: "Add product" opens `ProductPicker.tsx`, a searchable list of the 84 products filtered by name and department, with already-picked and excluded products marked. "Clear edits" appears when there are any.

Slider changes regenerate the basket immediately; the generator runs in well under a millisecond on 84 products, so no debounce is needed beyond the slider's own events. Changes go to the log as `persona` lines (`basket regenerated · 12 items · 58% sale`), which step 5's pipeline log will reuse.

The layout preview half of `PersonaPanel.tsx` (default / fixture / model / LLM) is step 1's and is left alone. To avoid editing the same file as step 1, the first UI commit splits `PersonaPanel.tsx` into `LayoutPreviewSection.tsx` and `PersonaSection.tsx`, with no behaviour change.

`PERSONA_ACCENTS` and `UI_CONFIG.loyalistCollection` in `config/ui.ts` go away. Presets get a neutral accent; custom personas get one from a small palette by index.

## Handoff to step 3

Step 2 ends at a typed request; step 3 sends it.

```ts
// lib/personas/request.ts
interface ScoreRequest {
  shopper_id: string                 // persona id
  basket: { product_id: string; color: StoreColor; days_ago: number }[]
}
export function toScoreRequest(persona: Persona, basket: GeneratedBasket): ScoreRequest
```

The backend turns each line into an `add_to_bag` event with the given colour and timestamp, so the direct endpoint can reuse `units_from_events` and `build_docs` unchanged. This shape needs confirming with the `pb-backend` owner (see open questions); everything else in step 2 doesn't depend on it.

The basket ids are also what layout validation copies into `home.basketIds` (layout plan, "Code copies data"). Until steps 3–5 land, the preview keeps using the fixture baskets.

## Work order

Each step is one commit with its tests.

| # | Change | Files |
| --- | --- | --- |
| 2.0 | Move sort constants out of the persona module | `lib/personas/schema.ts` → `lib/store/sorting.ts`, 9 importers |
| 2.1 | Persona v2 schema (zod), v1 migration | `lib/personas/schema.ts`, `lib/personas/migrate.ts` |
| 2.2 | Price percentile and generator | `lib/personas/pricing.ts`, `lib/personas/generate.ts` |
| 2.3 | Presets | `lib/personas/presets.ts` (replaces `defaults.ts`) |
| 2.4 | Persona store: new actions, persistence, import/export | `lib/state/personaStore.ts` |
| 2.5 | Split `PersonaPanel`; profile tab, basket tab, product picker; delete `TraitEditor` | `components/shell/PersonaPanel.tsx`, `components/shell/persona/*` |
| 2.6 | Score request builder | `lib/personas/request.ts` |

2.0–2.4 have no UI and can be reviewed on tests alone. 2.5 is the only commit that touches files near step 1's work.

## Tests

In `lib/personas/*.test.ts` (vitest, as for the layout code):

- **Determinism:** same profile and seed give the same basket and key; a different seed gives a different basket.
- **Quotas:** for feasible profiles, department, sale and new counts are within ±1 of target.
- **Scarcity:** 100% men, 100% sale, 20 items fills 20 items, gets 7 sale items, and returns a note naming the shortfall. A tiny fake catalog (or heavy exclusions) checks the path where a department runs out and its slots move to the other one.
- **Edits:** pins are always present with their colour and day; excluded ids never appear; more pins than `basketSize` returns just the pins and a note.
- **Item validity:** no duplicate products; every colour is one of the product's colours; every `daysAgo` is ≥ 0 and on or after the product's `createdAt`.
- **Price percentile:** matches values computed by `catalog.py` for a handful of products.
- **Presets:** snapshot of each preset's basket key.
- **Migration:** each old preset migrates to a valid v2 persona; garbage input returns an error, not a throw.
- **Store:** `updateProfile` clears a stale cache link; reset restores presets; persisted state round-trips.

Manual check in the shell: move each slider end to end and watch the basket and notes update; add, recolour and remove items, then move a slider and confirm the edits survive; reload and confirm the persona is still there; export, delete, import.

## Open questions

1. **Request shape:** does the direct scoring endpoint (step 3) accept per-item colour and purchase day, as above? If it takes bare product ids, colour and price-level effects become weaker and the plan drops `color`/`daysAgo` from the request (they stay in the basket for display).
2. **Category control:** the project plan's slider list has no category control, so the model's category order (a validated, visible decision) mostly follows what the catalog happens to offer. Add a "favourite categories" chip row (by H&M group: tops, bottoms, dresses, shoes, bags)? Cheap to add to the generator as another `fit` term. Recommended.
3. **Presets:** which five (project plan open question 2).
4. **Add-to-bag or purchase:** the backend counts `add_to_bag`, `purchase` and `checkout` alike (`CARTS` in `score.py`). The UI says "basket"; confirm the backend doesn't need to know which.
