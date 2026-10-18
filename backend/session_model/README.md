# Live session model: browsing style from the visitor's own clicks

The H&M + OTTO fusion gives every H&M shopper the *average* browsing style of 50 OTTO strangers who buy like them, and that link is weak (R² 0.00 to 0.23, see FUSION.md). This folder uses OTTO the way it's strongest: **watch the visitor's own first few events on the site and predict how they browse.**

- **Trained on OTTO.** For each sampled OTTO shopper, the model sees only their first N events (N = 3, 5, 10, 20, 40) and predicts their browsing style over their *later* events, so every reported number is a real forecast.
- **Same definitions as the fusion.** Exploration, comparison, browsing pace, click-to-cart, cart-to-order, decision speed and multi-visit research are defined exactly as in `atelier_data/fusion.py`, as percentiles among OTTO shoppers.
- **Runs in the browser.** Trees export to `web/session_model.json`; `web/sessionStyle.js` (no dependencies) computes the features, predicts the style and decides the UI after every click.
- **Only changes the page when it has earned it.** Each UI decision switches on only once the model's held-out R² for that value, at that many events, reaches 0.10. Early on, the page stays at the defaults.
- **Gated on single-visit accuracy.** A demo visitor makes one short visit, while OTTO prefixes often span several visits. `train` therefore also measures R² on prefixes that stay inside one visit, and the exported gate uses that table. A feature can only switch on if the model is reliable within one visit.
- **Compared fairly with purchases.** `train` also fits the fusion's 5 purchase-pattern (bridge) values on the **same** held-out shoppers (those who ordered) and prints both side by side. The older "purchases" column came from a different group of shoppers (the fusion holdout).

## Running it locally

From the repo root (`D:\Hackathon\atelier-dataset`), in the same `.venv` as the main model:

```
.venv\Scripts\activate
pip install -r session_model\requirements.txt
```

### 1. Check the pipeline works (no download, about 10 seconds)

```
python -m session_model smoke
node session_model\web\check.mjs session_model\work\smoke\web
python -m pytest session_model\tests
```

`smoke` runs every stage on synthetic OTTO-shaped data. Its numbers mean nothing; it only proves the code runs. `check.mjs` needs Node.js and should print `OK: JS runtime matches Python on 120 fixtures`.

### 2. Get the OTTO data (once)

The raw OTTO events aren't in the repo. Either:

- **Kaggle key in `.env` (recommended):** on kaggle.com go to Settings → API → Create New Token. Open the downloaded `kaggle.json` and copy its two values into the repo's `.env` (gitignored, next to the Supabase keys):

  ```
  KAGGLE_USERNAME=your_kaggle_username
  KAGGLE_KEY=the_key_from_kaggle_json
  ```

  `python -m session_model data` then downloads and ingests OTTO. Newer single-value tokens work too: `KAGGLE_API_TOKEN=...`. A `~/.kaggle/kaggle.json` file is also accepted.
- **Manual:** download `otto-recsys-train.jsonl` from https://www.kaggle.com/datasets/otto/recsys-dataset (CC BY 4.0) into `data\raw\otto\`.

Needs about 15 GB of free disk (11 GB raw file plus the ingested parquet). The ingest uses `ATELIER_DUCKDB_MEM` (default 4 GB); with 16 GB+ of RAM, `set ATELIER_DUCKDB_MEM=8GB` speeds it up.

### 3. Train

```
python -m session_model all        :: data -> train -> export
```

or step by step:

```
python -m session_model data       :: sample 200,000 OTTO shoppers with 60+ events; first 40 events + later-event targets
python -m session_model train      :: one LightGBM model per style value; prints the R² table
python -m session_model export     :: web\session_model.json + web\fixtures.json
node session_model\web\check.mjs   :: JS runtime == Python on real OTTO prefixes
python -m session_model demo       :: how the page adapts as three example visitors click
```

Use `--sample 50000` (or `set SESSION_SAMPLE=50000`) for a faster first run. The full run hasn't been timed on real OTTO yet; expect tens of minutes after the download, mostly the ingest.

### What it writes

| Path | Contents |
| --- | --- |
| `work/prefix_events.parquet` | First 40 events of each sampled shopper (model input) |
| `work/targets.parquet` | Each shopper's browsing style on their later events (what's predicted) |
| `work/samples.parquet` | One row per (shopper, events seen) with the 19 live features |
| `work/models/*.txt` | One LightGBM model per style value |
| `work/report.json` | Held-out R² per style value and number of events, tree counts, top features |
| `web/session_model.json` | Everything the browser needs: trees, R² table, UI policy |
| `web/fixtures.json` | Python predictions on real prefixes, for `check.mjs` |

## Reading the results

`train` prints three tables: R² on all held-out prefixes, the same-shopper comparison against purchases, and the single-visit table the UI gate uses. The first looks like this (real numbers come from your run):

```
target                   3 events   5 events  10 events  20 events  40 events  purchases
exploration                  ...        ...        ...        ...        ...      0.228
comparison                   ...                                                  0.003
...
```

- **Each cell** is R² on held-out shoppers: 1 means perfect, 0 means no better than guessing the average.
- **The `purchases` column** is how well the fusion bridge (5 purchase-pattern percentiles: frequency, basket size, rebuying, mainstreamness, spread) predicted the same value for held-out OTTO shoppers (from `reports/fusion.json`). That's the link the H&M fused vectors rely on.
- **The paper comparison:** how many live clicks it takes to beat years of purchase history at predicting browsing style.
- **Caveat:** OTTO's population (shoppers with 60+ events in 4 weeks) is more engaged than the average visitor, so state that when reporting.

## Using it in the app

1. Copy `session_model/web/sessionStyle.js` and `session_model/web/session_model.json` into the app's static files.
2. Send every product click (type 0), add to bag (type 1) and order (type 2) to the tracker:

```js
import { SessionTracker } from "./sessionStyle.js";
const model = await (await fetch("/session_model.json")).json();
const tracker = new SessionTracker(model);

// on every event
const { style, decisions } = tracker.add({ ts: Date.now() / 1000, aid: productId, type: 0 });
```

3. Render from `decisions`; each one is `{ value, active, reason }`:

| Decision | Values | Driven by |
| --- | --- | --- |
| `grid_columns` | 2, 3, 4 | exploration |
| `compare_panel` | on / off | comparison |
| `recently_viewed` | prominent / default | multi_visit_research |
| `quick_add` | on / off (one-tap add to bag on tiles) | decision_speed |
| `cart_reminder` | on / off | click_to_cart high and cart_to_order low |
| `product_page` | compact / standard / detailed | browsing_pace |

- **How it fits with the H&M homepage:** start from the H&M homepage JSON (`model/`). Its `Estimated` fields (`grid_columns`, `recently_viewed`, `compare_panel`, `cart_reminder`) are the starting point. Once a session decision is `active`, it replaces the estimate.
- **What stays H&M-driven:** the tested decisions (categories, sections, colors, tiles).
- **The explanation panel:** show `reason`, e.g. "You come back to items you've seen: compare panel on".
- **Thresholds** live in `POLICY` in `export.py`. Change them there and re-run `export`; the JS reads them from the JSON.

## Files

| File | What it does |
| --- | --- |
| `__main__.py` | `python -m session_model` command line, demo and smoke test |
| `config.py` | Prefix lengths, sample size, visit gap, targets |
| `data.py` | OTTO download/ingest (repo fusion stages), sampling, later-event targets, synthetic data for `smoke` |
| `features.py` | The 19 live features (mirrored in `web/sessionStyle.js`) |
| `train.py` | Samples, LightGBM per target, held-out R² by events seen |
| `export.py` | Tree flattening, Python reference predictor, UI policy, fixtures |
| `web/sessionStyle.js` | Browser runtime: features, prediction, decisions, `SessionTracker` |
| `web/check.mjs` | Proves the JS runtime matches Python |
| `tests/test_session_model.py` | Feature, tree-export and policy tests |
