# SOCAL ATELIER dataset pipeline (v1)

How the compact shopper-profile dataset is built from the H&M Personalized Fashion Recommendations data. The full specification is `BUILD_PROMPT.md`. Every place this build departs from it, or settles something the spec leaves open, is listed under "Decisions made during build" in `reports/DATA_LOG.md`.

**Scope of v1: data preparation only.** The build produces profiles, splits, cohort, held-out targets, references, catalog, compressed representations and an exposure audit. It also ships a scoring harness (targets, metrics, baselines). The layout rules exist only as **rules v1: hand-written baseline**. No canonical representation size is chosen: that is the model stage's job.

**Reserved window.** Cutoff **2019-08-26**, with target window [2019-08-26, 2019-09-23), is reserved and untouched for the model's final test. Nothing in this pipeline builds or scores it.

## Setup

```bash
uv python install 3.12
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt -e .
```

Pinned versions are in `requirements.lock`. Python 3.12 is used because the build machine only had 3.13 and 3.14 installed.

## Data

You need three CSVs in `data/raw/`: `transactions_train.csv`, `articles.csv` and `customers.csv`. Get them in either of two ways:

- Place them there by hand.
- Run `python -m atelier_data download`. This needs `~/.kaggle/kaggle.json` (mode 600) and acceptance of the competition rules. It downloads only these three files, never the roughly 30 GB image archive.

The data is for non-commercial academic use only, and competition data must not be redistributed. Only aggregate reports may leave the machine (see Outputs).

## Commands

```bash
python -m atelier_data <command> [--smoke] [--force]
```

| Command | Stage | What it does |
| --- | --- | --- |
| `download` | 5 | Fetch or unzip the three CSVs |
| `ingest` | 8.1 | Read the CSVs with DuckDB into typed parquet in `data/ingested/`, which smoke and full runs share. Adds integer keys and article attribute codes. Logs every dropped row |
| `verify` | 8.2 | Pre-flight checks. Hard failures stop the build. Writes `reports/preflight.json` and `config_generated/source_assertions.yaml` |
| `splits` | 8.3 | Dev cutoff 2020-07-29 and final cutoff 2020-08-26, each with a 28-day target window |
| `cohort` | 8.4 | 25,000 customers per history stratum, selected by salted hash at the dev cutoff |
| `build` | 8.5–8.7 | Unit groups, references and target groups for each cutoff; profiles for each history budget E; early/late halves |
| `validity` | 8.8 | Early/late reliability (reported only) and the markdown-proxy checks |
| `evaluate` | 8.10 | Scoring harness: dev-frozen defaults, rules v1 scores, popularity baselines |
| `compress` | 8.11 | Codes, reconstructions and reconstruction error for every (E, D, precision). No selection |
| `audit` | 8.12 | Exposure audit: uniqueness, linkability, age inference, family ablation. No utility axis |
| `reconstruct` | | Rebuilds `data/processed/reconstructions/` from the committed codes and compressors (not part of `all`) |
| `score` | | `score --layouts <file.parquet> --cutoff dev\|final [--out <file.json>]`: scores any layout file with the harness (not part of `all`) |
| `export` | 8.13–8.15 | Showcase, `shoppers.json` (v1 layouts), `catalog.json`, `results.json`, figures, data card |
| `leakage-check` | 12.2 | Rebuilds the dev features from a source physically limited to `t_dat < C_dev`; they must match |
| `manifest` | 8.16 | Final data card, `build_manifest.json` (freeze points), `checksums.sha256` |
| `all` | | Every stage above, in this order |

- **Skipping:** a stage skips itself when its outputs already exist, unless you pass `--force`.
- **Smoke mode:** `--smoke` applies the `smoke:` overrides in `config/config.yaml` (8,000-customer cohort, fewer resamples) and writes under `runs/smoke/`. Population tables still use every customer.
- **Logging:** every stage appends to `reports/DATA_LOG.md`, which records rows in, rows out and the reason for each drop.

**Tests.** `pytest` runs the unit tests on a synthetic fixture in about 1 second. `pytest -m integration` checks the smoke outputs; set `ATELIER_RUN_ROOT=.` to check the full run instead.

**Runtime on an M4 with 16 GB.** Full ingest-to-leakage-check is about 7 minutes; compress plus audit add about 15. Peak memory footprint is about 7.6 GB, with DuckDB capped at 6 GB and 6 threads.

## Leakage and determinism

**Leakage.**
- Only `db.py`, `ingest.py` and `verify.py` may read the transactions table. A test enforces this.
- Every feature, reference, vocabulary, prior, anchor, popularity count, percentile table and compressor fit reads through `db.rows_before(C)`.
- Targets read through `db.rows_between(start, end)`.
- The `leakage-check` command and `tests/test_leakage.py` confirm that rows dated on or after a cutoff change nothing built for that cutoff.

**Determinism.**
- The global seed is `20261004`, and there is no wall-clock data in data files.
- DuckDB's parallel floating-point `SUM`/`AVG` is not bit-reproducible, so all of them are computed in `DECIMAL(18,12)` and cast back.
- Raw scalars are rounded to 9 decimals before ECDF lookups and tie-breaks.
- Share blocks are rounded to 6 decimals with the rounding residual placed on each block's largest value, so blocks sum to exactly 1.

## Profile: 25 values

Notation used in the formulas:
- **Units:** same-day purchase groups `(customer, t_dat, channel, article)`, capped at 3. This is q.
- **Recency weight:** `w = q · 2^(−days_before_cutoff / 180)`.
- **Smoothed share:** `p = (Σw_num + 5·π) / (Σw_den + 5)`, where π is the population prior (a q-weighted share) at the same cutoff.
- **ECDF_pop:** the mid-rank percentile of a customer's raw value among all customers active before the cutoff.
- **History budget E** (1, 3, 10 or all): keeps the most recent E units, ordered by `t_dat` DESC, then `article_key`, then `channel`.

| # | Key | Formula |
| --- | --- | --- |
| 1–8 | `cat_<group>` ×7, `cat_other` | Smoothed share of w per product group. The top 7 groups by units are frozen at the dev cutoff; all others go to `cat_other`. The block sums to 1 |
| 9–13 | `dept_*` | Smoothed share of w per department (`index_group_name`), over units with a department |
| 14–16 | `color_neutral`, `color_warm`, `color_cool` | Smoothed share of w per color family (`config/color_map.yaml`), over units with a known color |
| 17 | `color_concentration` | Take the smoothed master-color shares s, compute `HHI = Σs²`, then `(HHI − 1/K) / (1 − 1/K)` clipped to [0, 1] |
| 18 | `solid_share` | Smoothed share of w on solid (`graphical_appearance_name = Solid`) articles |
| 19 | `price_level` | ECDF_pop of `(Σw·price_pct + 5·0.5) / (Σw + 5)`. `price_pct` is the unit's price percentile within its product group and month; price anomalies are excluded |
| 20 | `markdown_affinity` | Smoothed share of eligible units bought at a markdown. A unit counts as markdown when `price ≤ 0.70 × anchor`. The anchor is the 0.90 price quantile of the (article, channel), or of the article overall, with at least 20 rows |
| 21 | `novelty_affinity` | Smoothed share of units bought within 28 days of the article's first sale. Articles first seen in the first 28 days of data are excluded |
| 22 | `rebuy_share` | Smoothed share of units whose product code the customer bought on a strictly earlier date |
| 23 | `channel_2_share` | Smoothed share of w on channel 2. Channel 2 is online: channel 1 collapsed in April 2020 |
| 24 | `purchase_frequency` | ECDF_pop of `distinct shopping days / max(1, months since first kept purchase)` |
| 25 | `mainstream_score` | ECDF_pop of `(Σw·art_pop_pct + 5·μ) / (Σw + 5)`, where `art_pop_pct` is the article's popularity percentile |

- **Evidence fields** are stored outside the vector and never compressed: units, rows, shopping days, first and last dates, history days, days since last purchase, known-color units, confidence (low below 5 units, high from 15), top colors and top groups.
- **`cat_breadth`** is derived and is not part of the vector: `−Σp·ln p / ln 8` over the category block.

## Decisions fixed before the build (spec Section 2) and amendments

- **Data:** H&M only. The browsing track is deferred, and the schema keeps `browsing.source = "deferred"`.
- **Demo shoppers:** 1,000 showcase shoppers with random IDs and values rounded to 2 decimals. They are written to `artifacts/frontend/`, which is gitignored and served from a password-protected deployment.
- **Compression grid:** history E ∈ {1, 3, 10, all} × size D ∈ {4, 8, 25} × precision {float32, int8}.
- **Pop-ups:** shown only to newsletter subscribers, an observed consent field.
- **Seed:** 20261004.
- **Amendments since:** the markdown ratio is 0.70 (chosen outcome-blind from the seasonal scan); exact DECIMAL aggregation; DuckDB at 6 GB, 6 threads and an 8 GB temp cap; data-only scope. The full list is in `reports/DATA_LOG.md`.

## Scoring harness (shipped with the dataset)

`targets.py`, `metrics.py` and `evaluate.py` score a layout against held-out purchases.

**Relevance arrays** (per user, from the target window):
- category shares
- department shares
- section flags: new in, sale, bestseller, buy again
- target units per master color
- mean sort positions within product types

**Baselines:**
- all-time popularity (the store default)
- recent popularity (population units in the 28 days before the cutoff), for category order and landing department
- the best fixed section order and the best single sort, both frozen from dev
- the population's top 2 colors

**Metrics and statistics:**
- Metrics: NDCG, Hit@k, department share, sort position, color share, and vectorized Kendall τ.
- Statistics: chunked bootstrap CIs, plus per-stratum and population-weighted figures.

**Scoring a layout file.** `python -m atelier_data score --layouts <file.parquet> --cutoff dev|final [--out <file.json>]`. The Parquet file has one row per cohort shopper: `customer_key`, `landing_department` (a department key), `category_order` (all 8 category keys), `section_order` (`new_in`, `sale`, `bestsellers`, `buy_again`), `default_sort` (`bestsellers`, `newest` or `price_asc`) and `color_highlight` (master color names, may be empty). Missing or extra shoppers and invalid values stop with a clear message. The output has the same metrics, baselines, gains, CIs, per-stratum and population-weighted results as `eval_final.json`; the targeting test is omitted because it needs the rule triggers behind a layout. A test checks that scoring the v1 layouts reproduces `eval_final.json` exactly.

**Validated flag.** A tested decision is validated only if the users whose layout it changed did better than the store default, with the 95% CI of the mean difference above 0. The targeting test is reported separately and does not set the flag.

`results.json` carries the rules v1 numbers labeled **rules v1: hand-written baseline**. `shoppers.json` ships v1 layouts for the demo with the same label.

## Compressed representations

For each cutoff and each (E, D, precision), the build fits:
- **PCA:** standardize, then project to D components.
- **MI selection:** the top D features by mutual information with the dev target's top category. Note that this uses dev-window labels.
- **Random subsets:** 10 seeded draws.
- **Identity:** at D = 25.

All fits use the cohort's fit split (80%). For int8, each code dimension's lo/hi comes from fit rows.

**Reconstruction:**
- PCA: inverse transform.
- Feature selection: unselected features are filled with reference values (block priors, binary priors, 0.5 for ECDF features, and the fit-row median of `color_concentration`).
- Then clip to [0, 1], renormalize the share blocks, and recompute `cat_breadth`.

**Files:**
- `data/processed/representations/{cut}/{config}.parquet`: `customer_key` and codes `c0..c{D-1}` (float32 or uint8). Committed.
- `data/processed/reconstructions/{cut}/{config}.parquet`: `customer_key`, reconstructions `r_*` and `r_cat_breadth`. Not committed; `compress` writes them and `reconstruct` rebuilds them bit-identically from codes + compressors (both use `compress.decode`).
- `data/processed/compressors/{cut}/{config}.json`: fitted parameters.
- `reports/compression_{cut}.json`: held-out RMSE, MAE and max error, plus per-block and per-feature RMSE.

Configuration IDs have the form `E{E}_D{D}_{compressor}_{precision}[_r{draw}]`.

## Exposure audit

The audit runs at the final cutoff on representations as shipped.
- **Uniqueness:** float32 codes are rounded to 2 decimals; uint8 codes are used as is.
- **Age-band inference:** logistic regression and HGB, trained on attack split A and tested on split B. Reports macro one-vs-rest AUC and macro-F1 against a majority baseline.
- **Temporal linkability:** early half against late half, top-1 and top-10 nearest neighbour, over 10,000 customers.
- **Family ablation:** run with HGB on the full profile.

Age and postal code are read only inside `exposure.py`, and only aggregates leave it. There is no utility axis, so no claim of lower exposure is made.

## Outputs

| Path | Visibility |
| --- | --- |
| `data/ingested/`, `data/interim/`, `data/processed/` (cohort, profiles, halves, references, representations, compressors, layouts, showcase map) | private; `customer_id` appears only in `customer_index.parquet` and `cohort.parquet` |
| `artifacts/frontend/{shoppers,catalog,results}.json` | protected deployment |
| `reports/` (JSON reports, figures, `DATA_LOG.md`, `data_card.md`, `checksums.sha256`, `build_manifest.json`) | aggregate only; safe to commit |
| `data/snapshots/` | private: Freeze A source and pre-fix v1 outputs |

**Freeze points** in `build_manifest.json`:
- **A:** rules v1.
- **dataset-v1:** the data, with a checksum for every artifact.
- **C:** representations, audit and docs.
