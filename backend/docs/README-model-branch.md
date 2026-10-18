# SOCAL ATELIER: shopper models, H&M + OTTO (`model` branch)

This branch holds the training code, results and exports for the two models that personalize the SOCAL ATELIER store:

| Model | Folder | Trained on | Predicts | Drives |
| --- | --- | --- | --- | --- |
| **H&M homepage model** | `model/` | 100,000 H&M shoppers: 37 fused H&M + OTTO values plus 128 purchase-history features | What each shopper buys next | The homepage before the first click: section order, category order, highlighted colors, sort, banner, filters, 12 product tiles |
| **Live session model** | `session_model/` | 200,000 OTTO shoppers' first 3 to 40 events | How the visitor will browse for the rest of the session | Live tweaks after every click: grid density, quick add, compare panel, Recently Viewed, cart reminder, product-page density |

The website runtime that consumes both models is on the **`h&m-and-otto-model`** branch (`lib/model/`).

---

## Contents

- [What's on this branch](#whats-on-this-branch)
- [What was done](#what-was-done)
- [Inputs](#inputs)
- [Outputs](#outputs)
- [Results](#results)
- [Using it in the dynamic UI](#using-it-in-the-dynamic-ui)
- [How it is stored (Supabase)](#how-it-is-stored-supabase)
- [Replicate it on your machine](#replicate-it-on-your-machine)
- [Caveats and rules](#caveats-and-rules)

---

## What's on this branch

| Path | What it is |
| --- | --- |
| `model/` | H&M homepage model: history features, layout models, item ranker, homepage export, Supabase publish ([model/README.md](model/README.md)) |
| `session_model/` | Live session model: OTTO ingest, training, browser runtime ([session_model/README.md](session_model/README.md)) |
| `FUSION.md` | How the 37-value H&M + OTTO fused dataset was built and how good the fusion is |
| `supabase/schema.sql`, `model/schema.sql` | Database tables for the fused dataset and for the model outputs |
| `docs/DATASET.md` | dataset-v1 documentation (the README of the `dataset` branch) |
| `data/`, `src/atelier_data/`, `config/`, `reports/`, `tests/` | The dataset (Git LFS), pipeline, scoring harness and reports this branch builds on |

---

## What was done

1. **Built on the team's datasets:** dataset-v1 (100,000 H&M shoppers, 25-value profiles, leak-free time windows, scoring harness) and the fused dataset (each H&M shopper matched by buying behavior to 50 similar OTTO shoppers, adding 2 bridge values, 9 estimated browsing values and a match confidence).
2. **Added 128 purchase-history features** per shopper (`model/history.py`): activity over 7/30/90/365 days, recency, category, department and color shares over several windows, the same 28-day window one year earlier (seasonality), online share, price percentile, new, sale and rebuy shares. All computed only from purchases before the cutoff.
3. **Trained one LightGBM model per layout decision** (`model/layout.py`), predicting the shopper's next-purchase mix. A seasonality offset makes the trees learn only each shopper's deviation from the store's current mix; without it, summer demand leaked into September and category order lost.
4. **Turned predictions into a layout with tuned margins:** a decision only changes from the store default when the prediction beats the default by a margin tuned on July data.
5. **Trained an item ranker** (`model/items.py`, LightGBM LambdaRank) over about 123 candidate articles per shopper (past buys, other colors, co-purchases, this week's top sellers, top sellers in their favorite segments, new arrivals).
6. **Ran an ablation over 8 feature sets** (H&M 25, + bridge, fused 37, history only, no OTTO, 4- and 8-number compressed profiles) to see what actually carries the signal.
7. **Exported one homepage document per shopper** (`model/export.py`), with a publish step that uploads them to Supabase (`model/publish.py`).
8. **Trained the live session model on OTTO** (`session_model/`): for 200,000 OTTO shoppers it sees only their first N events (N = 3, 5, 10, 20, 40) and predicts their browsing style over their later events, so every number is a real forecast. Exported to the browser with a JavaScript runtime verified identical to Python.

---

## Inputs

### H&M homepage model

| Group | Values | Source file |
| --- | --- | --- |
| H&M profile | 25 (category, department, color, price, sale, newness, rebuy, online, frequency, mainstream) | `data/processed/fused_{dev,final}.parquet` |
| Bridge | 2 (`basket_size`, `activity_spread`) | `fused_{dev,final}` |
| OTTO browsing (estimated) | 9 + `match_confidence` | `fused_{dev,final}` |
| Purchase history | 128 | `model/history.py` from `data/interim/units_{dev,final}.parquet` |
| Labels | Next 4 weeks of purchases | `data/interim/targets_{dev,final}.parquet` |

### Live session model

| Input | Source |
| --- | --- |
| OTTO events: clicks (type 0), carts (1), orders (2) with timestamps | `otto-recsys-train.jsonl` from Kaggle (CC BY 4.0), 12.9M sessions |
| 19 live features from the visitor's events so far (visits, distinct items, revisits, pace, cart rate, decision time ...) | `session_model/features.py`, mirrored in `web/sessionStyle.js` |

**Time windows (H&M):** dev = profiles before 2020-07-29, labels to 2020-08-25 (training and every choice); final = before 2020-08-26, labels to 2020-09-22 (reporting); reserved 2019 window untouched. No age, postal code or customer IDs are used as inputs.

---

## Outputs

### H&M homepage model (`model/work/`, gitignored)

| Path | Contents |
| --- | --- |
| `export/homepages_final.parquet` | Full homepage JSON per shopper (about 7.5 KB each, 100,000 shoppers) |
| `export/homepages_final_compact.parquet` | Compact version for Supabase (tiles as article IDs, about 3.8 KB each) |
| `export/homepage_articles_final.parquet` | The 12,540 articles the tiles reference |
| `layouts/layouts_<set>_{dev,final}.parquet`, `eval_*.json` | Layouts in the scorer's format, with full scores and confidence intervals |
| `layout_results.json`, `item_results.json` | Tuned margins, gains per feature set, ranker metrics |

**One homepage document:** every decision has `value`, `class`, `validated` and `reason`:

| Class | Decisions |
| --- | --- |
| Tested (scored against held-out purchases) | landing_department, category_order, section_order, default_sort, color_highlight |
| Estimated (OTTO browsing) | grid_columns, recently_viewed, compare_panel, cart_reminder |
| Assumed (rules) | price_filter_first, filter_order, hero |
| Based on your settings | popups (newsletter consent) |

Plus `predicted_mix` (predicted share of next purchases per category, department and section), `browsing` (estimated browsing style) and `products` (12 "for you" tiles plus rows per category).

### Live session model (`session_model/web/`)

| File | Contents |
| --- | --- |
| `session_model.json` (2.9 MB) | Trees for 7 browsing-style values, held-out R² table, UI policy |
| `sessionStyle.js` | Browser runtime (no dependencies): `SessionTracker.add(event)` returns `{ style, decisions }` |
| `fixtures.json`, `check.mjs` | Proof that the JavaScript runtime matches Python |

Each session decision is `{ value, active, reason }`:

| Decision | Values | Driven by |
| --- | --- | --- |
| `grid_columns` | 2, 3, 4 | exploration |
| `compare_panel` | on / off | comparison |
| `recently_viewed` | prominent / default | multi-visit research |
| `quick_add` | on / off | decision speed |
| `cart_reminder` | on / off | high click-to-cart and low cart-to-order |
| `product_page` | compact / standard / detailed | browsing pace |

---

## Results

### H&M homepage model (final window, settings frozen on dev)

| Decision | Store default | Model | Gain (95% CI) | Validated |
| --- | --- | --- | --- | --- |
| Section order (ranking quality) | 0.835 | 0.861 | +0.026 [+0.025, +0.028] | yes |
| Category order (ranking quality) | 0.821 | 0.825 | +0.004 [+0.003, +0.006] | yes |
| Color highlight (share of next purchases) | 0.450 | 0.511 | +0.061 [+0.052, +0.070] | yes |
| Landing department | 0.626 | 0.626 | 4 shoppers changed | no |
| Default sort | 0.866 | 0.866 | bestsellers kept for everyone | no |
| Product tiles (MAP@12) | 0.0047 (popular this week) | 0.0180 | about 3.8x | |

**Findings:**
- **The 25 H&M values carry most of the signal.** History adds a little.
- **OTTO browsing values add nothing measurable to the tested layout decisions** (fused 37 is about equal to H&M without OTTO). They are kept for the browsing-based UI choices, which are labelled Estimated.
- **Compact profiles keep much of the value:** 4 numbers keep about 90% of the color gain, 40% of the section gain and 35% of the category gain.
- **Women stays the landing page and bestsellers stays the sort:** even shoppers with mostly menswear history put 58% of their next purchases in Ladieswear (shared household accounts).

### Live session model (held-out OTTO shoppers, R² of the predicted browsing style)

| Style value | 3 events | 10 events | 40 events | From 2 years of purchases (fusion) |
| --- | --- | --- | --- | --- |
| Click-to-cart | 0.09 | 0.21 | **0.40** | 0.03 |
| Browsing pace | 0.09 | 0.21 | **0.39** | 0.07 |
| Exploration | 0.06 | 0.14 | **0.30** | 0.23 |
| Decision speed | 0.05 | 0.13 | **0.25** | 0.04 |
| Comparison | 0.02 | 0.06 | **0.18** | 0.00 |
| Multi-visit research | 0.03 | 0.09 | **0.18** | 0.13 |
| Cart-to-order | 0.01 | 0.03 | **0.12** | 0.07 |

- **A visitor's own clicks beat years of someone else's purchases** at predicting how they browse: by 40 events, every style value is predicted better live than through the fusion.
- **Decisions switch on only once R² reaches 0.10** for that value at that many events: product-page density around 5 clicks, grid and quick add around 10, compare panel and Recently Viewed around 20, cart reminder around 40.
- Test split: 139,898 training, 20,000 validation and 40,102 test shoppers.

---

## Using it in the dynamic UI

The runtime lives on the `h&m-and-otto-model` branch (`lib/model/`). The flow:

1. **First paint:** load the shopper's homepage document (Supabase `homepages_final`) and call `modelLayout(home)`. The store opens arranged for them.
2. **Every click:** feed the event to `SessionTracker`; once a session decision is `active`, it replaces the matching Estimated field. Tested decisions stay purchase-driven.
3. **Explain it:** every decision carries a `reason` for a "Why am I seeing this?" panel or the Terminal.

```ts
const { data } = await supabase.from("homepages_final").select("homepage").eq("customer_key", key).single();
let { layout, log } = modelLayout(data.homepage);              // purchase-based first paint
const { decisions } = tracker.add({ ts: Date.now() / 1000, aid: productId, type: 0 });
({ layout, log } = modelLayout(data.homepage, decisions));     // live adjustments
```

---

## How it is stored (Supabase)

| Table | Key | Contents | Created by |
| --- | --- | --- | --- |
| `fused_dev`, `fused_final` | `customer_key` | The 37 fused values plus evidence columns, 100,000 rows each | `supabase/schema.sql`, `python -m atelier_data.cloud upload` |
| `targets_dev`, `targets_final` | | Held-out purchases (labels) | same |
| `homepages_final` | `customer_key` | `stratum`, `homepage` (jsonb, compact homepage document), 100,000 rows | `model/schema.sql`, `python -m model publish` |
| `homepage_articles` | `article_id` | Name, category, department, color, scaled price for the 12,540 tile articles | same |
| Storage bucket `atelier` (private) | | The Parquet files, for whole-file downloads | `python -m atelier_data.cloud` |

- **Access:** row-level security on every table. Signed-in team members read; only the project owner's service-role key writes.
- **Keys:** copy `.env.example` to `.env`. Teammates fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY` and the login the owner created; only the owner sets `SUPABASE_SERVICE_ROLE_KEY`, and it never goes in browser code.
- **Size:** about 385 MB raw for 100,000 compact homepages before Postgres compression.
- **Download the dataset instead of using LFS:** `python -m atelier_data.cloud download` (or one file, e.g. `download fused_dev`).

---

## Replicate it on your machine

### 1. Requirements

- Python 3.12, Git with Git LFS, Node.js 22+ (for the browser-runtime check).
- About 16 GB of disk for the H&M data, plus about 15 GB more for OTTO (session model only). 16 GB of RAM recommended.
- Accept the [H&M competition rules](https://www.kaggle.com/competitions/h-and-m-personalized-fashion-recommendations/rules); the OTTO data is CC BY 4.0.

### 2. Get the code and data

```bash
git lfs install
git clone --branch model --single-branch https://github.com/AnselZeng/la-hacks.git atelier-model
cd atelier-model
```

Or clone with `GIT_LFS_SKIP_SMUDGE=1` and download the data from Supabase (`python -m atelier_data.cloud download`, needs the keys in `.env`).

### 3. Set up Python

macOS / Linux:

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && pip install -e .
pip install -r model/requirements.txt -r session_model/requirements.txt
```

Windows (PowerShell or cmd):

```bat
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt && pip install -e .
pip install -r model\requirements.txt -r session_model\requirements.txt
```

Optional, with 16 GB+ of RAM: `set ATELIER_DUCKDB_MEM=8GB` (bash: `export ATELIER_DUCKDB_MEM=8GB`).

### 4. H&M homepage model

```bash
python -m model all                 # history -> layouts -> items -> export (about 20 min on 2 cores)
python -m pytest model/tests        # unit tests
python -m atelier_data score --layouts model/work/layouts/layouts_f37_hist_final.parquet --cutoff final
python -m model ablation            # the 8 feature sets (about 30 min, optional)
python -m model publish             # project owner only: upload to Supabase (run model/schema.sql once first)
```

### 5. Live session model

```bash
python -m session_model smoke                       # 10-second check on synthetic data
python -m session_model all                         # download OTTO (Kaggle key in .env) -> train -> export
node session_model/web/check.mjs                    # JS runtime == Python
python -m session_model demo                        # how the page adapts for three example visitors
```

Add `--sample 50000` for a faster first run. The Kaggle key goes in `.env` as `KAGGLE_USERNAME` and `KAGGLE_KEY`.

### 6. Check your numbers

Results should match the tables above, `model/work/layout_results.json`, `model/work/item_results.json` and `session_model/work/report.json`.

---

## Caveats and rules

- **The final window was viewed before the seasonality fix,** so final category-order numbers are reported results, not a clean test. The 2019 reserved window is the clean test and is untouched.
- **Dev numbers are slightly optimistic:** margins were tuned on the same out-of-fold predictions they are reported on.
- **Browsing values in the fused dataset are estimates** from behaviorally similar OTTO shoppers, not observed for the H&M shopper. Purchase labels can't validate browsing-based choices.
- **OTTO shoppers with 60+ events are more engaged than an average visitor;** state this when reporting session-model results.
- **Keep the data private:** H&M data is non-commercial academic use only; never push it or the model outputs anywhere public. Never commit `.env`.
- No causal claims (offline replay, not an A/B test) and no anonymity claims about shopper profiles.
