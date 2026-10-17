"""Append-only DATA_LOG.md writer with row accounting."""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

# Judgment calls this build made where BUILD_PROMPT.md is silent. Written once when the log is created.
BUILD_DECISIONS = [
    "Python 3.12 via uv (machine had only 3.13/3.14).",
    "duckdb.max_temp_directory_size added to config.yaml (8GB) per plan amendment; data/tmp is cleared after every stage.",
    "Verify 'column sets match': exact set for transactions and customers; required subset for articles (spec says 'includes').",
    "Verify-time color unmapped share and price-anomaly counts use all data (descriptive source checks); anomaly median there is the all-data per-article median.",
    "Verify age/postal checks are computed by exposure.source_checks() so age and postal code are only loaded inside exposure.py.",
    "Ingest uses try_strptime for t_dat so unparseable dates become null and are dropped and logged; all strings trimmed, including customer_id.",
    "Raw zip files are kept next to the CSVs in data/raw.",
    "Within a cutoff: row view (anomaly flag, row price percentile) -> unit groups -> article/population references (resolves 8.5/8.6 order).",
    "Units parquet stores keys and numeric fields only; attributes are integer codes on articles.parquet joined at aggregation time.",
    "Target unit price_mean excludes rows with price <= 0 or below price_anomaly_ratio x the cutoff's article median (same anomaly rule as features).",
    "MI sample 'hash order' uses showcase_hash (the only hash stored in cohort.parquet).",
    "Reason templates render whenever a rule chose the value from data; 'Store default' when it fell back (low confidence, disabled, no trigger). Disabled decisions get validated: null.",
    "Users with zero non-null-department target units are excluded from dept_share (counted).",
    "feature_labels: category -> raw product group name; department -> config name; layout_rules feature_labels where defined; else humanized key.",
    "Color reason lists colors lowercase joined with ' and '.",
    "results.json per_stratum carries the headline blocks minus targeting/shuffle; population_weighted carries point estimates only.",
    "compression_curve has every non-random final configuration plus one E{E}_D{D}_random_{precision} row (mean and sd over draws).",
    "Catalog allocation: minimum 2 per cell with >= 2 deduped articles, remainder by largest remainder on recent_units share, capped by cell size; overflow redistributed the same way.",
    "Bestsellers flag: rank <= ceil(bestseller_top_fraction x n) among articles with recent_units >= 1, ties by article_key.",
    "Raw scalar values (price_level, purchase_frequency, mainstream_score) and per-color/group sums are rounded to 9 decimals before ECDF lookups and tie-break sorts, because DuckDB parallel float sums differ in the last bits between runs and would otherwise break mid-rank ties.",
    "features.markdown_ratio changed 0.90 -> 0.70 (user-approved, outcome-blind). Scan over population units before C_dev with dev anchors (validity.markdown_ratio_scan -> reports/markdown_threshold.json): peak-to-trough 0.90: 2.555 (peak 2019-12, trough 2019-04), 0.80: 3.424 (2019-07 / 2019-05), 0.70: 6.786 (2019-07 / 2019-04); sale-season (Jun, Jul, Dec, Jan) vs other months 1.213 / 1.430 / 2.209; top months at 0.70: 2019-07, 2019-12, 2020-01, 2019-08. price/anchor deciles p10..p90: 0.50, 0.69, 0.80, 0.90, 1.00, 1.00, 1.00, 1.00, 1.00. 0.70 has the clearest seasonal contrast. The catalog markdown flag and the sale section flag use the same ratio.",
    "duckdb memory_limit 6GB and threads 6 (user-requested after smoke peak footprint 9.66 GB).",
    "Share blocks (category, department, color family) are rounded to 6 decimals with the rounding residual added to each row's largest share, so every block sums to 1 within 1e-6 (plain rounding drifted up to 3e-6).",
    "Spec test_markdown_anchor fixture row moved from 8.0 to 6.5: with markdown_ratio 0.70, 8.0 vs anchor 10.0 is no longer markdown.",
    "Catalog `color` is perceived_colour_master_name (matches the master colors used by color_highlight); articles with no department are excluded from the catalog.",
    "All floating-point SUM/AVG in SQL (price_mean, price_pct, last_price, per-customer weight sums, mu) are computed in DECIMAL(18,12) and cast back to DOUBLE: DuckDB's parallel float aggregation is not bit-reproducible, and on the first full run a last-bit price_mean difference flipped a markdown flag at exactly 0.70 x anchor, failing the leakage check by 1e-6 on markdown_affinity.",
    "Scope changed to data preparation only (user, 2026-10-04): rules v2 (M3.5) stopped before any run and its code reverted from the Freeze A snapshot; Freeze A outputs archived privately in data/snapshots/; dataset v1 frozen with artifact checksums (build_manifest.json, freeze 'dataset-v1').",
    "Scoring harness: recent-popularity baselines (population units in the 28 days before the cutoff) added for category order and landing department; at both cutoffs the recent order equals the all-time order, so the two baselines coincide.",
    "Validated flag: a tested decision is validated only if users whose layout it changed did better than the store default (95% CI of the mean difference above 0); the targeting test is reported separately. For color highlight the comparator is the population's top-2 colors (the default shows none).",
    "Copy (layout_rules copy_revision 2): per-feature phrases with correct verb agreement; displayed percentiles clamped to 1st..99th. shoppers.json and results.json are labeled 'rules v1: hand-written baseline'.",
    "M4 data only: codes and reconstructions saved for every (cutoff, E, D, precision, draw); no utility-based selection (selection.json not produced) and no compressed-layout variants in shoppers.json; canonical_config is null.",
    "MI feature selection uses development-window labels (top target category) as the spec defines; the fixture leakage test therefore covers PCA/identity/random compressors only.",
    "M5 without a utility axis: no fairness-by-age utility and no matched-utility frontier; reliability is reported as data quality and not used to disable rules v1 decisions.",
    "Cutoff 2019-08-26 (target [2019-08-26, 2019-09-23)) is reserved, untouched, for the model's final test.",
    "append_preflight moved from verify.py to config.py to break an import cycle (cohort -> verify -> exposure -> compress -> targets -> features -> cohort).",
    "Targeting test and shuffle control are computed at both cutoffs; results.json reports the final cutoff.",
]


class RowAccountingError(AssertionError):
    pass


class DataLog:
    def __init__(self, reports_dir: Path):
        self.path = Path(reports_dir) / "DATA_LOG.md"

    def _ensure(self):
        if self.path.exists():
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lines = ["# DATA_LOG", "", "## Decisions made during build", ""]
        lines += [f"- {d}" for d in BUILD_DECISIONS]
        lines += ["", "## Stage entries", ""]
        self.path.write_text("\n".join(lines) + "\n")

    def append(self, stage: str, rows_in: int | None = None, rows_out: int | None = None,
               drops: dict | None = None, decisions=(), warnings=(), note: str | None = None):
        drops = {k: int(v) for k, v in (drops or {}).items()}
        if rows_in is not None and rows_out is not None:
            if int(rows_in) - sum(drops.values()) != int(rows_out):
                raise RowAccountingError(
                    f"[{stage}] rows_in {rows_in} - drops {sum(drops.values())} != rows_out {rows_out}")
        self._ensure()
        ts = dt.datetime.now().isoformat(timespec="seconds")
        out = [f"### {ts} | {stage}"]
        if rows_in is not None:
            acct = {"in": int(rows_in), "out": int(rows_out), "drops": drops}
            out.append(f"- rows: `{json.dumps(acct)}`")
        if note:
            out.append(f"- {note}")
        out += [f"- decision: {d}" for d in decisions]
        out += [f"- WARNING: {w}" for w in warnings]
        with self.path.open("a") as f:
            f.write("\n".join(out) + "\n\n")


def parse_row_accounting(path: Path):
    """Yield (stage, acct dict) for every row-accounting line in DATA_LOG.md."""
    stage = None
    for line in Path(path).read_text().splitlines():
        if line.startswith("### "):
            stage = line.split("|", 1)[-1].strip()
        elif line.startswith("- rows: `"):
            yield stage, json.loads(line[len("- rows: `"):-1])
