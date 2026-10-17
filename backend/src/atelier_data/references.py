"""8.6 references: vocabularies, priors, article tables and population percentile arrays per cutoff."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from . import db, features, units
from .config import dept_keys, read_json, slug, write_json
from .log import DataLog
from .percentiles import ecdf_midrank

SCALARS = ["price_level", "purchase_frequency", "mainstream_score"]


# ---------- vocabularies ----------

def build_vocab(con, cfg, units_path: Path) -> dict:
    """Category vocabulary from the dev cutoff's units (frozen and reused at final)."""
    n = cfg["features"]["top_product_groups"]
    rows = con.execute(f"""
        SELECT a.product_group_name, sum(u.q) AS q FROM read_parquet('{units_path}') u JOIN articles a USING (article_key)
        WHERE a.product_group_name IS NOT NULL GROUP BY 1 ORDER BY q DESC, 1 LIMIT {n}""").fetchall()
    names = [r[0] for r in rows]
    group_codes = dict(con.execute(
        "SELECT DISTINCT product_group_name, group_code FROM articles WHERE group_code IS NOT NULL").fetchall())
    masters = [r[0] for r in con.execute("""
        SELECT DISTINCT perceived_colour_master_name, master_code FROM articles
        WHERE master_code IS NOT NULL ORDER BY master_code""").fetchall()]
    return {
        "category_keys": ["cat_" + slug(x) for x in names] + ["cat_other"],
        "category_names": names + ["Other"],
        "category_group_codes": [int(group_codes[x]) for x in names],
        "department_keys": dept_keys(cfg),
        "department_names": list(cfg["features"]["departments"]),
        "master_colors": masters,
        "group_names": [k for k, _ in sorted(group_codes.items(), key=lambda kv: kv[1])],
    }


def register_cat_map(con, vocab: dict):
    rows = ", ".join(f"({g}, {i})" for i, g in enumerate(vocab["category_group_codes"]))
    con.execute(f"CREATE OR REPLACE TEMP TABLE cat_map AS SELECT * FROM (VALUES {rows}) t(group_code, cat_idx)")


# ---------- article tables ----------

def anchor_tables_sql(cfg, cutoff, quantile, src=None):
    """(cells, pooled) SQL: non-anomalous row counts and price quantiles per (article, channel) and per article."""
    rows = units.rows_flagged_sql(cfg, cutoff, src)
    cells = f"""(SELECT article_key, channel, count(*) AS n, quantile_cont(price, {quantile}) AS anchor
                 FROM {rows} WHERE NOT anom GROUP BY article_key, channel)"""
    pooled = f"""(SELECT article_key, count(*) AS pooled_n, quantile_cont(price, {quantile}) AS pooled_anchor
                  FROM {rows} WHERE NOT anom GROUP BY article_key)"""
    return cells, pooled


def build_article_tables(con, cfg, cutoff, units_path: Path, out_dir: Path, src=None):
    f, ev = cfg["features"], cfg["evaluation"]
    rows = units.rows_flagged_sql(cfg, cutoff, src)
    cells, pooled = anchor_tables_sql(cfg, cutoff, f["anchor_quantile"], src)
    con.execute(f"COPY {cells} TO '{out_dir / 'anchor_cells.parquet'}' (FORMAT parquet)")
    con.execute(f"""
        COPY (
          WITH base AS (SELECT article_key, min(t_dat) AS first_seen,
                               bool_or(t_dat >= DATE '{cutoff}' - INTERVAL {ev['assortment_days']} DAY) AS recent_row
                        FROM {rows} GROUP BY article_key),
          un AS (SELECT article_key, sum(q) AS units,
                        coalesce(sum(q) FILTER (WHERE t_dat >= DATE '{cutoff}' - INTERVAL {ev['bestseller_days']} DAY), 0) AS recent_units
                 FROM read_parquet('{units_path}') GROUP BY article_key),
          pop AS (SELECT article_key, percent_rank() OVER (ORDER BY units) AS art_pop_pct FROM un WHERE units >= 1),
          lastd AS (SELECT article_key, max(t_dat) AS d FROM {rows} WHERE NOT anom GROUP BY article_key),
          lastp AS (SELECT r.article_key, {db.xavg('r.price')} AS last_price FROM {rows} r
                    JOIN lastd l ON l.article_key = r.article_key AND r.t_dat = l.d
                    WHERE NOT r.anom GROUP BY r.article_key)
          SELECT b.article_key, b.first_seen, un.units, un.recent_units, pop.art_pop_pct,
                 pl.pooled_n, pl.pooled_anchor, lp.last_price,
                 (b.recent_row AND lp.last_price IS NOT NULL) AS in_assortment
          FROM base b JOIN un USING (article_key) JOIN pop USING (article_key)
          LEFT JOIN {pooled} pl USING (article_key) LEFT JOIN lastp lp USING (article_key)
          ORDER BY article_key)
        TO '{out_dir / 'article_ref.parquet'}' (FORMAT parquet)""")


# ---------- priors and population arrays ----------

def build_priors(con, cfg, flags_path: Path, vocab: dict) -> dict:
    fl = f"read_parquet('{flags_path}')"
    ncat, ndept, nmaster = len(vocab["category_keys"]), len(vocab["department_keys"]), len(vocab["master_colors"])

    def dist(col, n, where="TRUE"):
        v = np.zeros(n)
        for k, q in con.execute(f"SELECT {col}, sum(q) FROM {fl} WHERE {col} IS NOT NULL AND {where} GROUP BY 1").fetchall():
            v[int(k)] = q
        return v / v.sum() if v.sum() > 0 else np.full(n, 1.0 / n)

    s = con.execute(f"""
        SELECT sum(q), sum(q) FILTER (WHERE is_solid), sum(q) FILTER (WHERE md), sum(q) FILTER (WHERE md_elig),
               sum(q) FILTER (WHERE nov AND nov_elig), sum(q) FILTER (WHERE nov_elig), sum(q) FILTER (WHERE rebuy),
               sum(q) FILTER (WHERE channel = 2), {db.xsum('q * art_pop_pct')}
        FROM {fl}""").fetchone()
    s = [float(x or 0) for x in s]
    tot = s[0]
    cat = dist("cat_idx", ncat)
    dept = dist("dept_idx", ndept)
    return {
        "category": cat.tolist(), "department": dept.tolist(),
        "color_family": dist("fam", 3, "fam < 3").tolist(),
        "master_color": dist("master_code", nmaster).tolist(),
        "is_solid": s[1] / tot, "markdown": s[2] / s[3] if s[3] else 0.0,
        "novel": s[4] / s[5] if s[5] else 0.0, "rebuy": s[6] / tot, "channel_2": s[7] / tot,
        "mu": s[8] / tot,
        # population order by sum q (stable: ties keep vocabulary order)
        "category_order": [vocab["category_keys"][i] for i in np.argsort(-cat, kind="stable")],
        "department_order": [vocab["department_keys"][i] for i in np.argsort(-dept, kind="stable")],
    }


class NondeterminismError(RuntimeError):
    pass


def build_population_arrays(con, cfg, flags_path: Path, cutoff, priors: dict, out_dir: Path):
    sums = features.customer_sums_sql(f"read_parquet('{flags_path}')", cutoff)
    agg = con.execute(sums).df()
    raws = features.scalar_raws(agg, priors, cfg)
    # Repeatability: recompute the tables and require identical population percentiles.
    raws2 = features.scalar_raws(con.execute(sums).df(), priors, cfg)
    differing = {n: int((ecdf_midrank(np.sort(raws[n]), raws[n]) != ecdf_midrank(np.sort(raws2[n]), raws2[n])).sum())
                 for n in SCALARS}
    DataLog(cfg.paths.reports).append(
        f"references:repeatability_{out_dir.name}",
        note=f"population scalar tables computed twice over {len(agg):,} customers; differing percentiles: {differing}")
    if any(differing.values()):
        raise NondeterminismError(f"population percentiles differ between two identical computations: {differing}")
    knots = np.linspace(0, 1, 101)
    tables = {}
    for name in SCALARS:
        arr = np.sort(raws[name])
        np.save(out_dir / f"pop_{name}.npy", arr)
        tables[name] = np.quantile(arr, knots).tolist()
    write_json(out_dir / "quantile_tables.json", {"knots": knots.round(2).tolist(), **tables})
    return len(agg)


def recent_popularity(con, cfg, cutoff, units_path: Path, vocab: dict) -> dict:
    """Scoring-harness baseline: category and department shares of population units (sum q) in the
    `recent_popularity_days` before the cutoff, with the implied orders (ties keep vocabulary order)."""
    days = cfg["evaluation"]["recent_popularity_days"]
    register_cat_map(con, vocab)
    ncat, ndept = len(vocab["category_keys"]), len(vocab["department_keys"])
    recent = f"""(SELECT u.q, coalesce(cm.cat_idx, {ncat - 1}) AS cat_idx, a.dept_code AS dept_idx
                  FROM read_parquet('{units_path}') u JOIN articles a USING (article_key)
                  LEFT JOIN cat_map cm ON cm.group_code = a.group_code
                  WHERE u.t_dat >= DATE '{cutoff}' - INTERVAL {days} DAY)"""
    out = {"window_days": days}
    for name, col, n, keys in (("category", "cat_idx", ncat, vocab["category_keys"]),
                               ("department", "dept_idx", ndept, vocab["department_keys"])):
        v = np.zeros(n)
        for k, q in con.execute(f"SELECT {col}, sum(q) FROM {recent} WHERE {col} IS NOT NULL GROUP BY 1").fetchall():
            v[int(k)] = q
        v = v / v.sum()
        out[name] = v.tolist()
        out[f"{name}_order"] = [keys[i] for i in np.argsort(-v, kind="stable")]
    return out


# ---------- orchestration ----------

class Refs:
    """Loaded references for one cutoff."""

    def __init__(self, out_dir: Path, vocab: dict):
        self.dir = Path(out_dir)
        self.vocab = vocab
        self.priors = read_json(self.dir / "priors.json")
        self.pop = {n: np.load(self.dir / f"pop_{n}.npy") for n in SCALARS}
        self.article_ref = self.dir / "article_ref.parquet"
        self.anchor_cells = self.dir / "anchor_cells.parquet"


def build(con, cfg, cutoff, data_start, units_path: Path, out_dir: Path, vocab: dict, src=None) -> Refs:
    out_dir.mkdir(parents=True, exist_ok=True)
    register_cat_map(con, vocab)
    build_article_tables(con, cfg, cutoff, units_path, out_dir, src)
    flags_path = cfg.paths.tmp / f"flags_{out_dir.name}.parquet"
    units_rel = f"read_parquet('{units_path}')"
    con.execute(f"COPY ({features.flags_sql(cfg, units_rel, out_dir, data_start, len(vocab["category_keys"]))}) TO '{flags_path}' (FORMAT parquet)")
    priors = build_priors(con, cfg, flags_path, vocab)
    write_json(out_dir / "priors.json", priors)
    n_pop = build_population_arrays(con, cfg, flags_path, cutoff, priors, out_dir)
    flags_path.unlink()
    write_json(out_dir / "meta.json", {"cutoff": str(cutoff), "population_customers": n_pop})
    return Refs(out_dir, vocab)


def load(cfg, cut: str) -> Refs:
    return Refs(cfg.paths.refs(cut), json.loads((cfg.paths.processed / "vocabularies.json").read_text()))
