"""8.8 validity: reliability and markdown-proxy checks."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import write_json

SALE_MONTHS = ("06", "07", "12", "01")


def eligible_price_ratios_sql(cfg, units_path, refs_dir) -> str:
    """price_mean / anchor(a, ch) per eligible unit group (anchor and price_mean not null)."""
    m = cfg["features"]["anchor_min_rows"]
    return f"""(
        SELECT u.t_dat, u.q, u.price_mean / (CASE WHEN coalesce(c.n, 0) >= {m} THEN c.anchor
                                                  WHEN coalesce(r.pooled_n, 0) >= {m} THEN r.pooled_anchor END) AS ratio
        FROM read_parquet('{units_path}') u
        JOIN read_parquet('{refs_dir}/article_ref.parquet') r USING (article_key)
        LEFT JOIN read_parquet('{refs_dir}/anchor_cells.parquet') c USING (article_key, channel))"""


def markdown_ratio_scan(con, cfg, units_path, refs_dir, ratios=(0.90, 0.80, 0.70)) -> dict:
    """Outcome-blind threshold scan over population units before a cutoff: monthly markdown share per ratio,
    peak-to-trough, sale-season contrast, and deciles of price / anchor."""
    rel = f"(SELECT * FROM {eligible_price_ratios_sql(cfg, units_path, refs_dir)} WHERE ratio IS NOT NULL)"
    cols = ", ".join(f"sum(q) FILTER (WHERE ratio <= {r}) / sum(q) AS r{int(r * 100)}" for r in ratios)
    mon = con.execute(f"SELECT strftime(t_dat, '%Y-%m') AS month, sum(q) AS units, {cols} "
                      f"FROM {rel} GROUP BY 1 ORDER BY 1").df()
    deciles = con.execute("SELECT " + ", ".join(f"quantile_cont(ratio, {p / 10}) AS p{p * 10}" for p in range(1, 10))
                          + f" FROM {rel}").df().iloc[0].round(4).to_dict()
    season = mon["month"].str[5:].isin(SALE_MONTHS)
    out = {"deciles_price_over_anchor": deciles, "monthly": mon.round(4).to_dict(orient="list"), "ratios": {}}
    for r in ratios:
        s = mon[f"r{int(r * 100)}"]
        out["ratios"][str(r)] = {
            "peak_to_trough": round(float(s.max() / s.min()), 3),
            "peak": mon.loc[s.idxmax(), "month"], "trough": mon.loc[s.idxmin(), "month"],
            "top4_months": mon.nlargest(4, f"r{int(r * 100)}")["month"].tolist(),
            "season_contrast": round(float(s[season].mean() / s[~season].mean()), 3),
        }
    return out


def run_markdown_scan(cfg, con, cut="dev"):
    res = markdown_ratio_scan(con, cfg, cfg.paths.interim / f"units_{cut}.parquet", cfg.paths.refs(cut))
    write_json(cfg.paths.reports / "markdown_threshold.json", res)
    return res


# ---------- reliability (8.8 item 1) ----------

FEATURE_OWNERS = {  # decision -> owning features / blocks (8.8)
    "landing_department": ["block:department"], "category_order": ["block:category"],
    "hero_category": ["block:category"], "grid_columns": ["cat_breadth"],
    "section_order": ["novelty_affinity", "markdown_affinity", "mainstream_score", "rebuy_share"],
    "default_sort": ["markdown_affinity", "novelty_affinity", "mainstream_score"],
    "hero": ["markdown_affinity", "novelty_affinity"], "price_filter_first": ["markdown_affinity", "price_level"],
    "color_highlight": ["color_concentration"],
}


def reliability(cfg) -> dict:
    """Spearman between early-half and late-half values (dev cutoff) per feature and block. Reported as data
    quality; the frozen rules v1 results are not re-run with these disables."""
    from scipy.stats import spearmanr

    from .config import read_json
    from .features import COLOR_KEYS, cat_breadth, feature_order
    vocab = read_json(cfg.paths.processed / "vocabularies.json")
    fo = feature_order(vocab)
    h = pd.read_parquet(cfg.paths.processed / "halves_dev.parquet")
    e = h[h["half"] == "early"].sort_values("customer_key").reset_index(drop=True)
    l = h[h["half"] == "late"].sort_values("customer_key").reset_index(drop=True)
    assert e["customer_key"].tolist() == l["customer_key"].tolist()
    rho = {f: float(spearmanr(e[f], l[f]).statistic) for f in fo}
    rho["cat_breadth"] = float(spearmanr(cat_breadth(e[vocab["category_keys"]].to_numpy()),
                                         cat_breadth(l[vocab["category_keys"]].to_numpy())).statistic)
    blocks = {"category": vocab["category_keys"], "department": vocab["department_keys"], "color_family": COLOR_KEYS}
    block_rho = {b: float(np.mean([rho[f] for f in ks])) for b, ks in blocks.items()}
    lo = cfg["reliability"]["min_spearman"]

    def value(owner):
        return block_rho[owner[6:]] if owner.startswith("block:") else rho[owner]
    would = sorted(d for d, owners in FEATURE_OWNERS.items() if any(value(o) < lo for o in owners))
    return {"cutoff_name": "dev", "customers": int(len(e)), "min_spearman": lo, "features": rho, "blocks": block_rho,
            "decisions_below_threshold": would,
            "note": "Data-quality report. Rules v1 results are frozen as a hand-written baseline and were not re-run "
                    "with these decisions disabled."}


# ---------- markdown proxy (8.8 item 2) ----------

def markdown_affinity_variant(con, cfg, cutoff, units_path, anchor_rel: str, cohort_table: str) -> pd.DataFrame:
    """markdown_affinity for cohort customers under an alternative anchor(article, channel) relation."""
    from . import db
    f = cfg["features"]
    k = f["pseudo_count"]
    con.execute(f"""CREATE OR REPLACE TEMP TABLE mdv AS
        SELECT u.customer_key, u.q, u.w, (a.anchor IS NOT NULL AND u.price_mean IS NOT NULL) AS elig,
               coalesce(u.price_mean <= {f['markdown_ratio']} * a.anchor, false) AS md
        FROM read_parquet('{units_path}') u LEFT JOIN {anchor_rel} a USING (article_key, channel)""")
    prior = con.execute("SELECT sum(q) FILTER (WHERE elig AND md) / sum(q) FILTER (WHERE elig) FROM mdv").fetchone()[0]
    df = con.execute(f"""SELECT customer_key, {db.xsum('w', 'elig AND md')} AS num, {db.xsum('w', 'elig')} AS den
                         FROM mdv WHERE customer_key IN (SELECT customer_key FROM {cohort_table})
                         GROUP BY 1 ORDER BY 1""").df().fillna(0)
    df["markdown_affinity"] = (df["num"] + k * prior) / (df["den"] + k)
    con.execute("DROP TABLE mdv")
    return df[["customer_key", "markdown_affinity"]].assign(prior=prior)


def markdown_proxy(cfg, con) -> dict:
    from scipy.stats import spearmanr

    from . import cohort, db, references, units
    from .config import read_json
    p = cfg.paths
    C = read_json(p.reports / "split_manifest.json")["final"]["cutoff"]
    units_path, m = p.interim / "units_final.parquet", cfg["features"]["anchor_min_rows"]
    scan = markdown_ratio_scan(con, cfg, units_path, p.refs("final"), ratios=(cfg["features"]["markdown_ratio"],))
    con.register("coh_df", cohort.load(cfg)[["customer_key"]])
    con.execute("CREATE OR REPLACE TEMP TABLE md_cohort AS SELECT * FROM coh_df")

    def quantile_anchor(q):
        cells, pooled = references.anchor_tables_sql(cfg, C, q)
        return f"""(SELECT pr.article_key, ch.channel,
                           CASE WHEN coalesce(c.n, 0) >= {m} THEN c.anchor WHEN pr.pooled_n >= {m} THEN pr.pooled_anchor END AS anchor
                    FROM {pooled} pr CROSS JOIN (SELECT DISTINCT channel FROM read_parquet('{units_path}')) ch
                    LEFT JOIN {cells} c ON c.article_key = pr.article_key AND c.channel = ch.channel)"""
    rows = units.rows_flagged_sql(cfg, C)
    first_price = f"""(WITH fd AS (SELECT article_key, min(t_dat) AS d FROM {rows} WHERE NOT anom GROUP BY 1)
                       SELECT r.article_key, ch.channel, {db.xavg('r.price')} AS anchor
                       FROM {rows} r JOIN fd ON fd.article_key = r.article_key AND r.t_dat = fd.d
                       CROSS JOIN (SELECT DISTINCT channel FROM read_parquet('{units_path}')) ch
                       WHERE NOT r.anom GROUP BY r.article_key, ch.channel)"""
    variants = {"anchor_q0.90": quantile_anchor(cfg["features"]["anchor_quantile"]), "anchor_q0.75": quantile_anchor(0.75),
                "anchor_q0.50": quantile_anchor(0.50), "anchor_first_price": first_price}
    vals = {name: markdown_affinity_variant(con, cfg, C, units_path, rel, "md_cohort") for name, rel in variants.items()}
    base = vals["anchor_q0.90"]
    prof = pd.read_parquet(p.processed / "profiles_final_Eall.parquet")[["customer_key", "markdown_affinity"]]
    check = prof.merge(base, on="customer_key", suffixes=("_profile", "_recomputed"))
    names = list(vals)
    mat = {a: {b: float(spearmanr(vals[a]["markdown_affinity"], vals[b]["markdown_affinity"]).statistic) for b in names}
           for a in names}
    return {"cutoff": C, "markdown_ratio": cfg["features"]["markdown_ratio"],
            "monthly": scan["monthly"], "peak_to_trough": scan["ratios"][str(cfg["features"]["markdown_ratio"])]["peak_to_trough"],
            "season": scan["ratios"][str(cfg["features"]["markdown_ratio"])],
            "deciles_price_over_anchor": scan["deciles_price_over_anchor"],
            "priors": {n: float(v["prior"].iloc[0]) for n, v in vals.items()},
            "spearman": mat,
            "recomputed_q0.90_matches_profiles_max_abs": float(
                (check["markdown_affinity_profile"] - check["markdown_affinity_recomputed"]).abs().max())}


def run(cfg, con, force: bool = False):
    from .log import DataLog
    p = cfg.paths
    outs = [p.reports / "reliability.json", p.reports / "markdown_proxy.json"]
    if all(o.exists() for o in outs) and not force:
        print("validity: outputs exist, skipping (use --force)")
        return
    rel = reliability(cfg)
    write_json(outs[0], rel)
    mdp = markdown_proxy(cfg, con)
    write_json(outs[1], mdp)
    DataLog(p.reports).append("validity", note=(
        f"reliability on {rel['customers']} dev halves; below {rel['min_spearman']}: {rel['decisions_below_threshold']}; "
        f"markdown peak-to-trough {mdp['peak_to_trough']}"))
    print(f"validity: decisions below threshold {rel['decisions_below_threshold']}; markdown p/t {mdp['peak_to_trough']}")
