# DATA_LOG

## Decisions made during build

- Python 3.12 via uv (machine had only 3.13/3.14).
- duckdb.max_temp_directory_size added to config.yaml (8GB) per plan amendment; data/tmp is cleared after every stage.
- Verify 'column sets match': exact set for transactions and customers; required subset for articles (spec says 'includes').
- Verify-time color unmapped share and price-anomaly counts use all data (descriptive source checks); anomaly median there is the all-data per-article median.
- Verify age/postal checks are computed by exposure.source_checks() so age and postal code are only loaded inside exposure.py.
- Ingest uses try_strptime for t_dat so unparseable dates become null and are dropped and logged; all strings trimmed, including customer_id.
- Raw zip files are kept next to the CSVs in data/raw.
- Within a cutoff: row view (anomaly flag, row price percentile) -> unit groups -> article/population references (resolves 8.5/8.6 order).
- Units parquet stores keys and numeric fields only; attributes are integer codes on articles.parquet joined at aggregation time.
- Target unit price_mean excludes rows with price <= 0 or below price_anomaly_ratio x the cutoff's article median (same anomaly rule as features).
- MI sample 'hash order' uses showcase_hash (the only hash stored in cohort.parquet).
- Reason templates render whenever a rule chose the value from data; 'Store default' when it fell back (low confidence, disabled, no trigger). Disabled decisions get validated: null.
- Users with zero non-null-department target units are excluded from dept_share (counted).
- feature_labels: category -> raw product group name; department -> config name; layout_rules feature_labels where defined; else humanized key.
- Color reason lists colors lowercase joined with ' and '.
- results.json per_stratum carries the headline blocks minus targeting/shuffle; population_weighted carries point estimates only.
- compression_curve has every non-random final configuration plus one E{E}_D{D}_random_{precision} row (mean and sd over draws).
- Catalog allocation: minimum 2 per cell with >= 2 deduped articles, remainder by largest remainder on recent_units share, capped by cell size; overflow redistributed the same way.
- Bestsellers flag: rank <= ceil(bestseller_top_fraction x n) among articles with recent_units >= 1, ties by article_key.
- Raw scalar values (price_level, purchase_frequency, mainstream_score) and per-color/group sums are rounded to 9 decimals before ECDF lookups and tie-break sorts, because DuckDB parallel float sums differ in the last bits between runs and would otherwise break mid-rank ties.
- features.markdown_ratio changed 0.90 -> 0.70 (user-approved, outcome-blind). Scan over population units before C_dev with dev anchors (validity.markdown_ratio_scan -> reports/markdown_threshold.json): peak-to-trough 0.90: 2.555 (peak 2019-12, trough 2019-04), 0.80: 3.424 (2019-07 / 2019-05), 0.70: 6.786 (2019-07 / 2019-04); sale-season (Jun, Jul, Dec, Jan) vs other months 1.213 / 1.430 / 2.209; top months at 0.70: 2019-07, 2019-12, 2020-01, 2019-08. price/anchor deciles p10..p90: 0.50, 0.69, 0.80, 0.90, 1.00, 1.00, 1.00, 1.00, 1.00. 0.70 has the clearest seasonal contrast. The catalog markdown flag and the sale section flag use the same ratio.
- duckdb memory_limit 6GB and threads 6 (user-requested after smoke peak footprint 9.66 GB).
- Share blocks (category, department, color family) are rounded to 6 decimals with the rounding residual added to each row's largest share, so every block sums to 1 within 1e-6 (plain rounding drifted up to 3e-6).
- Spec test_markdown_anchor fixture row moved from 8.0 to 6.5: with markdown_ratio 0.70, 8.0 vs anchor 10.0 is no longer markdown.
- Catalog `color` is perceived_colour_master_name (matches the master colors used by color_highlight); articles with no department are excluded from the catalog.
- Targeting test and shuffle control are computed at both cutoffs; results.json reports the final cutoff.

## Stage entries

### 2026-10-04T16:54:09 | ingest:articles
- rows: `{"in": 105542, "out": 105542, "drops": {}}`

### 2026-10-04T16:54:16 | ingest:transactions
- rows: `{"in": 31788324, "out": 31788324, "drops": {"null t_dat/customer_id/article_id": 0, "article_id missing from articles": 0}}`

### 2026-10-04T16:54:18 | ingest:customers
- rows: `{"in": 1371980, "out": 1371980, "drops": {"null customer_id": 0}}`

### 2026-10-04T16:54:18 | runtime:ingest
- 23.2s

### 2026-10-04T16:54:29 | verify
- 0 hard failures

### 2026-10-04T16:54:29 | runtime:verify
- 8.3s

### 2026-10-04T16:54:32 | splits
- C_dev=2020-07-29 C_final=2020-08-26

### 2026-10-04T16:54:32 | runtime:splits
- 0.0s

### 2026-10-04T16:54:44 | cohort
- rows: `{"in": 1319403, "out": 100000, "drops": {"not selected by hash/stratum": 1219403}}`
- eligible={'light': 251002, 'lower_mid': 238863, 'upper_mid': 215848, 'heavy': 613690} selected={'light': 25000, 'lower_mid': 25000, 'upper_mid': 25000, 'heavy': 25000}

### 2026-10-04T16:54:44 | runtime:cohort
- 10.6s

### 2026-10-04T16:54:57 | build:units_dev
- 29,614,449 rows before 2020-07-29 -> 26,609,024 unit groups

### 2026-10-04T16:56:04 | references:repeatability_references_dev
- population scalar tables computed twice over 1,319,403 customers; differing percentiles: {'price_level': 0, 'purchase_frequency': 0, 'mainstream_score': 0}

### 2026-10-04T16:56:05 | build:targets_dev
- 47,711 target unit groups in [2020-07-29, 2020-08-26)

### 2026-10-04T16:56:08 | build:profiles_dev_E1
- rows: `{"in": 100000, "out": 100000, "drops": {"no units before cutoff": 0}}`

### 2026-10-04T16:56:10 | build:profiles_dev_E3
- rows: `{"in": 100000, "out": 100000, "drops": {"no units before cutoff": 0}}`

### 2026-10-04T16:56:13 | build:profiles_dev_E10
- rows: `{"in": 100000, "out": 100000, "drops": {"no units before cutoff": 0}}`

### 2026-10-04T16:56:16 | build:profiles_dev_Eall
- rows: `{"in": 100000, "out": 100000, "drops": {"no units before cutoff": 0}}`

### 2026-10-04T16:56:21 | build:halves_dev
- rows: `{"in": 100000, "out": 48447, "drops": {"units_used < min_units": 50000, "a half with < 3 units": 1553}}`

### 2026-10-04T16:56:34 | build:units_final
- 30,744,934 rows before 2020-08-26 -> 27,636,965 unit groups

### 2026-10-04T16:58:00 | references:repeatability_references_final
- population scalar tables computed twice over 1,339,660 customers; differing percentiles: {'price_level': 0, 'purchase_frequency': 0, 'mainstream_score': 0}

### 2026-10-04T16:58:02 | build:targets_final
- 43,236 target unit groups in [2020-08-26, 2020-09-23)

### 2026-10-04T16:58:05 | build:profiles_final_E1
- rows: `{"in": 100000, "out": 100000, "drops": {"no units before cutoff": 0}}`

### 2026-10-04T16:58:08 | build:profiles_final_E3
- rows: `{"in": 100000, "out": 100000, "drops": {"no units before cutoff": 0}}`

### 2026-10-04T16:58:11 | build:profiles_final_E10
- rows: `{"in": 100000, "out": 100000, "drops": {"no units before cutoff": 0}}`

### 2026-10-04T16:58:15 | build:profiles_final_Eall
- rows: `{"in": 100000, "out": 100000, "drops": {"no units before cutoff": 0}}`

### 2026-10-04T16:58:20 | build:halves_final
- rows: `{"in": 100000, "out": 49570, "drops": {"units_used < min_units": 48887, "a half with < 3 units": 1543}}`

### 2026-10-04T16:58:21 | runtime:build
- 214.2s

### 2026-10-04T16:58:26 | evaluate:dev
- eval users 11434, sort-eval 10951; category_order gain 0.0004051682762880722 ci [-0.002481591930159323, 0.0030561377761383632]; landing_department gain -0.0043907199245766994 ci [-0.007274407956079706, -0.0014309767809532966]; section_order gain -0.07213045458780454 ci [-0.07679165745526029, -0.06807478919514455]; default_sort gain -0.11405660754769499 ci [-0.11834897062744164, -0.10999991743515122]; color_highlight gain 0.002989043774695116 ci [-0.00901512105719453, 0.016733121689545088]

### 2026-10-04T16:58:28 | evaluate:final
- eval users 11183, sort-eval 10618; category_order gain -0.020001223570805114 ci [-0.022817654360625876, -0.017347060133731163]; landing_department gain 0.0025965798043742945 ci [-0.0005415610087913748, 0.0056945464303285245]; section_order gain -0.054695220619854545 ci [-0.05913400973269189, -0.05021724517178562]; default_sort gain -0.10675703357646191 ci [-0.11107904099221784, -0.10251957177443284]; color_highlight gain 0.0033635948796598143 ci [-0.008573144665076353, 0.015244577792711421]

### 2026-10-04T16:58:28 | evaluate:frozen
- decision: store_default_sort=bestsellers
- decision: default_section_order=['bestsellers', 'sale', 'new_in', 'buy_again']
- decision: headline_category_metrics=['cat_ndcg', 'cat_hit3'] (popularity hit3 0.8358)

### 2026-10-04T16:58:28 | runtime:evaluate
- 4.5s

### 2026-10-04T16:58:38 | export
- 1000 shoppers, 400 catalog articles; cohort share with layout != store defaults: {'light': 0.52428, 'lower_mid': 0.75812, 'upper_mid': 0.99968, 'heavy': 0.99996}

### 2026-10-04T16:58:38 | runtime:export
- 7.9s

### 2026-10-04T17:00:03 | references:repeatability_leak_refs_dev
- population scalar tables computed twice over 1,319,403 customers; differing percentiles: {'price_level': 0, 'purchase_frequency': 0, 'mainstream_score': 0}

### 2026-10-04T17:00:04 | leakage-check
- passed=False

### 2026-10-04T17:03:03 | references:repeatability_diag_refs
- population scalar tables computed twice over 1,319,403 customers; differing percentiles: {'price_level': 0, 'purchase_frequency': 0, 'mainstream_score': 0}

### 2026-10-04T17:04:24 | build:units_dev
- 29,614,449 rows before 2020-07-29 -> 26,609,024 unit groups

### 2026-10-04T17:05:43 | references:repeatability_references_dev
- population scalar tables computed twice over 1,319,403 customers; differing percentiles: {'price_level': 0, 'purchase_frequency': 0, 'mainstream_score': 0}

### 2026-10-04T17:05:46 | build:targets_dev
- 47,711 target unit groups in [2020-07-29, 2020-08-26)

### 2026-10-04T17:05:49 | build:profiles_dev_E1
- rows: `{"in": 100000, "out": 100000, "drops": {"no units before cutoff": 0}}`

### 2026-10-04T17:05:52 | build:profiles_dev_E3
- rows: `{"in": 100000, "out": 100000, "drops": {"no units before cutoff": 0}}`

### 2026-10-04T17:05:55 | build:profiles_dev_E10
- rows: `{"in": 100000, "out": 100000, "drops": {"no units before cutoff": 0}}`

### 2026-10-04T17:05:59 | build:profiles_dev_Eall
- rows: `{"in": 100000, "out": 100000, "drops": {"no units before cutoff": 0}}`

### 2026-10-04T17:06:03 | build:halves_dev
- rows: `{"in": 100000, "out": 48447, "drops": {"units_used < min_units": 50000, "a half with < 3 units": 1553}}`

### 2026-10-04T17:06:18 | build:units_final
- 30,744,934 rows before 2020-08-26 -> 27,636,965 unit groups

### 2026-10-04T17:07:43 | references:repeatability_references_final
- population scalar tables computed twice over 1,339,660 customers; differing percentiles: {'price_level': 0, 'purchase_frequency': 0, 'mainstream_score': 0}

### 2026-10-04T17:07:45 | build:targets_final
- 43,236 target unit groups in [2020-08-26, 2020-09-23)

### 2026-10-04T17:07:47 | build:profiles_final_E1
- rows: `{"in": 100000, "out": 100000, "drops": {"no units before cutoff": 0}}`

### 2026-10-04T17:07:50 | build:profiles_final_E3
- rows: `{"in": 100000, "out": 100000, "drops": {"no units before cutoff": 0}}`

### 2026-10-04T17:07:53 | build:profiles_final_E10
- rows: `{"in": 100000, "out": 100000, "drops": {"no units before cutoff": 0}}`

### 2026-10-04T17:07:56 | build:profiles_final_Eall
- rows: `{"in": 100000, "out": 100000, "drops": {"no units before cutoff": 0}}`

### 2026-10-04T17:08:00 | build:halves_final
- rows: `{"in": 100000, "out": 49570, "drops": {"units_used < min_units": 48887, "a half with < 3 units": 1543}}`

### 2026-10-04T17:08:00 | runtime:build
- 229.2s

### 2026-10-04T17:08:05 | evaluate:dev
- eval users 11434, sort-eval 10951; category_order gain 0.0004051682762880722 ci [-0.002481591930159323, 0.0030561377761383632]; landing_department gain -0.0043907199245766994 ci [-0.007274407956079706, -0.0014309767809532966]; section_order gain -0.07213045458780454 ci [-0.07679165745526029, -0.06807478919514455]; default_sort gain -0.11405773862633661 ci [-0.11835928138542157, -0.11000402775593708]; color_highlight gain 0.002989043774695116 ci [-0.00901512105719453, 0.016733121689545088]

### 2026-10-04T17:08:07 | evaluate:final
- eval users 11183, sort-eval 10618; category_order gain -0.020001223570805114 ci [-0.022817654360625876, -0.017347060133731163]; landing_department gain 0.0025965798043742945 ci [-0.0005415610087913748, 0.0056945464303285245]; section_order gain -0.054695220619854545 ci [-0.05913400973269189, -0.05021724517178562]; default_sort gain -0.10673050682269038 ci [-0.11107657491666276, -0.10247841972309606]; color_highlight gain 0.0033635948796598143 ci [-0.008573144665076353, 0.015244577792711421]

### 2026-10-04T17:08:07 | evaluate:frozen
- decision: store_default_sort=bestsellers
- decision: default_section_order=['bestsellers', 'sale', 'new_in', 'buy_again']
- decision: headline_category_metrics=['cat_ndcg', 'cat_hit3'] (popularity hit3 0.8358)

### 2026-10-04T17:08:07 | runtime:evaluate
- 4.4s

### 2026-10-04T17:08:16 | export
- 1000 shoppers, 400 catalog articles; cohort share with layout != store defaults: {'light': 0.52428, 'lower_mid': 0.75812, 'upper_mid': 0.99968, 'heavy': 0.99996}

### 2026-10-04T17:08:16 | runtime:export
- 7.1s

### 2026-10-04T17:10:05 | references:repeatability_leak_refs_dev
- population scalar tables computed twice over 1,319,403 customers; differing percentiles: {'price_level': 0, 'purchase_frequency': 0, 'mainstream_score': 0}

### 2026-10-04T17:10:08 | leakage-check
- passed=True

### 2026-10-04T17:10:08 | runtime:leakage-check
- 110.9s

### 2026-10-04T17:39:08 | validity
- reliability on 48447 dev halves; below 0.4: ['category_order', 'color_highlight', 'default_sort', 'hero', 'hero_category', 'section_order']; markdown peak-to-trough 6.784

### 2026-10-04T17:39:08 | runtime:validity
- 28.6s

### 2026-10-04T17:39:12 | evaluate:dev
- eval users 11434, sort-eval 10951; category_order gain 0.0004051682762880722 ci [-0.002481591930159323, 0.0030561377761383632]; landing_department gain -0.0043907199245766994 ci [-0.007274407956079706, -0.0014309767809532966]; section_order gain -0.07213045458780454 ci [-0.07679165745526029, -0.06807478919514455]; default_sort gain -0.11405773862633661 ci [-0.11835928138542157, -0.11000402775593708]; color_highlight gain 0.002989043774695116 ci [-0.00901512105719453, 0.016733121689545088]

### 2026-10-04T17:39:14 | evaluate:final
- eval users 11183, sort-eval 10618; category_order gain -0.020001223570805114 ci [-0.022817654360625876, -0.017347060133731163]; landing_department gain 0.0025965798043742945 ci [-0.0005415610087913748, 0.0056945464303285245]; section_order gain -0.054695220619854545 ci [-0.05913400973269189, -0.05021724517178562]; default_sort gain -0.10673050682269038 ci [-0.11107657491666276, -0.10247841972309606]; color_highlight gain 0.0033635948796598143 ci [-0.008573144665076353, 0.015244577792711421]

### 2026-10-04T17:39:14 | evaluate:frozen
- decision: store_default_sort=bestsellers
- decision: default_section_order=['bestsellers', 'sale', 'new_in', 'buy_again']
- decision: headline_category_metrics=['cat_ndcg', 'cat_hit3'] (popularity hit3 0.8358)

### 2026-10-04T17:39:14 | runtime:evaluate
- 4.3s

### 2026-10-04T17:39:47 | compress:dev
- 200 configurations written to /Users/Lenovo/Development/LA-Hacks-Dataset/data/processed/representations/dev

### 2026-10-04T17:40:19 | compress:final
- 200 configurations written to /Users/Lenovo/Development/LA-Hacks-Dataset/data/processed/representations/final

### 2026-10-04T17:40:19 | runtime:compress
- 63.8s

### 2026-10-04T17:52:43 | audit
- 200 configurations; full AUC 0.6663 (hgb), link top1 0.0169, unique 0.9933; ablation dropped ['department', 'category']

### 2026-10-04T17:52:43 | runtime:audit
- 742.7s

### 2026-10-04T17:52:50 | export
- 1000 shoppers, 400 catalog articles; cohort share with layout != store defaults: {'light': 0.52428, 'lower_mid': 0.75812, 'upper_mid': 0.99968, 'heavy': 0.99996}

### 2026-10-04T17:52:51 | runtime:export
- 6.0s

### 2026-10-04T17:54:28 | references:repeatability_leak_refs_dev
- population scalar tables computed twice over 1,319,403 customers; differing percentiles: {'price_level': 0, 'purchase_frequency': 0, 'mainstream_score': 0}

### 2026-10-04T17:54:29 | leakage-check
- passed=True

### 2026-10-04T17:54:29 | runtime:leakage-check
- 97.0s

### 2026-10-04T17:54:37 | manifest
- 858 files checksummed; freeze point C recorded

### 2026-10-04T17:54:37 | runtime:manifest
- 5.0s

### 2026-10-04T17:55:20 | decisions:data-only-scope
- decision: Scope changed to data preparation only (user, 2026-10-04): rules v2 (M3.5) stopped before any run and its code reverted from the Freeze A snapshot; Freeze A outputs archived privately in data/snapshots/; dataset v1 frozen with artifact checksums (build_manifest.json, freeze 'dataset-v1').
- decision: Scoring harness: recent-popularity baselines (population units in the 28 days before the cutoff) added for category order and landing department; at both cutoffs the recent order equals the all-time order, so the two baselines coincide.
- decision: Validated flag: a tested decision is validated only if users whose layout it changed did better than the store default (95% CI of the mean difference above 0); the targeting test is reported separately. For color highlight the comparator is the population's top-2 colors (the default shows none).
- decision: Copy (layout_rules copy_revision 2): per-feature phrases with correct verb agreement; displayed percentiles clamped to 1st..99th. shoppers.json and results.json are labeled 'rules v1: hand-written baseline'.
- decision: M4 data only: codes and reconstructions saved for every (cutoff, E, D, precision, draw); no utility-based selection (selection.json not produced) and no compressed-layout variants in shoppers.json; canonical_config is null.
- decision: MI feature selection uses development-window labels (top target category) as the spec defines; the fixture leakage test therefore covers PCA/identity/random compressors only.
- decision: M5 without a utility axis: no fairness-by-age utility and no matched-utility frontier; reliability is reported as data quality and not used to disable rules v1 decisions.
- decision: Cutoff 2019-08-26 (target [2019-08-26, 2019-09-23)) is reserved, untouched, for the model's final test.
- decision: append_preflight moved from verify.py to config.py to break an import cycle (cohort -> verify -> exposure -> compress -> targets -> features -> cohort).

### 2026-10-04T17:55:24 | manifest
- 858 files checksummed; freeze point C recorded

### 2026-10-04T17:55:24 | runtime:manifest
- 3.9s

### 2026-10-04T18:22:27 | compress:dev
- 200 configurations written to /Users/Lenovo/Development/LA-Hacks-Dataset/data/processed/representations/dev

### 2026-10-04T18:22:59 | compress:final
- 200 configurations written to /Users/Lenovo/Development/LA-Hacks-Dataset/data/processed/representations/final

### 2026-10-04T18:22:59 | runtime:compress
- 66.5s

### 2026-10-04T18:23:04 | evaluate:dev
- eval users 11434, sort-eval 10951; category_order gain 0.0004051682762880722 ci [-0.002481591930159323, 0.0030561377761383632]; landing_department gain -0.0043907199245766994 ci [-0.007274407956079706, -0.0014309767809532966]; section_order gain -0.07213045458780454 ci [-0.07679165745526029, -0.06807478919514455]; default_sort gain -0.11405773862633661 ci [-0.11835928138542157, -0.11000402775593708]; color_highlight gain 0.002989043774695116 ci [-0.00901512105719453, 0.016733121689545088]

### 2026-10-04T18:23:06 | evaluate:final
- eval users 11183, sort-eval 10618; category_order gain -0.020001223570805114 ci [-0.022817654360625876, -0.017347060133731163]; landing_department gain 0.0025965798043742945 ci [-0.0005415610087913748, 0.0056945464303285245]; section_order gain -0.054695220619854545 ci [-0.05913400973269189, -0.05021724517178562]; default_sort gain -0.10673050682269038 ci [-0.11107657491666276, -0.10247841972309606]; color_highlight gain 0.0033635948796598143 ci [-0.008573144665076353, 0.015244577792711421]

### 2026-10-04T18:23:06 | evaluate:frozen
- decision: store_default_sort=bestsellers
- decision: default_section_order=['bestsellers', 'sale', 'new_in', 'buy_again']
- decision: headline_category_metrics=['cat_ndcg', 'cat_hit3'] (popularity hit3 0.8358)

### 2026-10-04T18:23:06 | runtime:evaluate
- 4.8s

### 2026-10-04T18:23:12 | export
- 1000 shoppers, 400 catalog articles; cohort share with layout != store defaults: {'light': 0.52428, 'lower_mid': 0.75812, 'upper_mid': 0.99968, 'heavy': 0.99996}

### 2026-10-04T18:23:13 | runtime:export
- 6.2s

### 2026-10-04T18:23:20 | manifest
- 1258 files checksummed; freeze point C recorded

### 2026-10-04T18:23:20 | runtime:manifest
- 5.6s

### 2026-10-04T18:24:54 | manifest
- 1258 files checksummed; freeze point C recorded

### 2026-10-04T18:24:54 | runtime:manifest
- 4.3s

### 2026-10-05T15:43:21 | otto-ingest
- 216716096 events, 12899779 sessions

### 2026-10-05T15:44:17 | otto-features
- 1626338 ordering sessions as donors

### 2026-10-05T15:46:41 | fuse
- k=50, donors=1626338

