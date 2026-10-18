"""Training, validation and test windows, built with the dataset pipeline's own functions.

  train   p01..p11  monthly pseudo-windows before dev (cutoff = dev - 28k), each with a 28-day target
          dev       2020-07-29, target to 2020-08-25
  valid   final     2020-08-26, target to 2020-09-22 (already looked at, so used openly for choosing setups)
  test    reserved  2019-08-26, target to 2019-09-22, on shoppers OUTSIDE the 100k cohort; built and scored once

Rules
  - No training window's target overlaps the reserved window (the would-be p12, cutoff 2019-08-28, is skipped).
  - Every feature looks back at most HISTORY_CAP_DAYS = 330 days, so the reserved cutoff (about 340 days after
    the first H&M transaction) sees exactly the feature definitions the models were trained on.
  - Everything is written under model/work/runs/ (its own interim/processed/reports); the frozen dataset files
    are only read (dev/final units, reference tables and cohort targets are linked, not rebuilt).

Per window: units (all customers, for reference tables), references, targets (labels), and for the window's
shoppers: profiles from all capped history and from the last 10/3/1 purchases, two bridge values, history features.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import time
from pathlib import Path

import numpy as np
import pandas as pd

from atelier_data import config, db, features, fusion, references, units
from atelier_data.cohort import assign_strata, largest_remainder
from atelier_data.config import read_json, write_json
from atelier_data.hashing import hex16

from . import common as C
from . import history

RUN = C.WORK / "runs"
WINDOW_DAYS = 28
HISTORY_CAP_DAYS = history.HISTORY_CAP_DAYS
RESERVED = (dt.date(2019, 8, 26), dt.date(2019, 9, 23))     # [start, end) of the reserved target window
RESERVED_SALT = "hm-reserved-test-v1|"
RESERVED_PER_STRATUM = 25_000
BUDGETS = ("all", "10", "3", "1")
SHORT = ["markdown_affinity", "novelty_affinity", "rebuy_share"]


def base_cfg():
    return C.load_cfg()


def run_cfg():
    """Repo config whose interim/processed/reports point at model/work/runs (data/ingested stays shared)."""
    return config.load(run_root=RUN, overrides={
        "duckdb.memory_limit": os.environ.get("ATELIER_DUCKDB_MEM", "4GB"),
        "duckdb.threads": int(os.environ.get("ATELIER_DUCKDB_THREADS", os.cpu_count() or 2))})


def plan(base) -> dict:
    """name -> {cutoff, target, role}. Pseudo-windows step back 28 days from dev until history runs short."""
    s = read_json(base.paths.reports / "split_manifest.json")
    start = dt.date.fromisoformat(s["data_start"])
    dev = dt.date.fromisoformat(s["dev"]["cutoff"])
    out, k = {}, 1
    while True:
        c = dev - dt.timedelta(days=WINDOW_DAYS * k)
        if c - dt.timedelta(days=HISTORY_CAP_DAYS) < start:
            break
        t1 = c + dt.timedelta(days=WINDOW_DAYS)
        if not (t1 <= RESERVED[0] or c >= RESERVED[1]):       # target overlaps the reserved window: skip
            k += 1
            continue
        out[f"p{len(out) + 1:02d}"] = {"cutoff": c.isoformat(), "target": [c.isoformat(), t1.isoformat()],
                                       "role": "train"}
        k += 1
    for name in ("dev", "final"):
        out[name] = {"cutoff": s[name]["cutoff"], "target": s[name]["target"],
                     "role": "train" if name == "dev" else "valid"}
    out["reserved"] = {"cutoff": RESERVED[0].isoformat(), "target": [RESERVED[0].isoformat(), RESERVED[1].isoformat()],
                       "role": "test"}
    if dt.date.fromisoformat(out["reserved"]["cutoff"]) - dt.timedelta(days=HISTORY_CAP_DAYS) < start:
        raise ValueError("reserved cutoff has less history than the cap")
    return out


def init_run(base) -> dict:
    """Run folder with the extended split manifest and the frozen vocab/defaults (copied from the dataset)."""
    p = plan(base)
    rc = run_cfg()
    rc.paths.makedirs()
    s = read_json(base.paths.reports / "split_manifest.json")
    write_json(rc.paths.reports / "split_manifest.json",
               {"data_start": s["data_start"], "D_max": s["D_max"], **{k: {"cutoff": v["cutoff"], "target": v["target"]}
                                                                        for k, v in p.items()}})
    write_json(RUN / "windows.json", p)
    for f in ("vocabularies.json", "rules_frozen.json"):
        shutil.copyfile(base.paths.processed / f, rc.paths.processed / f)
    return p


def _link(src: Path, dst: Path):
    if dst.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        shutil.copytree(src, dst)
    else:
        try:
            os.link(src, dst)
        except OSError:
            shutil.copyfile(src, dst)


def reserved_sample(con, rc, cohort_keys: np.ndarray) -> pd.DataFrame:
    """Shoppers outside the cohort with history before the reserved cutoff, stratified like the cohort
    (strata by capped units before the reserved cutoff), picked by salted hash. Never seen by any model."""
    cap = rc["units"]["multiplicity_cap"]
    c0 = RESERVED[0].isoformat()
    elig = con.execute(f"""
        WITH g AS (SELECT customer_key, least(count(*), {cap}) AS q FROM {db.rows_before(c0)}
                   GROUP BY customer_key, t_dat, channel, article_key)
        SELECT g.customer_key, ci.customer_id, sum(g.q)::INTEGER AS units_before
        FROM g JOIN read_parquet('{rc.paths.ingested / "customer_index.parquet"}') ci USING (customer_key)
        GROUP BY g.customer_key, ci.customer_id ORDER BY g.customer_key""").df()
    elig = elig[~elig["customer_key"].isin(cohort_keys)].copy()
    strata = rc["cohort"]["strata"]
    elig["stratum"] = assign_strata(elig["units_before"].to_numpy(), strata)
    elig["h"] = [hex16(RESERVED_SALT, cid) for cid in elig["customer_id"]]
    elig = elig.sort_values(["h", "customer_key"], kind="stable")
    parts = []
    for s in strata:
        e = elig[elig["stratum"] == s]
        part = e.head(RESERVED_PER_STRATUM).copy()
        part["inclusion_weight"] = len(e) / max(len(part), 1)
        parts.append(part)
    out = pd.concat(parts)[["customer_key", "stratum", "inclusion_weight"]].sort_values("customer_key")
    return out.reset_index(drop=True)


def _capped(rel: str, cutoff: str) -> str:
    return f"(SELECT * FROM {rel} WHERE t_dat >= DATE '{cutoff}' - INTERVAL {HISTORY_CAP_DAYS} DAY)"


def bridge(con, units_path: Path, cutoff: str, keys: np.ndarray) -> pd.DataFrame:
    """basket_size and activity_spread percentiles against every customer's capped pre-cutoff history
    (same definitions as atelier_data.fusion.hm_population_raw)."""
    rel = _capped(f"read_parquet('{units_path.as_posix()}')", cutoff)
    raw = con.execute(f"""
        WITH ad AS (SELECT customer_key, t_dat, article_key, sum(q) AS q FROM {rel} GROUP BY ALL),
        sp AS (SELECT customer_key, count(*) AS days, sum(dq) AS q,
                      CASE WHEN count(*) < 2 THEN 0.0 ELSE -sum(p * ln(p)) / ln(count(*)) END AS activity_spread
               FROM (SELECT customer_key, t_dat, sum(q) AS dq,
                            sum(q)::DOUBLE / sum(sum(q)) OVER (PARTITION BY customer_key) AS p
                     FROM ad GROUP BY customer_key, t_dat)
               GROUP BY customer_key)
        SELECT customer_key, q::DOUBLE / days AS basket_size, activity_spread FROM sp ORDER BY customer_key""").df()
    pct = fusion.to_percentiles(raw, ["basket_size", "activity_spread"])
    out = pd.DataFrame({"customer_key": keys}).merge(pct, on="customer_key", how="left")
    return out


def user_table(con, rc, name: str, cutoff: str, keys_df: pd.DataFrame, vocab: dict) -> pd.DataFrame:
    """One row per shopper in keys_df: 25 capped profile values + evidence, last-10/3/1 shares, bridge, history."""
    data_start = read_json(rc.paths.reports / "split_manifest.json")["data_start"]
    refs = references.Refs(rc.paths.refs(name), vocab)
    units_path = rc.paths.interim / f"units_{name}.parquet"
    con.register("wk_df", keys_df[["customer_key"]])
    con.execute("CREATE OR REPLACE TEMP TABLE wkeys AS SELECT * FROM wk_df")
    keyed = _capped(features.keyed_units(units_path, "wkeys"), cutoff)
    keys = keys_df["customer_key"].to_numpy()
    fo = features.feature_order(vocab)
    out = keys_df[["customer_key", "stratum", "inclusion_weight"]].copy()
    for E in BUDGETS:
        prof = features.build_profiles(con, rc, refs, features.budget_sql(rc, keyed, E, cutoff), cutoff, data_start)
        prof = pd.DataFrame({"customer_key": keys}).merge(prof, on="customer_key", how="left")
        if E == "all":
            for f in fo:
                out[f"p_{f}"] = prof[f].to_numpy()
            for f in ("units_used", "shopping_days", "history_days", "days_since_last", "known_color_units",
                      "color_coverage", "cat_breadth"):
                out[f"ev_{f}"] = prof[f].to_numpy(dtype=float)
            out["confidence"] = prof["confidence"].fillna("low").to_numpy()
        else:
            for f in vocab["category_keys"] + vocab["department_keys"] + SHORT:
                out[f"e{E}_{f}"] = prof[f].to_numpy()
    br = bridge(con, units_path, cutoff, keys)
    out["basket_size"] = br["basket_size"].to_numpy()
    out["activity_spread"] = br["activity_spread"].to_numpy()
    h = history.build(con, rc, name, vocab, keys)
    out = out.merge(h, on="customer_key", how="left")
    news = con.execute("SELECT customer_key, newsletter FROM customers").df()
    out = out.merge(news, on="customer_key", how="left")
    out["newsletter"] = out["newsletter"].fillna("unknown")
    con.execute("DROP TABLE wkeys"); con.unregister("wk_df")
    return out


def build(names: list[str] | None = None, include_reserved_targets: bool = False, force: bool = False):
    base = base_cfg()
    p = init_run(base)
    rc = run_cfg()
    con = db.connect(rc)
    vocab = read_json(rc.paths.processed / "vocabularies.json")
    coh = pd.read_parquet(base.paths.processed / "cohort.parquet")[["customer_key", "stratum", "inclusion_weight"]]
    coh = coh.sort_values("customer_key").reset_index(drop=True)
    con.register("coh_df", coh[["customer_key"]])
    con.execute("CREATE OR REPLACE TEMP TABLE cohort_keys AS SELECT * FROM coh_df")
    todo = names or [n for n in p if n != "reserved"]
    for name in todo:
        w = p[name]
        out_users = rc.paths.processed / f"users_{name}.parquet"
        if out_users.exists() and not force:
            print(f"{name}: present", flush=True)
            continue
        t = time.time()
        C_, (t0, t1) = w["cutoff"], w["target"]
        units_path = rc.paths.interim / f"units_{name}.parquet"
        if name in ("dev", "final"):
            _link(base.paths.interim / f"units_{name}.parquet", units_path)
            _link(base.paths.refs(name), rc.paths.refs(name))
            _link(base.paths.interim / f"targets_{name}.parquet", rc.paths.interim / f"targets_{name}.parquet")
            keys_df = coh
        else:
            if not units_path.exists():
                units.write_units(con, rc, C_, units_path)
            if not (rc.paths.refs(name) / "priors.json").exists():
                references.build(con, rc, C_, read_json(rc.paths.reports / "split_manifest.json")["data_start"],
                                 units_path, rc.paths.refs(name), vocab)
            if name == "reserved":
                keys_df = reserved_sample(con, rc, coh["customer_key"].to_numpy())
                keys_df.to_parquet(RUN / "reserved_sample.parquet", index=False)
                if include_reserved_targets:
                    con.register("rs_df", keys_df[["customer_key"]])
                    con.execute("CREATE OR REPLACE TEMP TABLE reserved_keys AS SELECT * FROM rs_df")
                    units.write_targets(con, rc, C_, t0, t1, "reserved_keys",
                                        rc.paths.interim / f"targets_{name}.parquet")
            else:
                tp = rc.paths.interim / f"targets_{name}.parquet"
                if not tp.exists():
                    units.write_targets(con, rc, C_, t0, t1, "cohort_keys", tp)
                buyers = pd.read_parquet(tp, columns=["customer_key"])["customer_key"].unique()
                keys_df = coh[coh["customer_key"].isin(buyers)].reset_index(drop=True)   # only labelled rows train
        users_df = user_table(con, rc, name, C_, keys_df, vocab)
        users_df.to_parquet(out_users, index=False)
        print(f"{name}: cutoff {C_}, {len(users_df):,} shoppers, {users_df.shape[1]} columns ({time.time() - t:.0f}s)",
              flush=True)
    return p
