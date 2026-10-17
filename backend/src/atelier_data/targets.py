"""8.10 targets: per-user relevance arrays from the target window, section flags, sort positions."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import db, references
from .features import pivot
from .rules import SORTS


@dataclass
class Targets:
    keys: np.ndarray          # eval users (cohort customers with >= 1 target unit), sorted
    rel_cat: np.ndarray       # (u, ncat) rows sum to 1
    rel_dept: np.ndarray      # (u, ndept) NaN rows where no target unit has a department
    rel_sec: np.ndarray       # (u, 4) share of target units carrying each section flag
    master_q: np.ndarray      # (u, K) target units per master color
    total_q: np.ndarray       # (u,) target units
    sort_keys: np.ndarray     # sort-eval users, sorted
    gain: np.ndarray          # (u_sort, 3) mean position per sort in SORTS order
    excluded: dict = field(default_factory=dict)


def sort_positions_sql(refs_dir) -> str:
    """pos_S per in-assortment article: 1 for the top of its product type, 0 for the last (n >= 2 only)."""
    return f"""(
        WITH ia AS (SELECT r.article_key, a.product_type_key, r.first_seen, r.last_price, r.recent_units
                    FROM read_parquet('{refs_dir}/article_ref.parquet') r JOIN articles a USING (article_key)
                    WHERE r.in_assortment),
        rk AS (SELECT *, count(*) OVER (PARTITION BY product_type_key) AS n,
                      row_number() OVER (PARTITION BY product_type_key ORDER BY last_price ASC, article_key) AS r_price,
                      row_number() OVER (PARTITION BY product_type_key ORDER BY first_seen DESC, article_key) AS r_new,
                      row_number() OVER (PARTITION BY product_type_key ORDER BY recent_units DESC, article_key) AS r_best
               FROM ia)
        SELECT article_key, product_type_key, n,
               CASE WHEN n >= 2 THEN 1 - (r_price - 1) / (n - 1) END AS pos_price_asc,
               CASE WHEN n >= 2 THEN 1 - (r_new - 1) / (n - 1) END AS pos_newest,
               CASE WHEN n >= 2 THEN 1 - (r_best - 1) / (n - 1) END AS pos_bestsellers
        FROM rk)"""


def target_units_sql(cfg, cut_paths: dict, vocab: dict) -> str:
    """Target unit groups with category/department/color and the four section flags."""
    f, ev = cfg["features"], cfg["evaluation"]
    rd, m = cut_paths["refs"], f["anchor_min_rows"]
    ncat = len(vocab["category_keys"])
    anc = (f"CASE WHEN coalesce(c.n, 0) >= {m} THEN c.anchor "
           f"WHEN coalesce(r.pooled_n, 0) >= {m} THEN r.pooled_anchor END")
    return f"""
        WITH t AS (SELECT * FROM read_parquet('{cut_paths['targets']}')),
        fsg AS (SELECT article_key, min(t_dat) AS first_seen_global FROM {db.rows_all()}
                WHERE article_key IN (SELECT article_key FROM t) GROUP BY article_key),
        ranked AS (SELECT article_key, row_number() OVER (ORDER BY recent_units DESC, article_key) AS rn,
                          count(*) OVER () AS n
                   FROM read_parquet('{rd}/article_ref.parquet') WHERE recent_units >= 1),
        best AS (SELECT article_key FROM ranked WHERE rn <= ceil({ev['bestseller_top_fraction']} * n)),
        before AS (SELECT DISTINCT u.customer_key, a.product_code_key
                   FROM read_parquet('{cut_paths['units']}') u JOIN articles a USING (article_key)
                   WHERE u.customer_key IN (SELECT customer_key FROM t))
        SELECT t.customer_key, t.article_key, t.q,
               coalesce(cm.cat_idx, {ncat - 1}) AS cat_idx, a.dept_code AS dept_idx, a.master_code,
               date_diff('day', fsg.first_seen_global, t.t_dat) <= {ev['section_new_days']} AS f_new_in,
               coalesce(t.price_mean <= {f['markdown_ratio']} * ({anc}), false) AS f_sale,
               t.article_key IN (SELECT article_key FROM best) AS f_bestsellers,
               b.customer_key IS NOT NULL AS f_buy_again
        FROM t JOIN articles a USING (article_key)
        JOIN fsg USING (article_key)
        LEFT JOIN cat_map cm ON cm.group_code = a.group_code
        LEFT JOIN read_parquet('{rd}/article_ref.parquet') r USING (article_key)
        LEFT JOIN read_parquet('{rd}/anchor_cells.parquet') c ON c.article_key = t.article_key AND c.channel = t.channel
        LEFT JOIN before b ON b.customer_key = t.customer_key AND b.product_code_key = a.product_code_key"""


def build(con, cfg, cut: str, vocab: dict) -> Targets:
    p = cfg.paths
    paths = {"refs": p.refs(cut), "targets": p.interim / f"targets_{cut}.parquet",
             "units": p.interim / f"units_{cut}.parquet"}
    references.register_cat_map(con, vocab)
    con.execute(f"CREATE OR REPLACE TEMP TABLE tu AS {target_units_sql(cfg, paths, vocab)}")
    tot = con.execute("""SELECT customer_key, sum(q) AS q, sum(q) FILTER (WHERE f_new_in) AS s_new_in,
                                sum(q) FILTER (WHERE f_sale) AS s_sale, sum(q) FILTER (WHERE f_bestsellers) AS s_best,
                                sum(q) FILTER (WHERE f_buy_again) AS s_again,
                                sum(q) FILTER (WHERE dept_idx IS NOT NULL) AS q_dept
                         FROM tu GROUP BY 1 ORDER BY 1""").df().fillna(0)
    keys = tot["customer_key"].to_numpy()
    q = tot["q"].to_numpy(dtype=float)

    def long(col):
        return con.execute(f"SELECT customer_key, {col} AS k, sum(q) AS s FROM tu WHERE {col} IS NOT NULL GROUP BY 1, 2").df()

    rel_cat = pivot(long("cat_idx"), keys, len(vocab["category_keys"])) / q[:, None]
    qd = tot["q_dept"].to_numpy(dtype=float)
    with np.errstate(invalid="ignore", divide="ignore"):
        rel_dept = pivot(long("dept_idx"), keys, len(vocab["department_keys"])) / qd[:, None]
    rel_dept[qd == 0] = np.nan
    rel_sec = tot[["s_new_in", "s_sale", "s_best", "s_again"]].to_numpy(dtype=float) / q[:, None]
    master_q = pivot(long("master_code"), keys, len(vocab["master_colors"]))

    # sort pairs: unique (customer, article) target pairs
    pairs = con.execute(f"""
        WITH pr AS (SELECT DISTINCT customer_key, article_key FROM tu)
        SELECT pr.customer_key, sp.n, sp.pos_price_asc, sp.pos_newest, sp.pos_bestsellers
        FROM pr LEFT JOIN {sort_positions_sql(paths['refs'])} sp USING (article_key)""").df()
    outside = int(pairs["n"].isna().sum())
    single = int((pairs["n"] == 1).sum())
    ok = pairs[pairs["n"] >= 2]
    g = ok.groupby("customer_key")[[f"pos_{s}" for s in SORTS]].mean().sort_index()
    con.execute("DROP TABLE tu")
    return Targets(keys=keys, rel_cat=rel_cat, rel_dept=rel_dept, rel_sec=rel_sec, master_q=master_q, total_q=q,
                   sort_keys=g.index.to_numpy(), gain=g.to_numpy(dtype=float),
                   excluded={"outside_assortment": outside, "single_article_type": single,
                             "pairs_total": len(pairs), "pairs_used": len(ok)})

