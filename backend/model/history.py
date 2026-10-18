"""Leak-free purchase-history features per shopper, from units_{cut}.parquet (already cut off at the cutoff).
Raw, unsmoothed counts and shares over recent windows, complementing the smoothed 25-value profile.

Every feature looks back at most HISTORY_CAP_DAYS (330). H&M data starts on 2018-09-20, so the reserved 2019
cutoff (2019-08-26) has about 340 days of history: with the cap, every cutoff from then on sees identical
feature definitions. (An earlier version also had 365-day and "same weeks last year" features; both are empty
or truncated at the 2019 cutoff, so they were removed.)
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from atelier_data import references
from atelier_data.config import read_json

HISTORY_CAP_DAYS = 330
WINDOWS = (7, 30, 90)
SHARE_WINDOWS = (30, 90)


def _cutoff(cfg, cut: str) -> dt.date:
    return dt.date.fromisoformat(read_json(cfg.paths.reports / "split_manifest.json")[cut]["cutoff"])


def _pivot_share(df: pd.DataFrame, keys: np.ndarray, n: int, prefix: str, denom: np.ndarray) -> pd.DataFrame:
    m = np.zeros((len(keys), n))
    if len(df):
        r = np.searchsorted(keys, df["customer_key"].to_numpy())
        m[r, df["k"].to_numpy(dtype=int)] = df["s"].to_numpy(dtype=float)
    with np.errstate(invalid="ignore", divide="ignore"):
        m = np.where(denom[:, None] > 0, m / denom[:, None], np.nan)
    return pd.DataFrame(m, columns=[f"{prefix}_{i}" for i in range(n)])


def build(con, cfg, cut: str, vocab: dict, keys: np.ndarray) -> pd.DataFrame:
    """One row per key in `keys` (sorted), NaN where a window has no purchases."""
    cutoff = _cutoff(cfg, cut)
    cap = HISTORY_CAP_DAYS
    units = cfg.paths.interim / f"units_{cut}.parquet"
    refs = cfg.paths.refs(cut)
    ncat, ndept, nmc = len(vocab["category_keys"]), len(vocab["department_keys"]), len(vocab["master_colors"])
    references.register_cat_map(con, vocab)
    con.register("hk_keys", pd.DataFrame({"customer_key": keys.astype("int32")}))
    nov = cfg["features"]["novelty_days"]
    md = cfg["features"]["markdown_ratio"]
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE hu AS
        WITH fs AS (SELECT article_key, min(t_dat) AS first_seen FROM read_parquet('{units}') GROUP BY 1),
        u AS (SELECT u.* FROM read_parquet('{units}') u JOIN hk_keys k USING (customer_key)
              WHERE u.t_dat >= DATE '{cutoff}' - INTERVAL {cap} DAY)
        SELECT u.customer_key, u.t_dat, u.channel, u.article_key, u.q, u.price_mean, u.price_pct,
               date_diff('day', u.t_dat, DATE '{cutoff}') AS age,
               coalesce(cm.cat_idx, {ncat - 1}) AS cat_idx, a.dept_code AS dept_idx, a.master_code,
               a.product_code_key, a.is_solid,
               date_diff('day', fs.first_seen, u.t_dat) <= {nov} AS f_new,
               coalesce(u.price_mean <= {md} * r.pooled_anchor, false) AS f_sale,
               r.art_pop_pct
        FROM u JOIN articles a USING (article_key)
        LEFT JOIN cat_map cm ON cm.group_code = a.group_code
        LEFT JOIN fs USING (article_key)
        LEFT JOIN read_parquet('{refs}/article_ref.parquet') r USING (article_key)""")
    # product rebought: unit whose product_code the shopper bought on an earlier day
    con.execute("""
        CREATE OR REPLACE TEMP TABLE hu2 AS
        SELECT *, t_dat > min(t_dat) OVER (PARTITION BY customer_key, product_code_key) AS f_rebuy,
               t_dat = max(t_dat) OVER (PARTITION BY customer_key) AS f_last_day
        FROM hu""")

    win = ", ".join(f"sum(q) FILTER (WHERE age < {w}) AS units_{w}d, "
                    f"count(DISTINCT t_dat) FILTER (WHERE age < {w}) AS days_{w}d" for w in WINDOWS)
    base = con.execute(f"""
        SELECT k.customer_key, {win},
               sum(q) AS units_all, count(DISTINCT t_dat) AS days_all, count(DISTINCT article_key) AS articles_all,
               min(age) AS days_since_last, max(age) AS days_since_first,
               sum(q) FILTER (WHERE f_last_day) AS units_last_day,
               sum(q * (channel = 2)::INT) FILTER (WHERE age < 90) / sum(q) FILTER (WHERE age < 90) AS online_90d,
               sum(q * (channel = 2)::INT) FILTER (WHERE f_last_day) / sum(q) FILTER (WHERE f_last_day) AS online_last,
               avg(price_pct) FILTER (WHERE age < 90) AS price_pct_90d,
               avg(price_pct) FILTER (WHERE f_last_day) AS price_pct_last,
               avg(art_pop_pct) FILTER (WHERE age < 90) AS pop_pct_90d,
               sum(q * f_new::INT) FILTER (WHERE age < 90) / sum(q) FILTER (WHERE age < 90) AS new_share_90d,
               sum(q * f_sale::INT) FILTER (WHERE age < 90) / sum(q) FILTER (WHERE age < 90) AS sale_share_90d,
               sum(q * f_rebuy::INT) / sum(q) AS rebuy_share_raw,
               sum(q * f_new::INT) / sum(q) AS new_share_all,
               sum(q * f_sale::INT) / sum(q) AS sale_share_all,
               sum(q * is_solid::INT) FILTER (WHERE age < 90) / sum(q) FILTER (WHERE age < 90) AS solid_90d,
               -- gaps between shopping days: regular shoppers come back on schedule
               (max(age) - min(age)) / greatest(count(DISTINCT t_dat) - 1, 1) AS mean_gap_days
        FROM hk_keys k LEFT JOIN hu2 USING (customer_key)
        GROUP BY 1 ORDER BY 1""").df()
    out = [base]
    filt = {**{f"{w}d": f"age < {w}" for w in SHARE_WINDOWS}, "last": "f_last_day", "all": "TRUE"}
    denom = {name: con.execute(f"""SELECT k.customer_key, sum(q) FILTER (WHERE {f}) AS s
                                   FROM hk_keys k LEFT JOIN hu2 USING (customer_key) GROUP BY 1 ORDER BY 1"""
                               ).df()["s"].fillna(0).to_numpy(float) for name, f in filt.items()}

    def share(col, n, prefix, names):
        for name in names:
            df = con.execute(f"SELECT customer_key, {col} AS k, sum(q) AS s FROM hu2 "
                             f"WHERE {filt[name]} AND {col} IS NOT NULL GROUP BY 1, 2").df()
            out.append(_pivot_share(df, keys, n, f"{prefix}_{name}", denom[name]))

    share("cat_idx", ncat, "hcat", ["30d", "90d", "last", "all"])
    share("dept_idx", ndept, "hdept", ["30d", "90d", "last", "all"])
    share("master_code", nmc, "hmc", ["90d", "all"])
    con.execute("DROP TABLE hu"); con.execute("DROP TABLE hu2"); con.unregister("hk_keys")
    f = pd.concat(out, axis=1)
    assert (f["customer_key"].to_numpy() == keys).all()
    cnt = [c for c in f.columns if c.startswith(("units_", "days_")) and c not in ("days_since_last", "days_since_first")
           or c == "articles_all"]
    f[cnt] = f[cnt].fillna(0)
    f["no_recent_history"] = (f["units_all"] == 0).astype(float)   # nothing bought in the last 330 days
    return f
