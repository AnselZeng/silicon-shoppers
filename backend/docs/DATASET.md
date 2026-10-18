# ATELIER NINE Shopper Profiles: dataset v1

Frozen 2026-10-04

> **New on branch `dataset-fusion`:** H&M + OTTO fused 37-value shopper vectors, hosted on Supabase. See [FUSION.md](../FUSION.md).

Compact shopper profiles built from the H&M Personalized Fashion Recommendations data. They're for training and scoring models that personalize a store's **layout**: landing department, category order, homepage sections, default sort and highlighted colors.

This branch (`dataset`) contains everything: the raw data, every built file, the code that builds them, the scoring code and the reports. It's kept apart from the app code and is never merged into the main branch.

---

## Getting started

1. **Accept the H&M competition rules on Kaggle** before using anything here: [competition rules](https://www.kaggle.com/competitions/h-and-m-personalized-fashion-recommendations/rules). The data is for non-commercial academic use, and it may only be shared with people who've accepted those rules. Everyone with access to this repo can read this branch, so every collaborator must accept them first.

2. **Clone just this branch, with Git LFS.** The data files are stored with Git LFS.

   ```bash
   git lfs install
   git clone --branch dataset --single-branch <repo-url> atelier-dataset
   cd atelier-dataset
   ```

   Every full download counts against the repo owner's monthly LFS bandwidth. If you only need part of the data, clone without it and pull what you need:

   ```bash
   GIT_LFS_SKIP_SMUDGE=1 git clone --branch dataset --single-branch <repo-url> atelier-dataset
   cd atelier-dataset
   git lfs pull --include="data/processed/profiles_*,data/interim/targets_*"
   ```

3. **Set up Python 3.12:**

   ```bash
   uv venv --python 3.12 .venv
   source .venv/bin/activate
   uv pip install -r requirements.lock
   uv pip install -e .
   ```

4. **You don't need to rebuild anything.** Every stage's output is committed, except the compression reconstructions (see "Compressed profiles").
   - To rebuild from scratch, unzip the three files in `data/raw/` in place, then run `python -m atelier_data all --force`.
   - That takes about 21 minutes on an M4 MacBook with 16 GB of RAM.
   - A rebuild reproduces the same values (tests check them to 1e-9).
   - Checksums for every built file are in `reports/checksums.sha256`.

---

## What's in the repo

| Path | What it is |
| --- | --- |
| `data/raw/*.zip` | The three original H&M CSVs, zipped |
| `data/ingested/` | The CSVs as typed Parquet, with integer keys for customers and articles. `customer_index.parquet` maps keys to H&M's hashed customer IDs. `customers_audit.parquet` holds age and postal code, for the privacy audit only. |
| `data/processed/cohort.parquet` | The 100,000 cohort shoppers: integer key, H&M's hashed customer ID, stratum, units before the dev cutoff, inclusion weight, split flags, showcase hash |
| `data/processed/profiles_{dev,final}_E{1,3,10,all}.parquet` | One row per cohort shopper: 25 profile values, evidence columns and newsletter consent. `E` is how many of the shopper's most recent purchases built the profile. |
| `data/processed/halves_{dev,final}.parquet` | Profiles built separately from the early and late halves of each shopper's history (shoppers with 6+ units) |
| `data/interim/targets_{dev,final}.parquet` | Held-out purchases in each target window. These are the labels. |
| `data/interim/units_{dev,final}.parquet` | Every customer's purchases before the cutoff, grouped by day, channel and item. Use these for purchase sequences. |
| `data/processed/references_{dev,final}/` | Population tables: priors, article tables, percentile tables |
| `data/processed/vocabularies.json` | Category, department and color keys, and their order |
| `data/processed/compressors/`, `data/processed/representations/` | Fitted compressors and compressed profile codes (see "Compressed profiles") |
| `artifacts/frontend/` | Demo files: `shoppers.json`, `catalog.json`, `results.json`. Their layouts come from the v1 placeholder rules. |
| `reports/` | Data card, build log, evaluation and privacy results, figures, checksums, build manifest |
| `docs/PIPELINE.md` | Full pipeline reference: every stage, formula and file |
| `config/`, `src/atelier_data/`, `tests/` | Build config, pipeline and scoring code, tests |

**Never train on `data/ingested/transactions.parquet` or the raw CSVs directly.** They contain purchases from the target windows. Use the unit files, which are already cut off at each window's start.

---

## How the dataset was built, and why

The goal was a dataset a model can be trained on without leaking the answers, rebuilt from scratch with the same result, and honest about what it can and can't show. Every decision and row count is logged in `reports/DATA_LOG.md`.

### Cleaning

- **Article IDs normalized** to 10 characters. Some tools drop H&M's leading zeros, which silently breaks joins.
- **Every column cast to an explicit type,** instead of letting a CSV reader guess.
- **Duplicate rows kept as quantity.** H&M has no transaction ID, and 2,974,905 rows (9.4%) are exact repeats. A repeat usually means one more of the same item, so repeats count as extra units. They're capped at 3 per item per day, so one bulk purchase can't dominate a profile (93,433 item-days hit the cap).
- **Price anomalies excluded from price features** but kept as purchases. There were only 7 such rows.
- **Newsletter labels normalized.** The raw field mixes `NONE`, `None` and blanks.
- **Row accounting at every stage:** rows in, rows out and the reason for every drop. The build fails if they don't add up.

### Checking assumptions instead of trusting them

- **Online vs. store.** H&M never documents which sales channel is online. In April 2020, during store closures, channel 1 had zero sales (against 324,660 in February) and channel 2 roughly doubled. So channel 2 is online.
- **Placeholder postal code.** One postal code is shared by 120,303 customers, against 261 for the next most common. It's flagged as a placeholder, not a location.
- **Ages.** 15,861 are missing and 77 are outside 16–90. Both groups are excluded from the privacy audit.
- **Colors.** Every color label maps to a color family, with zero unmapped.
- **Departments.** The five department values were checked against the expected list. The build fails if they ever change.

### No leakage

- **Two time windows, each with a hard cutoff.** Every feature, vocabulary, price reference, popularity count and percentile table uses only data from before the cutoff.
- **One gatekeeper.** All reads of the transaction table go through one module. A test fails if any other module touches the table, apart from the loader that writes it and the pre-flight checks.
- **Proven, not assumed.** A leakage check rebuilds 2,000 profiles from data physically truncated at the cutoff, and they match the main build to 1e-9. A unit test adds random future purchases and confirms nothing changes.
- **Cohort chosen without future data.** Shoppers were picked by a salted hash on history before the first cutoff.
- **The final test window is untouched.** A third window (2019) is reserved and has never been built or looked at.

### Who's in the cohort

100,000 shoppers, 25,000 from each history group:

| Stratum | Units before 2020-07-29 | Eligible customers |
| --- | --- | --- |
| light | 1–2 | 251,002 |
| lower_mid | 3–5 | 238,863 |
| upper_mid | 6–10 | 215,848 |
| heavy | 11+ | 613,690 |

Heavy buyers make up nearly half the population, so a random sample would bury light shoppers. Light shoppers are the point of this project, so every group gets equal room. `inclusion_weight` reweights results back to the real population.

### Feature engineering

- **Recency weighting** (180-day half-life), so a purchase from two years ago counts less than one from last month.
- **Smoothing toward the population** with 5 pseudo-purchases, so a shopper with 2 purchases isn't treated as certain about anything.
- **Left-censoring correction for novelty.** Items first seen in the data's first 28 days might be older, so they're excluded from the "new item" measure.
- **Price references per item and channel,** since online and store prices can differ for the same item.
- **A markdown definition chosen with evidence.** H&M doesn't flag sales, so a sale is inferred when a price falls below a share of the item's usual price.
  - The first threshold (90%) flagged 40% of all purchases, which is too many to mean "on sale".
  - Thresholds of 90%, 80% and 70% were compared using H&M's sale seasons, without touching any test data.
  - 70% was chosen, and about 21% of purchases now count as markdowns.
- **Four history lengths** (the last 1, 3 or 10 purchases, or all of them), so a model can test how much history it really needs.

### Reproducibility

- **Fixed seed everywhere,** and ties broken by fixed rules.
- **Exact arithmetic for sums.** DuckDB adds numbers in parallel, so the last digits of a sum could vary between runs. In one case that flipped a single markdown flag, and the leakage check caught it. All sums now use exact decimal arithmetic.
- **Repeated runs are identical.** Rebuilding the population percentile tables twice gave zero differences across about 1.3 million customers.
- **Freeze points with checksums.** The build manifest records each frozen version (A, dataset-v1, C), and `reports/checksums.sha256` covers 1,258 files.

### Compression and privacy

- Every profile was also compressed to 4, 8 or 25 numbers, using PCA, feature selection and random-feature controls, in float32 and 1-byte int8.
- Every compressed version was attacked: how unique it is, whether two halves of one shopper's history can be linked, and whether age can be guessed.

### Testing

- **39 unit tests** on a hand-built dataset with hand-computed answers, covering every formula, the cohort rules and leakage.
- **15 integration tests** on the real outputs: value ranges, required fields, row counts, and a privacy check that no demo or report file contains age, postal code or customer IDs.
- All pass on both the 8,000-shopper smoke run and the full run.

---

## Time windows

| Window | Profile data before | Target (label) window | Use it for |
| --- | --- | --- | --- |
| dev | 2020-07-29 | 2020-07-29 to 2020-08-25 | Training and all tuning |
| final | 2020-08-26 | 2020-08-26 to 2020-09-22 | Reporting results |
| reserved | 2019-08-26 | 2019-08-26 to 2019-09-22 | One clean final test. **Not built.** |

- Tune everything on **dev**: model choice, thresholds, profile size.
- The **final** window was already scored once, with the v1 hand-written rules. Treat final-window results as reported numbers, not a clean test.
- The **reserved** window has never been built or looked at. When your model is completely frozen, ask the dataset owner; it gets built and scored exactly once. The pipeline doesn't have a command for it yet.

---

## The profile (25 values, fixed order)

Every value is between 0 and 1. Exact formulas are in `docs/PIPELINE.md`.

| Values | What they measure |
| --- | --- |
| `cat_*` (8) | Share of purchases in the 7 biggest product groups plus `cat_other`. Keys and order are in `data/processed/vocabularies.json`. |
| `dept_ladieswear`, `dept_menswear`, `dept_divided`, `dept_sport`, `dept_baby_children` | Share of purchases per department |
| `color_neutral`, `color_warm`, `color_cool` | Share of purchases per color family |
| `color_concentration` | How strongly the shopper sticks to a few colors |
| `solid_share` | Share of solid (unpatterned) items |
| `price_level` | Population percentile of the prices they pay, relative to the product group and month |
| `markdown_affinity` | Share of purchases at or below 70% of the item's usual (90th-percentile) price. **A proxy**, since H&M doesn't flag sales. |
| `novelty_affinity` | Share of purchases within 28 days of an item's first sale |
| `rebuy_share` | Share of purchases of a product they'd bought before |
| `channel_2_share` | Share of online purchases (channel 2 is online, see above) |
| `purchase_frequency` | Population percentile of shopping days per month |
| `mainstream_score` | Population percentile of how popular their purchases are |

**Columns outside the vector:**
- Evidence: `units_used`, `shopping_days`, `history_days`, `days_since_last`, `known_color_units`, `color_coverage`, `top_colors`, `top_groups`.
- `confidence`: `low` under 5 units, `medium` 5–14, `high` 15+.
- `newsletter`: `subscribed`, `not_subscribed` or `unknown`. This is observed consent; never infer it.

---

## Scoring your model

Your model outputs one layout per shopper. Score it with the same code used for the baselines:

```bash
python -m atelier_data score --layouts my_layouts.parquet --cutoff dev   # tune with this
python -m atelier_data score --layouts my_layouts.parquet --cutoff final # report with this
```

The layout file is Parquet, one row per cohort shopper:

| Column | Values |
| --- | --- |
| `customer_key` | Every cohort shopper, exactly once |
| `landing_department` | One department key |
| `category_order` | List of all 8 `cat_*` keys |
| `section_order` | List of `new_in`, `sale`, `bestsellers`, `buy_again` |
| `default_sort` | `bestsellers`, `newest` or `price_asc` |
| `color_highlight` | List of master color names (may be empty) |

**Metrics**, all against the held-out purchases:

| Metric | Measures |
| --- | --- |
| Category NDCG (8 groups), Hit@1, Hit@3 | Does the category order match what they buy next? |
| Department share | Share of next purchases in the landing department |
| Section NDCG (4 sections) | Does the section order match what they buy next? |
| Sort gain | Average position of next purchases under the chosen sort, within their product type (1 = top) |
| Color share | Share of next purchases in the highlighted colors |

You get gains against the baselines with paired bootstrap 95% CIs, overall and per stratum, plus population-weighted point estimates. A decision counts as **validated** only if the shoppers whose layout it changed did better than under the default, with the CI above zero.

---

## Baselines to beat (final window)

**Store defaults, chosen on dev:**
- Sort: **bestsellers**. On dev, the average purchase sat at position 0.873 under bestsellers, 0.660 under newest and 0.388 under price low-to-high.
- Section order: bestsellers, sale, new_in, buy_again.
- Category and department order: popularity. The 28-day order equals the all-time order at both cutoffs (category NDCG 0.8206).

**v1 hand-written rules** (in `results.json`, labeled "rules v1: hand-written baseline"):

| Decision | Gain vs default (95% CI) | Validated |
| --- | --- | --- |
| Category order | −0.020 [−0.023, −0.017] | no |
| Landing department | +0.003 [−0.001, +0.006] | no |
| Section order | −0.055 [−0.059, −0.050] | no |
| Default sort | −0.107 [−0.111, −0.103] | no |
| Color highlight | +0.003 [−0.009, +0.015] | no |

**What v1 got right:** the profile picks out the right people.
- Shoppers flagged as deal-seekers or trend-seekers gained 0.079 more than other shoppers from price and newest sorts (shuffle control p = 0.005).
- They still did worse than under bestsellers, because bestsellers is so strong.
- A direction worth trying: keep bestsellers as the base and boost sale or new items for those shoppers, instead of switching the sort.

**Why sections lost:** v1 ranked sections by each shopper's percentile. That put Buy Again (7% of purchases) first as often as Bestsellers (52%). Rank by predicted relevance instead.

---

## Compressed profiles

Every combination of history length (1, 3, 10 or all purchases), size (4, 8 or 25 numbers), method and precision (float32 or int8), with the codes saved for each. Exact files are listed in `docs/PIPELINE.md`.

Reconstructions (each compressed profile turned back into 25 values) aren't committed, to keep downloads small. Rebuild them with `python -m atelier_data reconstruct`; the result is bit-identical and covered by the checksums.

**Reconstruction error** (final cutoff, all history, held-out, on the 0–1 scale):

| Profile size | PCA | Feature selection | Random features |
| --- | --- | --- | --- |
| 4 bytes | 0.085 | 0.112 | 0.110 |
| 8 bytes | 0.071 | 0.109 | 0.091 |

- int8 matches float32 to three decimals.
- No size has been chosen. Pick one on dev, using your model's scores.
- Feature selection used dev-window labels to rank features, so its codes are not label-free.

---

## Privacy findings

Don't describe these profiles as anonymous. Results at the final cutoff:

- **Full profile:**
  - Age band can be guessed with AUC 0.666 (0.5 is chance).
  - 99% of profiles are unique.
  - The early and late halves of one shopper's history link correctly 1.7% of the time, about 170× chance.
- **4-byte PCA profile:** age AUC 0.593, link rate 0.4%.
- **Where age is leaked:** department and category shares carry the most age signal. Without both, age AUC is 0.616.
- These numbers have no utility axis yet. Never claim a smaller profile is "more private" until it's compared with a random-subset control at the same model score.

---

## Known limits

- **Some features drift over time.** Early-versus-late reliability is low for colors and novelty (about 0.22). Six v1 decisions relied on features below the 0.4 reliability threshold. Treat those features as noisy.
- **Markdown is inferred** from price drops, not recorded.
- **Light shoppers have little data.** At the dev cutoff, all light shoppers and 74% of lower_mid shoppers are low confidence (99% and 71% at the final cutoff).
- **Purchases only.** There's no browsing data, so this dataset can't support claims about how people browse.
- **One retailer, pandemic-era data, and same-day rows standing in for baskets.**

---

## Rules for using this data

- Never tune on the final window, and never touch the reserved window until your final test.
- Never push this data anywhere public, or share it with anyone who hasn't accepted the Kaggle rules.
- Age and postal code are only for privacy audits. Never use them as model inputs.
- Make no causal claims (these are offline purchases, not an A/B test) and no privacy or anonymity guarantees.
