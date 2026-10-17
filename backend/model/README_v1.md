# Shopper model: next-purchase predictions that drive the homepage

Everything for the model lives in this folder. It builds on the `atelier_data` package (the dataset pipeline and scoring harness) from the repo root.

One model predicts what each of the 100,000 cohort shoppers buys next, from the 37 fused H&M + OTTO values plus leak-free purchase-history features. A policy turns the predictions into a homepage: landing department, category order, section order, default sort, color highlight and 12 product tiles. Every tested decision is scored with the repo's own harness against the store defaults.

---

## TL;DR (final window, scored once with settings frozen on dev)

| Decision | Store default | Model | Gain (95% CI) | Validated |
| --- | --- | --- | --- | --- |
| Category order (NDCG) | 0.821 | 0.825 | +0.0041 [+0.0027, +0.0055] | yes |
| Section order (NDCG) | 0.835 | 0.861 | +0.0262 [+0.0245, +0.0278] | yes |
| Color highlight (share of next purchases) | 0.450 | 0.511 | +0.0612 [+0.0519, +0.0699] | yes |
| Landing department (share) | 0.626 | 0.626 | −0.0003 (4 shoppers changed) | no |
| Default sort (position) | 0.866 | 0.866 | 0 (bestsellers kept for everyone) | no |
| Product tiles (MAP@12) | 0.0047 (popular this week) | **0.0178** | about 3.8× | |

- The v1 hand-written rules lost to the defaults on every decision; this model beats them on category, section and color, on both dev and final.
- Category Hit@3 on final: 0.903 vs 0.887.
- Section order gains grow with history: +0.015 for light shoppers, +0.031 for heavy (both CIs above zero).
- The model keeps Ladieswear and the bestsellers sort for nearly everyone because the data says to (see Findings).

---

## Running it locally

All commands run from the **repo root** (`D:\Hackathon\atelier-dataset`). Outputs go to `model/work/` (gitignored).

### 1. One-time setup

PowerShell (Windows, with Anaconda):

```powershell
cd D:\Hackathon\atelier-dataset
conda create -n atelier python=3.12 -y      # the repo needs Python 3.11 or 3.12
conda activate atelier
pip install -r requirements.txt
pip install -e .
pip install -r model\requirements.txt
```

macOS / Linux:

```bash
cd atelier-dataset
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && pip install -e . && pip install -r model/requirements.txt
```

### 2. Check the data is there

The model reads these files (all on the `dataset-fusion` branch through Git LFS):

| File | Used for |
| --- | --- |
| `data/processed/fused_{dev,final}.parquet`, `cohort.parquet`, `profiles_{dev,final}_Eall.parquet` | Inputs, cohort, scoring |
| `data/interim/units_{dev,final}.parquet`, `targets_{dev,final}.parquet` | History features, labels |
| `data/processed/references_{dev,final}/`, `vocabularies.json`, `rules_frozen.json` | Article tables, defaults, scoring |
| `data/ingested/articles.parquet`, `transactions.parquet` | Article metadata; scoring harness only |
| `data/processed/representations/{dev,final}/Eall_D{4,8}_pca_float32.parquet` | Only for the `pca4` / `pca8` ablation rows |

If anything is missing: `git lfs pull --include="data/interim/*,data/processed/*,data/ingested/*"`.

### 3. Size DuckDB to your machine (optional)

Defaults are 4 GB and all CPU cores. With 16 GB+ of RAM:

```powershell
$env:ATELIER_DUCKDB_MEM = "8GB"     # bash: export ATELIER_DUCKDB_MEM=8GB
$env:ATELIER_DUCKDB_THREADS = "8"   # bash: export ATELIER_DUCKDB_THREADS=8
```

### 4. Run

```bash
python -m model --help                     # list of commands

# everything for the shipped model, in order (~20 min on 2 cores, much less on a laptop with more)
python -m model all

# or step by step
python -m model history                    # purchase-history features, both cutoffs (~10 s)
python -m model layouts --final            # layout models: train, tune on dev, score dev + final (~6 min)
python -m model items --final              # item ranker: dev MAP@12, then tiles for all 100k shoppers (~10 min)
python -m model export                     # one homepage JSON per shopper (~1 min)
```

Paper experiments:

```bash
python -m model ablation                   # all 8 feature sets, dev + final (~30 min)
python -m model layouts --sets h25,pca4    # any subset: f37_hist, h25, h27, f37, hist, h27_hist, pca4, pca8
python -m model items --item-drop u_exploration,u_multi_visit_research,u_match_confidence --tag _no_otto
```

Check and score:

```bash
python -m pytest model/tests                                         # unit tests (no data needed)
python -m pytest model/tests -m "integration or not integration"     # + checks on the built outputs
python -m atelier_data score --layouts model/work/layouts/layouts_f37_hist_final.parquet --cutoff final
```

Upload to Supabase (project owner, needs `SUPABASE_SERVICE_ROLE_KEY` in `.env`; run `model/schema.sql` once first):

```bash
python -m model publish
```

### What each step writes (`model/work/`)

| Path | Contents |
| --- | --- |
| `history_{dev,final}.parquet` | 128 history features per shopper |
| `layout_results.json` | Tuned margins and dev/final gains per feature set |
| `layouts/layouts_<set>_{dev,final}.parquet` | Layouts in the scorer's format |
| `layouts/eval_<set>_{dev,final}.json` | Full scorer output (CIs, per history group, population-weighted) |
| `pred_<set>.npz` | Raw model predictions (used by export) |
| `item_results.json`, `item_ranker.txt` | Ranker metrics, feature importance, trained model |
| `item_scores_final.parquet` | Top 48 scored tiles per shopper |
| `export/homepages_final.parquet` | Full homepage JSON per shopper (about 7.5 KB each) |
| `export/homepages_final_compact.parquet`, `export/homepage_articles_final.parquet` | Compact version for Supabase |

## Files in this folder

| File | What it does |
| --- | --- |
| `__main__.py` | The `python -m model` command line |
| `common.py` | Config (DuckDB sizing), cohort, fused vectors, column groups, folds |
| `history.py` | Leak-free purchase-history features from `units_{cut}` |
| `layout.py` | Layout models (LightGBM per decision), seasonality offset, policy turning predictions into layouts |
| `items.py` | Item candidates, ranker features, LambdaRank model, MAP@12 |
| `run.py` | Training, cross-validation, margin tuning, scoring for layouts and items |
| `export.py` | Homepage JSON per shopper (same format as `artifacts/frontend/shoppers.json`) |
| `publish.py`, `schema.sql` | Supabase tables and upload |
| `tests/test_model.py` | Unit tests plus integration checks on outputs |

---

## Inputs

| Group | Columns | Source |
| --- | --- | --- |
| H&M profile | 25 values (category, department, color, price, markdown, novelty, rebuy, online, frequency, mainstream) | `fused_{cut}` |
| Bridge | `basket_size`, `activity_spread` | `fused_{cut}` |
| OTTO browsing | 9 estimated values + `match_confidence` | `fused_{cut}` |
| Purchase history | 128 columns: units and shopping days over 7/30/90/365 days, days since last purchase, raw category/department/color shares over 30d/90d/last day/all, the same 28-day window one year earlier (seasonality), online share, price percentile, new/sale/rebuy shares | `model/history.py` from `units_{cut}` |

- Every feature uses only purchases before the cutoff (units files are already cut off; a test checks nothing is on or after the cutoff day).
- No age, postal code or customer IDs are used.

## Model

| Decision | What is predicted | Model | Policy |
| --- | --- | --- | --- |
| Category order | Share of next units per category (8) | LightGBM multiclass on share-weighted rows | Sort by predicted share |
| Landing department | Share per department (5) | LightGBM multiclass | Switch from Ladieswear only if the top department beats it by a margin |
| Section order | Share of next units that are New In / Sale / Bestsellers / Buy Again | 4 LightGBM cross-entropy regressions | Sort by predicted share |
| Default sort | Mean position of next purchases under each sort | 3 LightGBM regressions | Switch from bestsellers only if a sort is predicted better by a margin |
| Color highlight | Share per master color (18) | LightGBM multiclass | Highlight the top 2 only if they beat the store's top 2 colors by a margin |
| Product tiles | Whether a candidate article is bought in the next 28 days | LightGBM LambdaRank | Top 12, one per display name |

- **Seasonality fix.** The multiclass models are trained with the training window's population mix as a fixed offset, so the trees learn only each shopper's deviation. At serving time the deviation sits on top of the store's popularity prior at that cutoff (the same prior the default layout uses). Without this, the model carried late-summer demand (swimwear) into September and category order lost on final (−0.008).
- **Margins** are tuned on dev out-of-fold predictions only, one knob per decision, maximizing total gain.
- **Training:** dev-window buyers (11,434), 5-fold cross-validation balanced by history group; final-window predictions come from models fit on all dev buyers, applied to final-cutoff features.
- **Item candidates** (about 123 per shopper, covering 9% of purchased pairs): items bought before, other colors of recent products, same-day co-purchases of recent items, this week's top 40, top sellers in the shopper's top 4 (department, category) segments, and new arrivals in their top 2 departments.

## Ablation (gain vs store default; * = CI above zero on changed shoppers)

| Feature set | Values | Dev cat | Dev sec | Dev color | Final cat | Final sec | Final color |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **f37 + history (shipped)** | 165 | +0.0067* | +0.0139* | +0.0698* | +0.0041* | +0.0262* | +0.0612* |
| H&M 25 | 25 | +0.0063* | +0.0130* | +0.0720* | +0.0036* | +0.0242* | +0.0572* |
| H&M 25 + bridge | 27 | +0.0066* | +0.0126* | +0.0676* | +0.0042* | +0.0247* | +0.0600* |
| Fused 37 | 37 | +0.0065* | +0.0125* | +0.0671* | +0.0042* | +0.0243* | +0.0570* |
| History only | 128 | +0.0072* | +0.0139* | +0.0678* | +0.0043* | +0.0258* | +0.0619* |
| H&M 27 + history (no OTTO) | 155 | +0.0077* | +0.0142* | +0.0735* | +0.0040* | +0.0264* | +0.0639* |
| PCA, 4 numbers | 4 | +0.0002 | +0.0072* | +0.0623* | +0.0015* | +0.0104* | +0.0540* |
| PCA, 8 numbers | 8 | +0.0029* | +0.0110* | +0.0609* | +0.0028* | +0.0097* | +0.0519* |

Item ranker, dev MAP@12: 0.0182 with the OTTO columns, 0.0176 without them.

## Findings

- **The 25 H&M values carry most of the signal.** History adds a little; differences between the top rows are within about one CI width (no paired test between feature sets yet).
- **The OTTO browsing values add nothing measurable to layout decisions** (fused 37 ≈ H&M 27; the no-OTTO row is as good as the shipped one). This matches the low R² in FUSION.md. They're shipped because they drive the browsing-based UI choices, which are labelled Estimated.
- **Compact profiles keep much of the value:** on final, 4 numbers keep about 90% of the color gain, 40% of the section gain and 35% of the category gain; 8 numbers keep about 70% of the category gain.
- **Ladieswear stays the landing page.** Even shoppers whose history is more than 50% menswear put 58% of next purchases in Ladieswear and only 20% in Menswear (shared household accounts), so switching rarely pays.
- **Bestsellers stays the sort.** No sort beat bestsellers for any shopper on held-out data; the model learned that and changes nobody.

## Homepage documents

`python -m model export` writes `model/work/export/`: one JSON per shopper in the same per-decision format as `artifacts/frontend/shoppers.json` (`value`, `class`, `validated`, `reason`), plus `predicted_mix`, `browsing` and `products`.

| Class | Decisions |
| --- | --- |
| Tested | landing_department, category_order, section_order, default_sort, color_highlight |
| Estimated (OTTO) | grid_columns (exploration terciles), recently_viewed (multi_visit_research top third), compare_panel and cart_reminder kept at default because their signal is too weak |
| Assumed | price_filter_first, filter_order, hero |
| Based on your settings | popups (newsletter consent) |

- Full documents: about 7.5 KB each. Compact documents (tiles as article IDs plus a 12,540-row article table): about 3.8 KB, about 385 MB raw for 100k shoppers before Postgres compression.
- Supabase: run `model/schema.sql` in the SQL Editor, then `python -m model publish` (owner only, needs the service-role key).

## Caveats

- **Final was viewed before the seasonality fix.** The first version scored −0.008 on final category order, which led to the offset design. Final category numbers are therefore reported results, not a clean test. The 2019 reserved window is still untouched and is the clean test.
- **Dev numbers are slightly optimistic:** margins were tuned on the same out-of-fold predictions they're reported on (one knob per decision).
- **Purchase labels can't validate the browsing-driven choices** (grid, recently viewed); they're labelled Estimated.
- Offline evaluation only: no causal claims, no privacy claims (see the repo README).
