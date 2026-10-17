"""8.5 units: capped unit groups per cutoff (all customers) and target unit groups (cohort).

Unit-scale outputs hold keys and numeric fields only; attributes come from articles.parquet.
"""
from __future__ import annotations

from . import db


def _src(cutoff, src):
    return db.rows_before(cutoff) if src is None else db.rows_before(cutoff, src)


def article_medians_sql(cutoff, src=None) -> str:
    return f"(SELECT article_key, quantile_cont(price, 0.5) AS med FROM {_src(cutoff, src)} GROUP BY article_key)"


def rows_flagged_sql(cfg, cutoff, src=None) -> str:
    """Rows with t_dat < cutoff plus group_code and the per-cutoff price anomaly flag `anom`."""
    ratio = cfg["features"]["price_anomaly_ratio"]
    return f"""(SELECT r.*, a.group_code,
                   coalesce(r.price IS NULL OR r.price <= 0 OR r.price < {ratio} * m.med, false) AS anom
            FROM {_src(cutoff, src)} r JOIN {article_medians_sql(cutoff, src)} m USING (article_key)
                 JOIN articles a USING (article_key))"""


def unit_groups_sql(cfg, cutoff, src=None) -> str:
    """Unit groups from rows with t_dat < cutoff, with anomaly-aware price fields and recency weight."""
    u = cfg["units"]
    return f"""
        WITH f AS {rows_flagged_sql(cfg, cutoff, src)},
        p AS (SELECT f.*, CASE WHEN NOT anom THEN percent_rank() OVER (
                  PARTITION BY group_code, date_trunc('month', t_dat), anom ORDER BY price) END AS row_pct
              FROM f)
        SELECT customer_key, t_dat, channel, article_key,
               count(*)::INTEGER AS n_rows,
               least(count(*), {u['multiplicity_cap']})::INTEGER AS q,
               {db.xavg('price', 'NOT anom')} AS price_mean,
               {db.xavg('row_pct', 'NOT anom')} AS price_pct,
               least(count(*), {u['multiplicity_cap']})
                 * pow(2, -date_diff('day', t_dat, DATE '{cutoff}')::DOUBLE / {u['recency_half_life_days']}) AS w
        FROM p GROUP BY customer_key, t_dat, channel, article_key"""


def target_groups_sql(cfg, cutoff, start, end, cohort_table: str) -> str:
    u, f = cfg["units"], cfg["features"]
    return f"""
        SELECT t.customer_key, t.t_dat, t.channel, t.article_key,
               least(count(*), {u['multiplicity_cap']})::INTEGER AS q,
               {db.xavg('t.price', f"t.price > 0 AND (m.med IS NULL OR t.price >= {f['price_anomaly_ratio']} * m.med)")} AS price_mean
        FROM {db.rows_between(start, end)} t
        LEFT JOIN {article_medians_sql(cutoff)} m USING (article_key)
        WHERE t.customer_key IN (SELECT customer_key FROM {cohort_table})
        GROUP BY t.customer_key, t.t_dat, t.channel, t.article_key"""


def write_units(con, cfg, cutoff, out_path, src=None) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    con.execute(f"""COPY ({unit_groups_sql(cfg, cutoff, src)}
                    ORDER BY customer_key, t_dat, article_key, channel)
                    TO '{out_path}' (FORMAT parquet, COMPRESSION zstd)""")
    return db.scalar(con, f"SELECT count(*) FROM read_parquet('{out_path}')")


def write_targets(con, cfg, cutoff, start, end, cohort_table, out_path) -> int:
    con.execute(f"""COPY ({target_groups_sql(cfg, cutoff, start, end, cohort_table)}
                    ORDER BY customer_key, t_dat, article_key, channel)
                    TO '{out_path}' (FORMAT parquet, COMPRESSION zstd)""")
    return db.scalar(con, f"SELECT count(*) FROM read_parquet('{out_path}')")
