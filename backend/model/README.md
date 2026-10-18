# Shopper model v2: multi-window, no OTTO values, tested once on 2019

This folder holds the purchase-based models that shape each shopper's homepage (sections, categories, colors, department, sort) and rank the product tiles. v2 answers the review of 2026-10-14 (see [`REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md)); the v1 write-up is in [`README_v1.md`](README_v1.md).

It builds on the `atelier_data` package (dataset pipeline and scoring harness) from the repo root. The live browsing model is in `session_model/`.

## Results

**Validation = August 2020** (the dataset's "final" window, already looked at, so used openly to choose setups). **Test = the reserved 2019 window** (2019-08-26 to 2019-09-22) on **100,000 shoppers outside the cohort** that no model, tuning step or choice ever saw, **run once** after freezing.

| Decision | Metric | August (11,183 buyers) | **2019 test (15,035 buyers)** | Changed shoppers (2019) | Confirmed on 2019 |
| --- | --- | --- | --- | --- | --- |
| Section order | NDCG | +0.0285 [+0.0265, +0.0303] | **+0.0196 [+0.0180, +0.0212]** | 10,330 | yes |
| Color highlight | share of next purchases in the 2 highlighted colors | +0.060 [+0.052, +0.068] | **+0.047 [+0.039, +0.056]** | 6,281 | yes |
| Landing department | share | +0.0008 [−0.0004, +0.0020] | **+0.0022 [+0.0008, +0.0039]** | 265 (+0.127 each) | yes |
| Category order | NDCG | +0.0052 [+0.0039, +0.0065] | +0.0007 [−0.0006, +0.0021] | 13,201 | **no** |
| Category order | Hit@1 / Hit@3 | 0.719 vs 0.718 / 0.903 vs 0.887 | 0.680 vs 0.690 / 0.896 vs 0.888 | | |
| Default sort | position | 0 (bestsellers kept) | 0 | 0 | |

Gains are against the store default, 95% bootstrap CIs. "Confirmed" means the shoppers whose layout changed did better than under the default, CI above zero.

| Product tiles, MAP@12 | August | **2019 test** |
| --- | --- | --- |
| Model, already-bought items allowed | 0.0197 | **0.0202** |
| Baseline: previous purchases, then this week's popular | 0.0116 | 0.0126 |
| Baseline: this week's popular | 0.0047 | 0.0044 |
| Model, already-bought products hidden | 0.0054 | 0.0061 |
| Baseline: this week's popular (bought hidden) | 0.0041 | 0.0040 |

**What this means**
- **Sections and colors are the real wins.** They hold up on new shoppers in a different year, smaller than on August but clearly positive.
- **Category order is not confirmed.** It gained on August, but not on 2019, and Hit@1 got worse there. Don't headline it. The demo can still order categories by the model (it's harmless on average), but the "validated" flag in the homepage documents is `false`.
- **Product tiles:** the ranker beats "previous purchases + popular" by 1.6× on 2019, so it adds value beyond rebuying. But most of the lift over "popular" comes from showing items people already bought. With those hidden, it is only about 1.5× popular. Whether to hide them is a team decision; every tile carries a `bought_before` flag so the frontend can choose.
- **The 2019 test trains on later data.** The training windows run from Sep 2019 to Aug 2020; there isn't enough history before 2019-08-26 to train on earlier windows. So the test measures new shoppers in a different period, not a strict forecast from the past. The features are identical (all capped at 330 days of history).

## What changed from v1

| | v1 | v2 |
| --- | --- | --- |
| Training data | July buyers only (11,434) | 12 monthly windows: 11 from Sep 2019 to Jul 2020, plus July (151,686 labelled rows). The window that would overlap 2019-08-26 to 09-22 is skipped |
| Inputs | 37 fused values (incl. 10 OTTO) + 128 history features | 25 H&M profile values + last-10/3/1 shares + 2 bridge values + history: 197 features, **no OTTO**, no "same weeks last year", no 365-day windows, everything capped at 330 days |
| Category | seasonality offset, July only | seasonality offset, 12 windows |
| Department | multiclass + margin | blend of own share and popularity, weight per confidence level (h&m-model Option 1) |
| Sections | 4 regressions | one row per (shopper, section) with own-affinity features, LambdaRank, July only (h&m-model's setup) |
| Item ranker | July buyers | 12 windows, negatives sampled 15%, early stopping on held-out training shoppers |
| Tuning | margins on July out-of-fold | margins on out-of-fold predictions pooled over the 12 windows; setups chosen on August |
| Test | none | 2019, outside-cohort shoppers, once |

**Setups compared on August** (chosen per decision): category offset +0.0052 vs long-format −0.0027; department blend +0.0008 vs offset +0.0005; sections July-LambdaRank +0.0285 vs July cross-entropy +0.0231, July regressions +0.0227, 12-window regressions +0.0248, 12-window long-format +0.0183. Section labels shift a lot by season (sale share spikes in January and July), which is probably why pooling 12 windows didn't help sections. Full table: [`results/layouts_august.json`](results/layouts_august.json).

## Running it

From the repo root with the venv active (`.venv\Scripts\activate`):

```
python -m model windows     :: build the 11 training windows + dev + final (~20 min on 2 cores)
python -m model train       :: layout models, all setups, scored on August (~60 min on 2 cores)
python -m model items       :: item ranker + baselines on August, tiles for all 100k shoppers (~5 min)
python -m model freeze      :: pick per decision on August, fingerprint the model files
python -m model test2019    :: the one-time 2019 test (refuses a second run unless --i-know-this-is-a-rerun)
python -m model export      :: one homepage JSON per shopper from the frozen models (~1 min)
python -m model publish     :: upload to Supabase (project owner, service-role key)
```

`python -m model all` runs windows → train → items → freeze → export (not the 2019 test). Section variants trained on one window come from `python -c "from model import mw; mw.add_section_variants(['dev'])"` after `train`; `freeze` then picks among them. Everything writes to `model/work/` (gitignored); `model/results/` keeps the small result files that back every number above.

The 2019 test has already run (`model/results/test_2019.json`, marker `model/work/frozen/TEST_2019_DONE`). Running it again after changing anything is tuning on the test, so the command refuses unless you pass `--i-know-this-is-a-rerun`, and the report records that it was a rerun.

## Files

| File | What it does |
| --- | --- |
| `windows.py` | Window plan (11 pseudo-windows, reserved-overlap guard, 330-day cap) and the builder: units, reference tables, targets, profiles (all/10/3/1), bridge, history, via the dataset pipeline's own functions |
| `history.py` | Purchase-history features, capped at 330 days |
| `mw.py` | v2 layout models: every setup, out-of-fold tuning over windows, August scoring, section variants |
| `items.py`, `items_mw.py` | Item candidates and features; v2 ranker, baselines, both display policies, tile export |
| `test2019.py` | Freeze (fingerprints) and the one-time 2019 test |
| `export.py`, `publish.py`, `schema.sql` | Homepage documents (v2 when frozen models exist) and Supabase upload |
| `layout.py`, `run.py`, `common.py` | Shared helpers and the v1 pipeline (`v1-*` commands) |
| `results/` | `test_2019.json`, `layouts_august.json`, `items_august.json`, the frozen choice and fingerprints |

## Caveats

- **August was used to choose setups,** so its numbers are optimistic. 2019 is the clean number.
- **2019 is new shoppers in an earlier year, scored by models trained on later windows** (see above).
- **The demo's live layer is a different model** (`session_model/`), trained on OTTO; its accuracy is not part of this test.
- Offline evaluation only: no causal claims (these are past purchases, not an A/B test), no privacy claims.
