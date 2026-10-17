# Laptop server: retrain, Snowflake, live refresh

This laptop trains the models and keeps every shopper's layout up to date. The store and the laptop only talk through Snowflake.

```
 store (Next.js)                      Snowflake                          this laptop
 ───────────────                      ─────────                          ───────────
 shopper clicks ──/api/events──▶  EVENTS ─────────────────────▶  python -m server loop (every 2 min)
                                                                    · H&M purchase model on their add-to-bags
                                                                    · live session model on their last visits
                                                                    · their own repeated sorts / filters
 first paint ◀──/api/layout───  USER_LAYOUTS, TRENDING ◀──────────  writes one homepage document per shopper
 every click: live session model in the browser (sessionStyle.js), no round trip
```

- **Two speeds.** Per-click changes stay in the browser (instant). Snowflake carries the slow loop: what a shopper did across visits, refreshed every 2 minutes.
- **The refresh job doesn't retrain.** It runs the frozen, tested models on each shopper's growing evidence (more add-to-bags, more clicks, more visits). Retraining happens with `retrain`.
- **New shoppers start on store defaults.** The H&M model with no history gives the default layout. Each add-to-bag then shifts their predicted mix.
- **The H&M model is deliberately cautious.** The department blend (tested on 2019) needs about 10 add-to-bags before it moves a shopper's landing department. Live product ranking reacts sooner, using what they view.

## How a store shopper becomes H&M model input

The H&M model only understands H&M purchases, so each add-to-bag is translated first (`catalog.py`):

- **Category:** jackets → upper body, jeans → lower body, dresses → full body, and so on.
- **Department:** women → Ladieswear, men → Menswear.
- **Color:** navy → Blue, olive → Khaki green, burgundy → Red, cream → White, camel → Beige.
- **Price:** its percentile among store products in the same group.
- **Sale and new:** the store's own flags.

`hm_features.py` then builds the same 195 features the models were trained on. **Check:** fed real H&M purchases, it reproduces the training pipeline's features exactly (all 195, on 1,500 shoppers; `tests/test_server.py`). The translation itself is a judgment call and isn't tested, which the documents say in `evidence.note`.

## One-time setup

From `D:\Hackathon\atelier-dataset` with the venv active:

```
pip install -r server\requirements.txt
```

**1. Sign-in (key pair).** Snowflake is phasing out password sign-in for scripts. Add your account and user to `.env`:

```
SNOWFLAKE_ACCOUNT=orgname-accountname
SNOWFLAKE_USER=YOUR_LOGIN_NAME
```

The account identifier is in Snowsight, under your name > Account > View account details.

```
python -m server keygen
```

Paste the printed `ALTER USER ... SET RSA_PUBLIC_KEY=...` into a Snowsight SQL worksheet and run it. Then add the printed `SNOWFLAKE_PRIVATE_KEY_PATH=...` line to `.env`. (A programmatic access token also works: `SNOWFLAKE_TOKEN=...`.)

**2. Tables and catalog.**

```
python -m server check       :: prints your account, user, role
python -m server setup       :: warehouse ATELIER_WH (XSMALL, auto-suspend 60 s), database ATELIER, schema LIVE, tables
python -m server catalog     :: the 80 store products from ..\la-hacks-app\lib\store\catalog.ts
python -m server app-user    :: SQL + key for the store's own service user (give the key to the UI team privately)
```

## Hackathon-day retrain

```
python -m server retrain
```

- **Backup first:** copies the Oct 15 frozen models (the ones the 2019 test ran on) to `model\work\frozen_backup_<time>`.
- **Retrains everything,** each step logged to `server\work\logs\retrain_<time>.log`:
  - H&M: training windows, layout models, section models, item ranker, freeze, the 2019 test (marked as a rerun) and the homepage export
  - then the live session model (with the single-visit table) and the serving bundle
- **Prints a comparison** of the 2019 test before and after. It's the same code, data and seeds, so the numbers should match closely.
- **Uploads to Snowflake** at the end:
  - the run record (MODEL_RUNS)
  - the 100k H&M homepages (HM_HOMEPAGES / HM_ARTICLES)
  - every store shopper rescored with the new models

**Time:** about 2 hours on 2 cores, most of it in `windows` and `train`; faster with more cores. Leave the laptop plugged in with sleep turned off. For a quick check first, `python -m server retrain --skip-hm --no-snowflake` retrains only the session model (minutes).

Afterwards:

```
node session_model\web\check.mjs        :: JS runtime == Python on the new session model
python -m pytest server\tests model\tests session_model\tests
```

## Running live

```
python -m server simulate --users 20    :: optional: synthetic shoppers (ids start with sim-)
python -m server loop                   :: refresh every 2 minutes; leave this window open
python -m server status                 :: row counts + latest runs (second window)
python -m server show sim-deal_hunter-000
python -m server simulate --clear       :: remove synthetic shoppers before the demo
```

`set REFRESH_EVERY_S=60` refreshes every minute. Each refresh takes about a second for a few dozen shoppers.

## Tables (database ATELIER, schema LIVE)

| Table | Written by | Read by | Contents |
| --- | --- | --- | --- |
| `EVENTS` | store (`/api/events`) | laptop | every store event: user, session, type, time, product, color, properties |
| `CATALOG` | laptop (`catalog`) | both | the store's products |
| `USER_LAYOUTS` | laptop | store (`/api/layout`) | one `HomepageDoc` per shopper (`HOMEPAGE`, VARIANT) |
| `USER_LAYOUTS_HISTORY` | laptop | demo / judges | every version of every shopper's layout, to show how it adapted |
| `TRENDING` | laptop | store | top products in the last 60 minutes (views + 3 × add-to-bags) |
| `MODEL_RUNS` | laptop | anyone | every retrain and refresh: when, which models, what came out |
| `HM_HOMEPAGES`, `HM_ARTICLES` | laptop | team | the 100k H&M model outputs (private: H&M data terms) |
| `JOB_STATE` | laptop | laptop | refresh bookkeeping |

Example queries for the demo:

```sql
SELECT RUN_ID, KIND, STATUS, FINISHED_AT, DETAILS:comparison::STRING FROM MODEL_RUNS ORDER BY FINISHED_AT DESC;
SELECT UPDATED_AT, HOMEPAGE:layout:category_order:value, HOMEPAGE:layout:default_sort:value
  FROM USER_LAYOUTS_HISTORY WHERE USER_ID = 'sim-deal_hunter-000' ORDER BY UPDATED_AT;
```

## What's in a shopper's document

It's the same `HomepageDoc` as the H&M documents (`lib/model/homepage.ts`), so `modelLayout()` works unchanged. Store shoppers' documents also have:

- **`store_products`:** store product ids ranked for them, with a `why`. `rankCatalog()` uses it when present.
- **`session`:** the live session model's style and decisions from their earlier visits. `modelLayout()` uses them until this visit's live decisions switch on.
- **`preferences`:** sorts and filters they keep choosing.
  - A sort chosen twice becomes their default ("Based on your settings").
  - Filters used twice move to the top.
  - Color filters join the highlighted colors.
- **`evidence`:** how many events and add-to-bags the document is based on, and what "Tested" means here.

## Cost

The warehouse is XSMALL (1 credit per hour while running) and suspends after 60 seconds idle. With the loop and the store both active it runs most of the time, so about 24 credits per day of demo. Stop the loop (Ctrl+C) when nobody is shopping. Watch usage in Snowsight under Admin > Cost management.

## Testing without Snowflake

```
set ATELIER_DB=local
python -m server setup && python -m server catalog && python -m server simulate && python -m server refresh
```

This uses a DuckDB file (`server\work\local.duckdb`) with the same tables. `python -m pytest server\tests` runs the full loop this way.

## Files

| File | What it does |
| --- | --- |
| `__main__.py` | `python -m server` commands |
| `sf.py` | Snowflake / local DuckDB access, key generation |
| `schema.sql` | warehouse, database, tables |
| `catalog.py` | store catalog parsing and the store → H&M translation |
| `hm_features.py` | the 195 H&M purchase features for any shopper (verified against the pipeline) |
| `bundle.py` | serving bundle: frozen models + everything needed to score without H&M data |
| `score.py` | one homepage document per shopper (H&M model + session model + their settings + product ranking) |
| `refresh.py` | the refresh job and loop |
| `retrain.py` | hackathon-day retrain, comparison, upload |
| `simulate.py` | synthetic shoppers for testing |
| `app/` | files for the store repo: API routes, Snowflake client, event uploader, updated adapter (see `app/README.md`) |
