"""Samples (shopper, first N events) -> features; one LightGBM regressor per browsing-style target.

Shoppers are split by salted hash: 70% train, 10% validation (early stopping), 20% test (reported). Every shopper
contributes one sample per prefix length, so the model learns how much N live events reveal.
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

from . import config as K
from .features import FEATURES, session_features

PARAMS = dict(objective="regression", learning_rate=0.05, num_leaves=31, min_data_in_leaf=200,
              feature_fraction=0.9, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, seed=7)
MAX_ROUNDS = 600


def split_of(session: int) -> str:
    h = int(hashlib.md5(f"{K.SALT}split|{session}".encode()).hexdigest()[:8], 16) % 10
    return "test" if h < 2 else "valid" if h < 3 else "train"


def build_samples(work: Path = K.WORK) -> pd.DataFrame:
    t = time.time()
    pe = pd.read_parquet(work / "prefix_events.parquet").sort_values(["session", "rn"], kind="stable")
    s, ts, aid, typ = (pe[c].to_numpy() for c in ("session", "ts", "aid", "type"))
    starts = np.flatnonzero(np.r_[True, s[1:] != s[:-1]])
    ends = np.r_[starts[1:], len(s)]
    rows, keys = [], []
    for a, b in zip(starts, ends):
        ev = list(zip(ts[a:b].tolist(), aid[a:b].tolist(), typ[a:b].tolist()))
        for n in K.PREFIX_LENGTHS:
            if n <= len(ev):
                rows.append(session_features(ev[:n]))
                keys.append((int(s[a]), n))
    X = pd.DataFrame(rows, columns=FEATURES)
    X.insert(0, "prefix_n", [k[1] for k in keys])
    X.insert(0, "session", [k[0] for k in keys])
    tg = pd.read_parquet(work / "targets.parquet")
    df = X.merge(tg, on="session", how="inner")
    df["split"] = [split_of(x) for x in df["session"]]
    df.to_parquet(work / "samples.parquet", index=False)
    print(f"samples: {len(df):,} ({df['session'].nunique():,} shoppers x {len(K.PREFIX_LENGTHS)} prefix lengths), "
          f"{time.time() - t:.0f}s", flush=True)
    return df


def r2(y, p) -> float:
    ss = float(((y - y.mean()) ** 2).sum())
    return float(1 - ((y - p) ** 2).sum() / ss) if ss > 0 else float("nan")


def same_shopper_comparison(d: pd.DataFrame, tgt: str, cols, b, work: Path) -> dict | None:
    """Purchase-pattern bridge vs live clicks on the SAME held-out shoppers (those who ordered).
    The bridge model is LightGBM on the 5 bridge percentiles, trained on the train split's shoppers."""
    p_br = work / "bridge.parquet"
    if not p_br.exists():
        return None
    br = pd.read_parquet(p_br)
    bcols = [c for c in br.columns if c.startswith("bridge_")]
    one = d[d["prefix_n"] == K.PREFIX_LENGTHS[0]].merge(br, on="session", how="inner")
    tr, va, te = (one[one["split"] == sp] for sp in ("train", "valid", "test"))
    if len(te) < 200:
        return None
    dtr = lgb.Dataset(tr[bcols].to_numpy(np.float64), tr[tgt].to_numpy())
    dva = lgb.Dataset(va[bcols].to_numpy(np.float64), va[tgt].to_numpy(), reference=dtr)
    m = lgb.train(PARAMS, dtr, MAX_ROUNDS, valid_sets=[dva], callbacks=[lgb.early_stopping(50, verbose=False)])
    bridge = r2(te[tgt].to_numpy(), np.clip(m.predict(te[bcols].to_numpy(np.float64)), 0, 1))
    test_sessions = set(te["session"])
    dt = d[(d["split"] == "test") & d["session"].isin(test_sessions)]
    pn = dt["prefix_n"].to_numpy()
    pl = np.clip(b.predict(dt[cols].to_numpy(np.float64), num_iteration=b.best_iteration), 0, 1)
    live = {int(n): round(r2(dt[tgt].to_numpy()[pn == n], pl[pn == n]), 4) for n in K.PREFIX_LENGTHS}
    return {"test_shoppers": int(len(te)), "bridge_r2": round(bridge, 4), "live_r2_by_events": live}


def bridge_r2() -> dict:
    """The purchase-based (H&M bridge) R² from the fusion report, for comparison."""
    from atelier_data import config
    p = config.load().paths.reports / "fusion.json"
    if not p.exists():
        return {}
    return json.loads(p.read_text()).get("bridge_predictability", {}).get("r2", {})


def train(work: Path = K.WORK) -> dict:
    df = pd.read_parquet(work / "samples.parquet") if (work / "samples.parquet").exists() else build_samples(work)
    cols = FEATURES  # prefix_n is the same as n_events
    models_dir = work / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    report = {"targets": {}, "prefix_lengths": K.PREFIX_LENGTHS, "features": cols,
              "shoppers": {sp: int(df.loc[df["split"] == sp, "session"].nunique()) for sp in ("train", "valid", "test")},
              "bridge_r2_from_purchases": bridge_r2()}
    for tgt in K.TARGETS:
        t = time.time()
        d = df[np.isfinite(df[tgt])]
        tr, va, te = (d[d["split"] == sp] for sp in ("train", "valid", "test"))
        dtr = lgb.Dataset(tr[cols].to_numpy(np.float64), tr[tgt].to_numpy(), feature_name=cols, free_raw_data=False)
        dva = lgb.Dataset(va[cols].to_numpy(np.float64), va[tgt].to_numpy(), reference=dtr)
        b = lgb.train(PARAMS, dtr, num_boost_round=MAX_ROUNDS, valid_sets=[dva],
                      callbacks=[lgb.early_stopping(50, verbose=False)])
        b.save_model(str(models_dir / f"{tgt}.txt"), num_iteration=b.best_iteration)
        p = np.clip(b.predict(te[cols].to_numpy(np.float64), num_iteration=b.best_iteration), 0, 1)
        y = te[tgt].to_numpy()
        pn = te["prefix_n"].to_numpy()
        by_n = {int(n): round(r2(y[pn == n], p[pn == n]), 4) for n in K.PREFIX_LENGTHS if (pn == n).any()}
        # the demo is one short visit to a new store: score prefixes that stay within a single visit
        one = te["n_visits"].to_numpy() == 1
        single = {int(n): (round(r2(y[(pn == n) & one], p[(pn == n) & one]), 4) if ((pn == n) & one).sum() >= 200
                           else None) for n in K.PREFIX_LENGTHS}
        single_n = {int(n): int(((pn == n) & one).sum()) for n in K.PREFIX_LENGTHS}
        same = same_shopper_comparison(d, tgt, cols, b, work)
        imp = pd.Series(b.feature_importance("gain"), index=cols)
        report["targets"][tgt] = {"r2_by_events": by_n, "r2_single_visit": single, "single_visit_test_rows": single_n,
                                  "same_shoppers": same, "trees": int(b.best_iteration),
                                  "coverage": float(len(d) / len(df)),
                                  "top_features": (imp / imp.sum()).sort_values(ascending=False).head(5).round(3).to_dict()}
        print(f"  {tgt:22s} R² by events seen {by_n}  ({b.best_iteration} trees, {time.time() - t:.0f}s)", flush=True)
    (work / "report.json").write_text(json.dumps(report, indent=1))
    return report


def print_table(report: dict):
    br = report.get("bridge_r2_from_purchases", {})
    ns = report["prefix_lengths"]
    print("\nR² on held-out shoppers (1 = perfect, 0 = no better than the average)")
    print(f"{'target':22s}" + "".join(f"{f'{n} events':>11s}" for n in ns) + f"{'purchases':>11s}")
    for tgt, v in report["targets"].items():
        row = "".join(f"{v['r2_by_events'].get(str(n), v['r2_by_events'].get(n, float('nan'))):>11.3f}" for n in ns)
        print(f"{tgt:22s}{row}{br.get(tgt, float('nan')):>11.3f}")
    print("'purchases' = R² of the fusion bridge on its own holdout (reports/fusion.json): a DIFFERENT group of shoppers.")
    print("\nSame comparison on the SAME held-out shoppers (those who ordered):")
    print(f"{'target':22s}" + "".join(f"{f'{n} events':>11s}" for n in ns) + f"{'purchases':>11s}")
    for tgt, v in report["targets"].items():
        s = v.get("same_shoppers")
        if s:
            row = "".join(f"{s['live_r2_by_events'].get(str(n), s['live_r2_by_events'].get(n, float('nan'))):>11.3f}"
                          for n in ns)
            print(f"{tgt:22s}{row}{s['bridge_r2']:>11.3f}")
    print("\nSingle-visit prefixes only (what a demo visitor produces); the UI gate uses this table:")
    print(f"{'target':22s}" + "".join(f"{f'{n} events':>11s}" for n in ns))
    for tgt, v in report["targets"].items():
        sv = v.get("r2_single_visit", {})
        row = "".join(f"{(sv.get(str(n), sv.get(n)) if (sv.get(str(n), sv.get(n)) is not None) else float('nan')):>11.3f}"
                      for n in ns)
        print(f"{tgt:22s}{row}")
