# lib/model: personalization from the trained models

Two models drive the store. Training code lives on the `model` branch (folders `model/` and `session_model/`); this folder only holds what the site needs at runtime.

| Model | Knows | When | Output here |
| --- | --- | --- | --- |
| **H&M homepage model** | What the shopper buys (2 years of H&M purchases) | Before the first click | `HomepageDoc` per shopper: sections, categories, colors, sort, banner, filters, tiles, each with a reason |
| **Live session model** (trained on 200k OTTO shoppers) | How the visitor browses right now | After every click | `SessionDecisions`: grid, quick add, compare panel, Recently Viewed, cart reminder, product-page density |

`adapter.ts` merges both into the store's own `LayoutConfig`.

## Files

| File | What it is |
| --- | --- |
| `homepage.ts` | Types for the homepage documents + `loadSampleHomepages()` |
| `sessionStyle.js` / `.d.ts` | Live session model runtime (no dependencies), verified identical to the Python model |
| `adapter.ts` | `modelLayout()`, `rankCatalog()`, `fromStoreEvent()` and the H&M → store category/color maps |
| `public/model/session_model.json` | The trained session model (2.9 MB, load once) |
| `public/model/sample_homepages.json` | 60 real model outputs for local development (ids removed) |

## Usage

```ts
import { loadSampleHomepages } from "@/lib/model/homepage";
import { SessionTracker } from "@/lib/model/sessionStyle";
import { modelLayout, rankCatalog, fromStoreEvent } from "@/lib/model/adapter";

const shoppers = await loadSampleHomepages();               // or one row from Supabase homepages_final
const home = shoppers[0];
const model = await (await fetch("/model/session_model.json")).json();
const tracker = new SessionTracker(model);

// 1. first paint: purchase-based layout
let { layout, categoryOrder, highlightColors, log } = modelLayout(home);
const products = rankCatalog(catalog, home);                // demo catalog ordered by predicted mix

// 2. on every store event: live adjustments
function onStoreEvent(e: StoreEvent) {
  const ev = fromStoreEvent(e);                             // product_viewed / quickview_opened -> click, add_to_bag -> cart
  if (!ev) return;
  const { decisions } = tracker.add(ev);
  ({ layout, log } = modelLayout(home, decisions));         // send layout via the existing set_layout message
}
```

- **`layout`** is a full `LayoutConfig`: it drops into `set_layout` / the preset machinery unchanged. Static mode = `DEFAULT_LAYOUT`.
- **Extras** the `LayoutConfig` type has no field for: `categoryOrder`, `landingDepartment`, `highlightColors`, `comparePanel`, `recentlyViewedProminent`, `cartReminder`, `productPage`.
- **`log`** is one entry per decision `{ key, value, reason, source, evidence }`, made for the Terminal panel. `source` is "H&M model" or "Live session"; `evidence` says whether the decision beat the store default on held-out data.

## What to expect

- **The live model is deliberately slow to act.** Product-page density can switch around 5 clicks, grid and quick add around 10, compare panel and Recently Viewed around 20, cart reminder around 40. Before that, decisions stay at their defaults (`active: false`).
- **When it does switch,** about 70% of the time the visitor really is that type (vs 33% by chance), and only 5 to 12% of the time are they the opposite type. After the next session-model retrain (`python -m session_model all` on the `model` branch, then copy `session_model/web/session_model.json` here), the gate uses accuracy measured on single-visit sessions, like a demo visit.
- **Confirmed on a clean 2019 test** (100k shoppers never used for training or tuning): section order (+0.020 NDCG), color highlight (+4.7 points of next purchases in the highlighted colors, 6,281 shoppers changed) and landing department (+0.002, 265 shoppers).
- **Category order is NOT confirmed** (+0.0007, CI includes 0): `validated` is `false`. Fine to show, but don't present it as a proven gain.
- **Sort** stays bestsellers for everyone, because nothing beat it.
- **Product tiles in `HomepageDoc` are real H&M articles,** not in the demo catalog. Use `rankCatalog` to order the demo catalog; show the H&M tiles only as inspiration, if at all. About 28% of "for you" tiles have `bought_before: true`; hide them with `for_you.filter(t => !t.bought_before)` if the demo should only show new items.
- **Store vocabulary is narrower than H&M's.** Swimwear, underwear and "other" have no demo-store category, and only 9 of 18 H&M colors map to a store color (see the maps in `adapter.ts`).
