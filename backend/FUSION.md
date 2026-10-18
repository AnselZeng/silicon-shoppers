# Fused shopper dataset: H&M + OTTO

100,000 shoppers, 37 values each. The 25 H&M profile values from dataset v1, plus 2 purchase-pattern values, plus 9 browsing values estimated from OTTO, plus a match-confidence score.

This file explains what was built, how to get the data, and what to watch out for. It doesn't assume any model architecture.

---

## TL;DR

- **Use `fused_dev` to train and tune, `fused_final` only to report.** Same shoppers, two points in time.
- **Labels are in `targets_dev` / `targets_final`.** Only about 11,400 of the 100,000 shoppers bought something in each window, so only they have labels.
- **The H&M values are real; the browsing values are mostly estimates.** Only `exploration` and `multi_visit_research` carry real per-shopper signal. See [How good is the fusion?](#how-good-is-the-fusion)
- **Get the data from Supabase** (`python -m atelier_data.cloud download`) or from Git LFS on this branch.
- **Keep it private.** It contains H&M data: accept the [H&M competition rules](https://www.kaggle.com/competitions/h-and-m-personalized-fashion-recommendations/rules) before using it, and never put it anywhere public.

---

## What was done

H&M has purchases but no browsing. OTTO has browsing (clicks, carts, orders) but no product details. And they're **different people**, so no shopper can be looked up in both.

So the two were joined by **behavior**, not identity:

1. **Bridge features.** Five purchase measures both datasets can compute: purchase frequency, basket size, same-item rebuying, how mainstream the items are, and how spread out shopping days are. Each is a percentile within its own dataset, so 4 weeks of OTTO history and 2 years of H&M history compare by rank.
2. **Matching.** Each H&M shopper is matched to the **50 OTTO shoppers** closest on those five values.
3. **Browsing estimate.** The H&M shopper gets the **average** browsing values of those 50.
4. **Match confidence.** It records how close the 50 matches were.

A fused row is therefore *"this H&M shopper's real taste, plus how people who buy like them tend to browse"*, not a claim that the same person appears in both datasets.

**OTTO data used:** the full train set (12,899,779 sessions, 216,716,096 events, 4 weeks in Aug 2022, CC BY 4.0). Only the 1,626,338 sessions with at least one order can compute purchase features, so they are the match pool.

---

## The 37 values

Every value is between 0 and 1.

### 1–25: H&M profile (observed)

Unchanged from dataset v1. Full definitions are in the main [README](README.md#the-profile-25-values-fixed-order) and [docs/PIPELINE.md](docs/PIPELINE.md).

| Columns | Meaning |
| --- | --- |
| `cat_*` (8) | Share of purchases per product group |
| `dept_*` (5) | Share of purchases per department |
| `color_neutral`, `color_warm`, `color_cool`, `color_concentration` | Color-family shares and how loyal they are to a few colors |
| `solid_share` | Share of unpatterned items |
| `price_level` | Price percentile they pay, within product group and month |
| `markdown_affinity` | Share bought on markdown (inferred; H&M doesn't flag sales) |
| `novelty_affinity` | Share bought within 28 days of an item's release |
| `rebuy_share` | Share of products they'd bought before |
| `channel_2_share` | Share bought online |
| `purchase_frequency` | Percentile of shopping days per month |
| `mainstream_score` | Percentile of how popular their purchases are |

### 26–27: new bridge values (observed, H&M)

| Column | Meaning |
| --- | --- |
| `basket_size` | Percentile of items bought per shopping day |
| `activity_spread` | Percentile of how evenly purchases spread across shopping days (low = one big haul, high = steady) |

### 28–36: browsing (estimated from OTTO)

All are percentiles among OTTO shoppers, averaged over the 50 matches.

| Column | Meaning | Signal (R²) |
| --- | --- | --- |
| `exploration` | Distinct items viewed per visit | **0.23, usable** |
| `multi_visit_research` | Share of bought items first found in an earlier visit | **0.13, weak but usable** |
| `browsing_pace` | Speed of clicking within a visit (higher = faster) | 0.07, near average |
| `cart_to_order` | Share of carted items that get ordered | 0.07, near average |
| `decision_speed` | Time from first view to cart (higher = faster) | 0.04, near average |
| `click_to_cart` | Share of viewed items that get carted | 0.03, near average |
| `comparison` | Share of views that return to an item seen earlier | 0.00, no signal |
| `evening_share` | Share of activity after 18:00 | −0.01, no signal |
| `weekend_share` | Share of activity on weekends | −0.01, no signal |

### 37: `match_confidence`

0.5 for a shopper whose matches are as close as the median shopper's, rising toward 1 for closer matches and falling toward 0 for farther ones. Medians by group: light 0.46, lower_mid 0.48, upper_mid 0.51, heavy 0.57.

### Extra columns (not part of the 37)

| Column | Meaning |
| --- | --- |
| `customer_key` | Shopper ID; joins to `targets_*` and to every dataset v1 file |
| `stratum` | `light` / `lower_mid` / `upper_mid` / `heavy` history group, 25,000 each |
| `inclusion_weight` | Reweights results from the balanced cohort back to the real H&M population |
| `match_distance` | Raw average distance to the 50 matches (behind `match_confidence`) |

---

## How good is the fusion?

The key question was whether buying behavior predicts browsing at all. To test it, 325,548 OTTO shoppers were held out, their browsing was predicted from their bridge values using the other 80%, and R² was measured. 0 means no better than guessing the average; 1 means perfect. Those are the R² values in the table above.

**What that means in practice:**
- The 25 H&M values and 2 bridge values are **real, per-shopper data**. They're the core of the profile.
- `exploration` and `multi_visit_research` carry **real but partial** signal.
- The other 7 browsing values are **close to the population average for everyone**. Their spread across shoppers is about a third or less of the real spread among OTTO shoppers (all numbers are in `reports/fusion.json`). Don't build model decisions or paper claims on `comparison`, `evening_share` or `weekend_share`.
- **In the paper,** describe browsing as *estimated from behaviorally similar shoppers*, never as observed. The weak link between buying and browsing is itself a reportable finding.

A good first experiment for any model: train once on the 25 H&M values and once on all 37. If the OTTO columns don't help, that confirms the numbers above.

---

## Getting the data

### Option A: Supabase (recommended)

You need a `.env` file at the repo root. Copy `.env.example` and fill in the project URL, the anon key, and the email and password the project owner created for you.

```bash
pip install -r requirements.txt
pip install -e .
python -m atelier_data.cloud download              # all files
python -m atelier_data.cloud download fused_dev    # just one
```

Files land at the same paths the pipeline uses, so the scoring harness works right away.

| Name | Saved to | Size |
| --- | --- | --- |
| `fused_dev`, `fused_final` | `data/processed/` | 24 MB each |
| `targets_dev`, `targets_final` | `data/interim/` | about 0.2 MB each |
| `articles` | `data/ingested/` | 2 MB |

**Querying instead of downloading.** Useful for a slice or a web app.

Python (handles paging past the 1,000-row limit per request):

```python
from atelier_data.cloud import fetch
light = fetch("fused_dev", stratum="eq.light", select="customer_key,markdown_affinity,exploration")
```

JavaScript (`@supabase/supabase-js`):

```js
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
await supabase.auth.signInWithPassword({ email, password });
const { data } = await supabase.from("fused_dev").select("*").eq("stratum", "heavy").range(0, 999);
```

Downloading whole tables through the query API is slow and wastes the free bandwidth. Use `download` for full tables.

### Option B: Git LFS (this branch)

```bash
git fetch && git checkout dataset-fusion
git lfs pull --include="data/processed/fused_*,data/interim/targets_*"
```

---

## Using it for training

| | Inputs | Labels | Use for |
| --- | --- | --- | --- |
| **dev** | `fused_dev` (history before 2020-07-29) | `targets_dev` (purchases 2020-07-29 to 2020-08-25) | Training, tuning, model selection |
| **final** | `fused_final` (history before 2020-08-26) | `targets_final` (purchases 2020-08-26 to 2020-09-22) | Reporting, once, at the end |

- **Labels:** one row per shopper, day, channel and item bought in the window. Columns: `customer_key`, `t_dat`, `channel` (2 = online), `article_key`, `q` (units), `price_mean`. Join `article_key` to `articles` for product group, department (`index_group_name`), color and pattern.
- **Coverage:** dev has 47,711 label rows from 11,434 shoppers, and final has 43,236 from 11,183. The other ~88,600 shoppers bought nothing in that window, so they have no labels. Decide explicitly whether your model trains only on buyers or treats "no purchase" as a label.
- **No leakage:** the 37 values use only purchases before each window starts. OTTO has no time link to H&M.
- **Never tune on final.** A third window (2019) is reserved and untouched for one last clean test.
- **Never train on `data/ingested/transactions.parquet`.** It contains the answers.

**Scoring layouts.** If your model outputs store layouts, the existing harness scores them against the store defaults. The format is in the main README.

```bash
python -m atelier_data score --layouts my_layouts.parquet --cutoff dev
```

This needs the full dataset branch files (Git LFS), not only the Supabase downloads. The bar to beat is the "bestsellers" default, which beat the v1 hand-written rules on every decision.

If your architecture outputs something other than layouts, the labels and the 37 values still apply; only the scoring harness is layout-specific.

---

## Rebuilding from scratch

```bash
python -m atelier_data fusion    # download OTTO, ingest, features, fuse
```

- **Download:** needs a Kaggle token at `~/.kaggle/kaggle.json`, or put `otto-recsys-train.jsonl` in `data/raw/otto/` yourself.
- **Time:** about 4 minutes after the download on a 32 GB machine. It needs about 11 GB of disk for the raw OTTO file.
- **Reproducible:** the same inputs give the same outputs (salted hash ordering, fixed seed).
- **Settings:** in `config/config.yaml` under `fusion:` (number of matches `k`, visit gap, time zone).
- **Code:** `src/atelier_data/fusion.py`, tests in `tests/test_fusion.py`.

---

## Supabase setup (project owner, once)

The free tier is enough, so nothing gets billed.

1. Create a project at [supabase.com](https://supabase.com) on the **Free** plan, in a US region.
2. **SQL Editor:** paste [`supabase/schema.sql`](supabase/schema.sql) and run it. It creates the four tables, turns on row-level security so only signed-in users can read, and makes a private `atelier` bucket.
3. **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up".
4. **Authentication → Users → Add user:** create a login for each teammate who has accepted the H&M rules.
5. **Project Settings → API:** put the URL and the `service_role` key in your own `.env`. Never share the service key; teammates get the URL, the anon key, and their own login.
6. Upload:
   ```bash
   python -m atelier_data.cloud upload
   ```
   Re-running replaces the rows. It never duplicates them.

**Free-tier limits to watch.** Check the [current pricing page](https://supabase.com/pricing).
- About 500 MB database. These four tables use well under 100 MB.
- About 1 GB file storage. These five files total about 50 MB.
- 50 MB per uploaded file. That's why the 74 MB `otto_donors.parquet` stays on Git LFS only.
- Limited monthly bandwidth: download each file once, then work locally.
- Free projects **pause after about a week without activity**. Restore one from the dashboard; the data is kept.

**Security:** the anon key is safe to share with teammates because row-level security blocks it without a login. The `service_role` key bypasses everything. If it ever leaks, rotate it under Project Settings → API.
