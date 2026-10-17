"""8.4 cohort: stratified, salted-hash selection of customers at the dev cutoff."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from . import db, splits
from .hashing import bucket, hex16
from .config import append_preflight
from .log import DataLog


def largest_remainder(total: int, weights: dict, caps: dict | None = None) -> dict:
    """Split `total` integers proportional to weights (dict order breaks ties), capped by caps."""
    alloc = {k: 0 for k in weights}
    remaining = total
    active = {k: w for k, w in weights.items() if w > 0 and (caps is None or caps[k] > 0)}
    while remaining > 0 and active:
        wsum = sum(active.values())
        quota = {k: remaining * w / wsum for k, w in active.items()}
        add = {k: math.floor(q) for k, q in quota.items()}
        left = remaining - sum(add.values())
        order = sorted(active, key=lambda k: (-(quota[k] - add[k]), list(weights).index(k)))
        for k in order[:left]:
            add[k] += 1
        for k in active:
            if caps is not None:
                add[k] = min(add[k], caps[k] - alloc[k])
            alloc[k] += add[k]
        remaining = total - sum(alloc.values())
        active = {k: w for k, w in active.items() if caps is None or alloc[k] < caps[k]}
    return alloc


def assign_strata(units: np.ndarray, strata: dict) -> np.ndarray:
    out = np.full(len(units), None, dtype=object)
    for name, (lo, hi) in strata.items():
        m = (units >= lo) & (units <= (np.inf if hi is None else hi))
        out[m] = name
    return out


def select(elig: pd.DataFrame, cfg) -> pd.DataFrame:
    """elig: customer_key, customer_id, units_dev. Returns the selected cohort frame."""
    c = cfg["cohort"]
    per = c["per_stratum"]
    strata = c["strata"]
    elig = elig.copy()
    elig["stratum"] = assign_strata(elig["units_dev"].to_numpy(), strata)
    elig["hash_key"] = [hex16(c["hash_salt"], cid) for cid in elig["customer_id"]]
    elig = elig.sort_values(["hash_key", "customer_key"], kind="stable")
    counts = {s: int((elig["stratum"] == s).sum()) for s in strata}
    take = {s: min(per, counts[s]) for s in strata}
    deficit = sum(per - take[s] for s in strata)
    if deficit:
        unused = {s: counts[s] - take[s] for s in strata}
        extra = largest_remainder(deficit, unused, caps=unused)
        take = {s: take[s] + extra[s] for s in strata}
    parts = []
    for s in strata:
        part = elig[elig["stratum"] == s].head(take[s]).copy()
        part["inclusion_weight"] = counts[s] / len(part) if len(part) else 0.0
        parts.append(part)
    sel = pd.concat(parts)
    sel["fit_split"] = [bucket(c["split_salt"], cid, 100) < cfg["compression"]["fit_percent"] for cid in sel["customer_id"]]
    sel["attack_split"] = ["A" if bucket(c["attack_salt"], cid, 2) == 0 else "B" for cid in sel["customer_id"]]
    sel["showcase_hash"] = [hex16(c["showcase_salt"], cid) for cid in sel["customer_id"]]
    cols = ["customer_key", "customer_id", "stratum", "units_dev", "inclusion_weight",
            "fit_split", "attack_split", "showcase_hash"]
    sel = sel[cols].sort_values("customer_key").reset_index(drop=True)
    sel.attrs["eligible_counts"] = counts
    sel.attrs["selected_counts"] = {s: take[s] for s in strata}
    return sel


def eligible(con, cfg, c_dev) -> pd.DataFrame:
    cap = cfg["units"]["multiplicity_cap"]
    ci = cfg.paths.ingested / "customer_index.parquet"
    return con.execute(f"""
        WITH g AS (SELECT customer_key, least(count(*), {cap}) AS q FROM {db.rows_before(c_dev)}
                   GROUP BY customer_key, t_dat, channel, article_key)
        SELECT g.customer_key, ci.customer_id, sum(g.q)::INTEGER AS units_dev
        FROM g JOIN read_parquet('{ci}') ci USING (customer_key)
        GROUP BY g.customer_key, ci.customer_id ORDER BY g.customer_key""").df()


def run(cfg, con, force: bool = False):
    out = cfg.paths.processed / "cohort.parquet"
    if out.exists() and not force:
        print("cohort: outputs exist, skipping (use --force)")
        return
    c_dev = splits.load(cfg)["dev"]["cutoff"]
    elig = eligible(con, cfg, c_dev)
    sel = select(elig, cfg)
    out.parent.mkdir(parents=True, exist_ok=True)
    sel.to_parquet(out, index=False)
    ec, sc = sel.attrs["eligible_counts"], sel.attrs["selected_counts"]
    append_preflight(cfg, "strata", {"eligible": ec, "selected": sc, "cutoff": c_dev})
    DataLog(cfg.paths.reports).append("cohort", len(elig), len(sel), {"not selected by hash/stratum": len(elig) - len(sel)},
                                      note=f"eligible={ec} selected={sc}")
    print(f"cohort: {len(sel):,} selected from {len(elig):,} eligible; {sc}")


def load(cfg) -> pd.DataFrame:
    return pd.read_parquet(cfg.paths.processed / "cohort.parquet")
