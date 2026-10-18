"""Serving bundle: everything the refresh job needs from the H&M side, in one file.

    python -m server bundle      # after `python -m model freeze` (the retrain does this for you)

Writes server/work/bundle.pkl with the frozen models, their feature list, the latest window's priors,
population tables (for percentiles), store defaults, the decision policy and the 2019/August validation flags.
After that, scoring a new shopper needs no H&M data and no DuckDB.
"""
from __future__ import annotations

import datetime as dt
import pickle

import numpy as np
import pandas as pd

from .config import WORK, REPO

CUT = "final"


def hm_units_sql(rc, cut: str, ncat: int, keys_table: str | None = None) -> str:
    """H&M unit rows with every flag hm_features needs (mirrors atelier_data.features.flags_sql and
    model.history), capped at 330 days. Used by the bundle (population tables) and the feature test."""
    from atelier_data.config import read_json
    from . import hm_features as H
    man = read_json(rc.paths.reports / "split_manifest.json")
    cutoff, data_start = man[cut]["cutoff"], man["data_start"]
    f = rc["features"]
    refs = rc.paths.refs(cut).as_posix()
    units = (rc.paths.interim / f"units_{cut}.parquet").as_posix()
    keys = f"JOIN {keys_table} k USING (customer_key)" if keys_table else ""
    m = f["anchor_min_rows"]
    anc = (f"CASE WHEN coalesce(c.n, 0) >= {m} THEN c.anchor "
           f"WHEN coalesce(r.pooled_n, 0) >= {m} THEN r.pooled_anchor END")
    return f"""
        WITH fs AS (SELECT article_key, min(t_dat) AS first_seen_units FROM read_parquet('{units}') GROUP BY 1)
        SELECT u.customer_key AS user, u.t_dat, u.channel, u.article_key AS article, u.n_rows, u.q, u.price_pct,
               coalesce(cm.cat_idx, {ncat - 1}) AS cat_idx, a.dept_code AS dept_idx,
               a.fam_code AS fam, a.master_code, a.is_solid, r.art_pop_pct,
               ({anc}) IS NOT NULL AND u.price_mean IS NOT NULL AS md_elig,
               coalesce(u.price_mean <= {f['markdown_ratio']} * ({anc}), false) AS md,
               coalesce(r.first_seen >= DATE '{data_start}' + INTERVAL {f['novelty_left_censor_days']} DAY, false) AS nov_elig,
               coalesce(date_diff('day', r.first_seen, u.t_dat) <= {f['novelty_days']}, false) AS nov,
               a.product_code_key,
               date_diff('day', fs.first_seen_units, u.t_dat) <= {f['novelty_days']} AS f_new,
               coalesce(u.price_mean <= {f['markdown_ratio']} * r.pooled_anchor, false) AS f_sale
        FROM read_parquet('{units}') u {keys}
        JOIN articles a USING (article_key)
        LEFT JOIN cat_map cm ON cm.group_code = a.group_code
        LEFT JOIN fs USING (article_key)
        LEFT JOIN read_parquet('{refs}/article_ref.parquet') r USING (article_key)
        LEFT JOIN read_parquet('{refs}/anchor_cells.parquet') c ON c.article_key = u.article_key AND c.channel = u.channel
        WHERE u.t_dat >= DATE '{cutoff}' - INTERVAL {H.HISTORY_CAP_DAYS} DAY"""


def _bridge_population(con, rc, cut: str) -> dict:
    """Sorted raw basket_size / activity_spread over every customer's capped history (model.windows.bridge)."""
    from atelier_data.config import read_json
    from . import hm_features as H
    cutoff = read_json(rc.paths.reports / "split_manifest.json")[cut]["cutoff"]
    units = (rc.paths.interim / f"units_{cut}.parquet").as_posix()
    raw = con.execute(f"""
        WITH u AS (SELECT * FROM read_parquet('{units}') WHERE t_dat >= DATE '{cutoff}' - INTERVAL {H.HISTORY_CAP_DAYS} DAY),
        ad AS (SELECT customer_key, t_dat, article_key, sum(q) AS q FROM u GROUP BY ALL),
        sp AS (SELECT customer_key, count(*) AS days, sum(dq) AS q,
                      CASE WHEN count(*) < 2 THEN 0.0 ELSE -sum(p * ln(p)) / ln(count(*)) END AS activity_spread
               FROM (SELECT customer_key, t_dat, sum(q) AS dq,
                            sum(q)::DOUBLE / sum(sum(q)) OVER (PARTITION BY customer_key) AS p
                     FROM ad GROUP BY customer_key, t_dat)
               GROUP BY customer_key)
        SELECT q::DOUBLE / days AS basket_size, activity_spread FROM sp""").df()
    return {c: np.sort(raw[c].to_numpy(float).round(9)) for c in ("basket_size", "activity_spread")}


def build(cut: str = CUT):
    import json
    from atelier_data import evaluate, references, rules
    from atelier_data.config import read_json
    from model import common as C
    from model import windows as W
    from model.test2019 import FROZEN

    rc = W.run_cfg()
    con = W.db.connect(rc)
    vocab = read_json(rc.paths.processed / "vocabularies.json")
    refs = references.Refs(rc.paths.refs(cut), vocab)
    frozen = evaluate.load_frozen(rc)
    choice = read_json(FROZEN / "choice.json")
    with open(FROZEN / "models.pkl", "rb") as fh:
        pk = pickle.load(fh)
    man = read_json(rc.paths.reports / "split_manifest.json")

    # validation flags: the 2019 test when it ran on these exact models, else August
    test = FROZEN / "test_2019.json"
    validated, source = {}, "august"
    if test.exists():
        t = read_json(test)
        if t.get("frozen_manifest", {}).get("sha256") == read_json(FROZEN / "manifest.json")["sha256"]:
            validated = {d: bool(v["validated"]) for d, v in t["layout"].items() if d != "_extra"}
            source = "2019 test" + (" (rerun)" if t.get("rerun") else "")
    if not validated:
        res = read_json(C.WORK / "mw" / "results.json")["combos"]
        row = next(r for r in res if r["combo"] == choice["combo"])
        validated = {d: bool(v["validated"]) for d, v in row["valid"].items() if d != "_extra"}

    arts = pd.read_parquet(rc.paths.ingested / "articles.parquet",
                           columns=["perceived_colour_master_name", "master_code", "fam_code"])
    fam_of_master = (arts.groupby("master_code")["fam_code"].agg(lambda s: int(s.mode().iloc[0]))
                     .reindex(range(len(vocab["master_colors"]))).fillna(3).astype(int).tolist())

    # sale-first trigger: same threshold the export uses (85th percentile of predicted sale share in the cohort)
    import pickle as _p
    with open(C.WORK / "mw" / "valid_scores.pkl", "rb") as fh:
        Sv = _p.load(fh)
    combo = choice["combo"]
    sec_key = f"sec:regress_{combo['sec'].split('_', 1)[1]}" if combo["sec"].startswith("rank_") else f"sec:{combo['sec']}"
    secs = rules.sections(rc)
    sale_hi = float(np.nanquantile(np.clip(Sv[sec_key], 0, 1)[:, secs.index("sale")], rc["rules"]["trigger_high"]))

    B = {
        "built_at": dt.datetime.now().isoformat(timespec="seconds"),
        "cut": cut, "cutoff": man[cut]["cutoff"],
        "models": pk["models"], "cols": pk["cols"], "combo": combo,
        "policy": {k: (np.inf if v is None else v) for k, v in choice["policy"].items()},
        "validated": validated, "validated_source": source,
        "frozen_manifest": read_json(FROZEN / "manifest.json"),
        "vocab": vocab, "priors": refs.priors, "pop": refs.pop,
        "bridge_pop": _bridge_population(con, rc, cut),
        "defaults": evaluate.defaults_for(rc, cut, frozen), "frozen": frozen,
        "sections": secs, "pseudo_count": rc["features"]["pseudo_count"],
        "half_life": rc["units"]["recency_half_life_days"], "confidence": dict(rc["confidence"]),
        "rules": dict(rc["rules"]), "fam_of_master": fam_of_master, "sale_hi": sale_hi,
        "sec_share_key": sec_key,
    }
    WORK.mkdir(parents=True, exist_ok=True)
    with open(WORK / "bundle.pkl", "wb") as fh:
        pickle.dump(B, fh)
    print(f"bundle: {WORK / 'bundle.pkl'} (validated from {source}: "
          f"{json.dumps(validated)})")
    return B


def load() -> dict:
    p = WORK / "bundle.pkl"
    if not p.exists():
        raise SystemExit(f"{p} missing: run `python -m server bundle` (or the retrain) first")
    with open(p, "rb") as fh:
        return pickle.load(fh)
