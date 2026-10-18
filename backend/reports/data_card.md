# SOCAL ATELIER Compact Shopper Profile Dataset, v1 (frozen 2026-10-04)

## Source and license
H&M Personalized Fashion Recommendations (Kaggle). Non-commercial academic use; no redistribution of
competition data. This build releases only aggregate reports; row-level files are private.

## Scope of this release
Data preparation only: profiles, splits, cohort, held-out targets, references, catalog, compressed
representations and an exposure audit, plus a scoring harness (targets, metrics, baselines). Layout rules
are shipped only as **rules v1: hand-written baseline**; choosing a canonical representation size is left to the
model stage. Pipeline reference: `docs/PIPELINE.md`.

## Cohort
100,000 customers, 25,000 per history stratum (light 1–2, lower-mid 3–5, upper-mid 6–10, heavy 11+ units
before 2020-07-29); selected by salted hash; inclusion weights stored. Eligible customers per stratum:
light 251,002, lower_mid 238,863, upper_mid 215,848, heavy 613,690.

## Time splits
Profiles before 2020-07-29 (development) and 2020-08-26 (final). Development target [2020-07-29, 2020-08-26); final target [2020-08-26, 2020-09-23).
**Reserved:** cutoff 2019-08-26 (target window [2019-08-26, 2019-09-23)) is reserved, untouched, for
the model's final test. No cohort, reference, profile, target or score has been built for it.

## Profile
25 values (listed with formulas in `docs/PIPELINE.md`). Channel 2 means online (store channel 1 collapsed in April 2020: ratio 0.00 vs 1.98).
Unmapped colors: none. Markdown = unit price ≤ 0.70 × the article's 0.90-quantile anchor (threshold chosen outcome-blind from the seasonal markdown scan; see DATA_LOG.md).

Reliability (Spearman, early vs late half of each history, dev cutoff, 48,447 customers):
blocks category 0.38, department 0.51, color_family 0.22; lowest features novelty_affinity 0.22, color_warm 0.22, color_neutral 0.23, color_cool 0.23, solid_share 0.23.
Decisions whose owning features fall below 0.4: category_order, color_highlight, default_sort, hero, hero_category, section_order (reported only; the rules v1 baseline was not re-run with them disabled).
Markdown proxy (final cutoff): monthly markdown share peak-to-trough 6.78 (peak 2019-07, trough 2019-04); Spearman of markdown_affinity vs the 0.90 anchor: q0.75 0.94, q0.50 0.77, first_price 0.95.

## Representations
Every (history E ∈ {1, 3, 10, all}) × (size D ∈ {4, 8, 25}) × (precision float32/int8) for PCA, mutual-information selection and random subsets (identity at D = 25), with codes and reconstructions saved per configuration. Held-out reconstruction error, final cutoff, E = all:

| Configuration | Bytes | Held-out RMSE | Held-out MAE |
| --- | --- | --- | --- |
| Eall_D4_mi_int8 | 4 | 0.1123 | 0.0600 |
| Eall_D4_pca_int8 | 4 | 0.0846 | 0.0470 |
| Eall_D4_random_int8 | 4 | 0.1100 | 0.0589 |
| Eall_D8_mi_int8 | 8 | 0.1089 | 0.0536 |
| Eall_D8_pca_int8 | 8 | 0.0711 | 0.0383 |
| Eall_D8_random_int8 | 8 | 0.0909 | 0.0442 |
| Eall_D4_mi_float32 | 16 | 0.1123 | 0.0600 |
| Eall_D4_pca_float32 | 16 | 0.0846 | 0.0470 |
| Eall_D4_random_float32 | 16 | 0.1100 | 0.0588 |
| Eall_D25_identity_int8 | 25 | 0.0009 | 0.0007 |
| Eall_D8_mi_float32 | 32 | 0.1089 | 0.0535 |
| Eall_D8_pca_float32 | 32 | 0.0710 | 0.0383 |
| Eall_D8_random_float32 | 32 | 0.0909 | 0.0440 |
| Eall_D25_identity_float32 | 100 | 0.0000 | 0.0000 |

## Scoring harness results (rules v1: hand-written baseline, final window)
11,183 eval users; 10,618 sort-eval users. Gains are paired per-user differences with 95% bootstrap CIs. 'Validated' = users whose layout the decision changed did better than the store default (CI above 0).

| Decision | Metric | Adapted | Store default | Gain (95% CI) | vs recent popularity | Changed users | Validated |
| --- | --- | --- | --- | --- | --- | --- | --- |
| category_order | cat_ndcg | 0.8006 | 0.8206 | -0.0200 [-0.0228, -0.0173] | -0.0200 [-0.0226, -0.0174] | 9,639 | no |
| landing_department | dept_share | 0.6290 | 0.6264 | 0.0026 [-0.0005, 0.0057] | 0.0026 [-0.0005, 0.0058] | 566 | no |
| section_order | section_ndcg | 0.7800 | 0.8347 | -0.0547 [-0.0591, -0.0502] | — | 8,574 | no |
| default_sort | sort_gain | 0.7591 | 0.8658 | -0.1067 [-0.1111, -0.1025] | — | 3,935 | no |
| color_highlight | color_share | 0.5447 | 0.5414 | 0.0034 [-0.0086, 0.0152] | — | 2,401 | no |

Baselines alone: all-time popularity cat_ndcg 0.8206, recent (28-day) popularity 0.8206.

## Exposure
Attacker trains on split A (49,113) and tests on split B (49,465); age bands <25, 25-34, 35-49, 50+. Chance AUC 0.5; linkability over 10,000 early/late half pairs (chance top-1 = 1/n). Representations as shipped (float32 codes rounded to 2 decimals for uniqueness; uint8 codes as is). No utility axis in this build.

| Configuration | Bytes | Unique share | Age AUC (attacker) | Majority macro-F1 / attacker macro-F1 | Link top-1 (chance) |
| --- | --- | --- | --- | --- | --- |
| Eall_D4_mi_int8 | 4 | 0.336 | 0.5788 (hgb) | 0.108 / 0.278 | 0.0084 (0.00010) |
| Eall_D4_pca_int8 | 4 | 0.884 | 0.5925 (hgb) | 0.108 / 0.327 | 0.0036 (0.00010) |
| Eall_D4_random_int8 | 4 | 0.493 | 0.5791 (mean of draws) | 0.108 / 0.304 | 0.0065 (0.00010) |
| Eall_D8_mi_int8 | 8 | 0.702 | 0.5926 (hgb) | 0.108 / 0.299 | 0.0072 (0.00010) |
| Eall_D8_pca_int8 | 8 | 0.979 | 0.6268 (hgb) | 0.108 / 0.362 | 0.0101 (0.00010) |
| Eall_D8_random_int8 | 8 | 0.863 | 0.6093 (mean of draws) | 0.108 / 0.346 | 0.0076 (0.00010) |
| Eall_D4_mi_float32 | 16 | 0.182 | 0.5789 (hgb) | 0.108 / 0.280 | 0.0249 (0.00010) |
| Eall_D4_pca_float32 | 16 | 0.996 | 0.5930 (hgb) | 0.108 / 0.328 | 0.0038 (0.00010) |
| Eall_D4_random_float32 | 16 | 0.261 | 0.5799 (mean of draws) | 0.108 / 0.308 | 0.0135 (0.00010) |
| Eall_D25_identity_int8 | 25 | 0.997 | 0.6665 (hgb) | 0.108 / 0.407 | 0.0166 (0.00010) |
| Eall_D8_mi_float32 | 32 | 0.616 | 0.5928 (hgb) | 0.108 / 0.302 | 0.0078 (0.00010) |
| Eall_D8_pca_float32 | 32 | 0.998 | 0.6270 (hgb) | 0.108 / 0.364 | 0.0110 (0.00010) |
| Eall_D8_random_float32 | 32 | 0.791 | 0.6101 (mean of draws) | 0.108 / 0.347 | 0.0088 (0.00010) |
| Eall_D25_identity_float32 | 100 | 0.993 | 0.6663 (hgb) | 0.108 / 0.409 | 0.0169 (0.00010) |

Ablation (HGB, full profile AUC 0.6663): dropping department −0.0294, category −0.0196, frequency −0.0050, mainstream −0.0020; 'ablated' (no department + category) AUC 0.6156, link top-1 0.0078.

Leakage check (dev cutoff, 2,000 customers rebuilt from a source physically limited to t_dat < 2020-07-29): passed.

## Intended use
Hackathon demo and research on compact layout personalization; input data for the model stage.

## Not supported / never claim
Browsing style (deferred). Causal effect of layouts on behavior. Privacy, anonymity or differential privacy.
Lower exposure for a compact representation is not claimed: that needs matched utility, measured by the model stage.

## Known limitations
Purchases are not browsing; markdown is a proxy; same-day rows approximate baskets; single retailer;
pandemic-period data; hero, grid and filter rules are assumptions; the rules v1 layouts lose to fixed
baselines on most tested decisions; several features have low early/late reliability; the MI selection
uses development-window labels (top target category), so MI codes are not label-free.
