# Response to the 2026-10-14 review of the model branches

Each item from the review, what was done, and what came out. Numbers are from `model/results/`.

## 1. The reserved 2019 test couldn't fairly test `model`

**Done.**
- **Features capped at 330 days.** All features now look back at most 330 days (`HISTORY_CAP_DAYS`), and the "same weeks last year" and 365-day features were removed. At 2019-08-26 there are about 340 days of history, so every cutoff from then on sees identical feature definitions.
- **Clean test population.** The test uses 100,000 shoppers **outside** the cohort, 25,000 per history group, picked by salted hash (`hm-reserved-test-v1|`), with history groups computed from purchases before 2019-08-26.
- **2019 built by the pipeline itself.** Units, reference tables, profiles, history and targets for 2019 come from the dataset pipeline's own functions (`windows.py`), in a separate run folder; the frozen dataset files were not changed.
- **Run once, after freezing.** `test2019.py` checks the fingerprints and refuses a second run unless told otherwise; the run is recorded.

**Result:** sections, colors and department are confirmed; category order is not (table in `README.md`).

**Remaining caveat:** the 11 training windows lie after 2019-08-26, because there isn't enough earlier history to train on. The test is "new shoppers, earlier period", not a strict forecast.

## 2. Category order isn't proven yet

**Confirmed by the test: it isn't.** The 12-window version gained +0.0052 on August, but only **+0.0007 [−0.0006, +0.0021] on 2019**, with Hit@1 down (0.680 vs 0.690). The homepage documents mark it `validated: false`, and the docs no longer headline it.

## 3. The h&m-model product-ranking claim is inflated

**Done.**
- **Reporting MAP@12 on real candidates.** The "62.2% in top 10 vs 52.7%" figure (purchased items mixed with 100 random items) is no longer used. MAP@12 on the real candidates is: model 0.0202, popular 0.0044 on 2019.
- **Added the "previous purchases + this week's popular" baseline:** 0.0126 on 2019. The ranker beats it by 1.6×, so it does more than rebuy, but most of the lift over "popular" comes from rebuy candidates.
- **Hide vs show already-bought items:** both policies are now measured. Hiding already-bought products drops MAP@12 to 0.0061 (popular: 0.0040). Every tile in the export carries `bought_before`, so the team can choose in the frontend.

## 4. Each branch wins on a different decision

**Done: merged per decision, chosen on August, confirmed on 2019.**

| Decision | Setup used | From | August | 2019 |
| --- | --- | --- | --- | --- |
| Sections | one row per (shopper, section), own-affinity features, LambdaRank, July only | h&m-model | +0.0285 | +0.0196 |
| Category | seasonality offset, 12 windows | model | +0.0052 | +0.0007 (not confirmed) |
| Department | own share / popularity blend, weight per confidence level | h&m-model | +0.0008 | +0.0022 |
| Colors | multiclass + margin, 12 windows | model | +0.060 (6,324 changed) | +0.047 (6,281 changed) |

The changed-shopper count is now reported next to every gain (`changed_users` in every result file), and Hit@1 is reported next to category NDCG.

## 5. The quick-access "4.5×" shows targeting, not a gain

**Agreed; wording corrected.** "Baby & Kids tile holders buy baby clothes next month 4.5× as often as average" shows the tile goes to the right people. That's good evidence for the "Why am I seeing this?" text, but not a measured effect of the tile. It should be presented as **targeting accuracy**, never as uplift. A text fix for the h&m-model README is in `results/hm_model_readme_corrections.md`.

## 6. The live session model may not carry over to the demo

**Done (code); numbers come from the next `python -m session_model all` on the OTTO machine.**
- **Single-visit evaluation:** R² measured only on prefixes that stay within one visit, which is what a demo visitor produces. **The UI gate now uses this single-visit R²**, so a feature only switches on if the model is reliable for a one-visit session.
- **Same-shopper comparison:** the purchase-pattern (bridge) model and the live-click model are compared on the **same** held-out OTTO shoppers (those who ordered). This replaces the old comparison of two different groups.
- **Not yet addressed:** the demo is still a different store. Features like `n_visits` or `cart_after_research` can't take multi-visit values in one short visit; the single-visit table shows how much accuracy remains without them.

## 7. The OTTO values add nothing to the purchase models

**Done.** They were removed from the layout models and the item ranker (197 features, none from OTTO). OTTO is used only in the UI layer where it's labelled "Estimated" (grid density and Recently Viewed in the homepage documents) and in the live session model.

## 8. Smaller notes

- **Dev optimism:** margins are now tuned on out-of-fold predictions pooled over the 12 training windows, setups are chosen on August, and the clean number is 2019.
- **More windows for LightGBM:** done. It helped category (+0.0041 → +0.0052 on August, though not confirmed on 2019) and the item ranker (MAP@12 0.0178 → 0.0197 on August). It didn't help sections, where July-only training stayed best.
- **Hit@1 next to NDCG:** reported. On 2019, category Hit@1 dropped by 0.009 while Hit@3 rose by 0.009.

## Suggested order: as followed

1. Clean test settled (cap, outside-cohort sample, guard).
2. Purchase models retrained on 12 windows, skipping the reserved one.
3. Merged the better setup per decision.
4. Baselines and changed-shopper counts added.
5. Frozen, then 2019 run once (2026-10-15 21:37).
