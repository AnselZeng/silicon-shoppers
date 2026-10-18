"""Item ranker v2: trained on the 12 training windows, no OTTO values, checked on August against two baselines.

  popular   this week's top sellers (the earlier comparison)
  rebuy+pop the shopper's own past items, most recent first, then this week's top sellers. Buying the same item
            again is the strongest signal in H&M data, so this shows how much of the gain is candidate
            generation rather than the ranker.

Two display policies are reported, because the team has to choose one:
  include   already-bought items can be shown (scores better; rebuying is common)
  hide      items whose product (any color) the shopper already bought are never shown (h&m-model's choice;
            looks better in a demo)

Training rows keep every positive and a random NEG_FRAC of negatives from shoppers with at least one positive
(LambdaRank only learns from groups with a positive). Early stopping uses 10% of training shoppers, never August.
"""
from __future__ import annotations

import hashlib
import json
import time
import warnings

import numpy as np
import pandas as pd

from atelier_data.config import read_json, write_json

from . import common as C
from . import items
from . import windows as W

warnings.filterwarnings("ignore")

OUT = C.WORK / "mw"
NEG_FRAC = 0.15
CHUNK = 10_000
USER_COLS = ["price_level", "markdown_affinity", "novelty_affinity", "rebuy_share", "channel_2_share",
             "purchase_frequency", "mainstream_score", "basket_size", "activity_spread", "units_all", "days_all",
             "units_30d", "units_90d", "days_since_last", "mean_gap_days"]


def user_frame(users: pd.DataFrame) -> pd.DataFrame:
    """The ranker's shopper columns, from a window's users table (profile values carry a p_ prefix there)."""
    out = pd.DataFrame({"customer_key": users["customer_key"].to_numpy()})
    for c in USER_COLS:
        out[c] = users[f"p_{c}"].to_numpy() if f"p_{c}" in users.columns else users[c].to_numpy()
    keep = [c for c in users.columns if c.startswith(("hcat_all_", "hdept_all_", "hmc_all_", "hcat_90d_"))]
    return pd.concat([out, users[keep].reset_index(drop=True)], axis=1)


def _split(keys: np.ndarray, pct: int) -> np.ndarray:
    return np.array([int(hashlib.md5(f"items-es|{k}".encode()).hexdigest()[:8], 16) % 100 < pct for k in keys])


def window_frame(con, rc, vocab, name: str, keys: np.ndarray, users: pd.DataFrame, tg: pd.DataFrame | None,
                 sample_negatives: bool, seed: int = 7) -> pd.DataFrame:
    info = items.prepare(con, rc, name, vocab)
    uf = user_frame(users)
    rng = np.random.default_rng(seed)
    parts = []
    for i in range(0, len(keys), CHUNK):
        c = items.add_user_features(items.candidates(con, info, keys[i:i + CHUNK]), uf, USER_COLS)
        if tg is not None:
            c = items.attach_labels(c, tg)
        if sample_negatives:
            has = c.groupby("customer_key")["label"].transform("max").to_numpy() > 0
            keep = has & ((c["label"].to_numpy() == 1) | (rng.random(len(c)) < NEG_FRAC))
            c = c[keep]
        parts.append(c)
    return pd.concat(parts, ignore_index=True)


def baselines(df: pd.DataFrame) -> dict:
    """Score vectors for the two baselines (higher = shown first)."""
    pop = -df["pop_rank"].to_numpy(float)
    bought = df["bought_units"].to_numpy() > 0
    rebuy = np.where(bought, 1e6 - df["bought_age"].fillna(1e5).to_numpy(float), pop)
    return {"popular": np.where(df["s_pop"].to_numpy() == 1, pop, -1e9), "rebuy+pop": rebuy}


def evaluate_frame(df: pd.DataFrame, model_score: np.ndarray, truth: dict, strata: dict) -> dict:
    out = {}
    hide = df["product_units"].to_numpy() > 0                 # same product, any color, bought before
    for policy, mask in (("include", np.ones(len(df), bool)), ("hide", ~hide)):
        d = df[mask]
        scores = {"model": model_score[mask], **{k: v[mask] for k, v in baselines(df).items()}}
        res = {}
        for name, sc in scores.items():
            pred = items.topk(d, sc, 12)
            res[name] = {"map12": items.map_at_k(pred, truth),
                         "by_stratum": {s: items.map_at_k(pred, {u: t for u, t in truth.items() if strata.get(u) == s})
                                        for s in ("light", "lower_mid", "upper_mid", "heavy")}}
        out[policy] = res
    return out


def train(train_names: list[str], valid_name: str = "final", seed: int = 20261015):
    t0 = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    rc = W.run_cfg()
    con = W.db.connect(rc)
    vocab = read_json(rc.paths.processed / "vocabularies.json")
    frames = []
    for name in train_names:
        users = pd.read_parquet(rc.paths.processed / f"users_{name}.parquet").sort_values("customer_key")
        tg = pd.read_parquet(rc.paths.interim / f"targets_{name}.parquet")
        keys = np.sort(tg["customer_key"].unique())
        f = window_frame(con, rc, vocab, name, keys, users[users["customer_key"].isin(keys)], tg, True, seed)
        f["window"] = name
        frames.append(f)
        print(f"  items {name}: {len(f):,} training rows, {int(f['label'].sum()):,} positives ({time.time() - t0:.0f}s)",
              flush=True)
    df = pd.concat(frames, ignore_index=True)
    cols = [c for c in items.feature_cols(df) if c != "window"]
    # one group per (window, shopper): make the ranker's group key unique across windows
    df["customer_key"] = df["window"].map({n: i for i, n in enumerate(train_names)}).to_numpy() * 10_000_000 + \
        df["customer_key"].to_numpy()
    es = _split(df["customer_key"].to_numpy() % 10_000_000, 10)
    m = items.fit_ranker(df[~es], cols, seed, valid=df[es])
    n_iter = max(m.best_iteration_ or items.PARAMS["n_estimators"], 20)
    full = items.fit_ranker(df, cols, seed + 1, n_estimators=n_iter)
    full.booster_.save_model(str(OUT / "item_ranker.txt"))
    imp = pd.Series(full.booster_.feature_importance("gain"), index=cols).sort_values(ascending=False)
    del df, frames
    print(f"  ranker trained: {n_iter} trees ({time.time() - t0:.0f}s)", flush=True)
    res = {"train": train_names, "features": cols, "trees": int(n_iter),
           "importance_top15": (imp / imp.sum()).head(15).round(4).to_dict()}
    res["valid"] = score_window(con, rc, vocab, valid_name, full, cols)
    write_json(OUT / "item_results.json", res)
    print(json.dumps(res["valid"], indent=1), flush=True)
    return res


def score_window(con, rc, vocab, name: str, ranker, cols, keys_df: pd.DataFrame | None = None) -> dict:
    """MAP@12 of the ranker and both baselines on one window's buyers, under both display policies."""
    users = pd.read_parquet(rc.paths.processed / f"users_{name}.parquet").sort_values("customer_key")
    tg = pd.read_parquet(rc.paths.interim / f"targets_{name}.parquet")
    truth = tg.groupby("customer_key")["article_key"].apply(set).to_dict()
    keys = np.array(sorted(truth))
    strata = dict(zip(users["customer_key"], users["stratum"]))
    f = window_frame(con, rc, vocab, name, keys, users[users["customer_key"].isin(keys)], None, False)
    score = ranker.predict(f[cols])
    out = evaluate_frame(f, score, truth, strata)
    out["buyers"] = int(len(keys))
    out["candidates_per_buyer"] = float(len(f) / len(keys))
    lab = items.attach_labels(f[["customer_key", "article_key"]], tg)
    out["pair_recall"] = float(lab["label"].sum() / sum(len(v) for v in truth.values()))
    return out


def export_tiles(name: str = "final", top: int = 48):
    """Top-`top` scored candidates for every shopper at `name` (the app's product tiles)."""
    import lightgbm as lgb
    rc = W.run_cfg()
    con = W.db.connect(rc)
    vocab = read_json(rc.paths.processed / "vocabularies.json")
    booster = lgb.Booster(model_file=str(OUT / "item_ranker.txt"))
    cols = booster.feature_name()
    users = pd.read_parquet(rc.paths.processed / f"users_{name}.parquet").sort_values("customer_key")
    keys = users["customer_key"].to_numpy()
    info = items.prepare(con, rc, name, vocab)
    uf = user_frame(users)
    tops = []
    for i in range(0, len(keys), CHUNK):
        c = items.add_user_features(items.candidates(con, info, keys[i:i + CHUNK]), uf, USER_COLS)
        d = c[["customer_key", "article_key", "s_rebuy", "s_variant", "s_pop", "s_seg", "s_copurch", "s_new",
               "cat_idx", "bought_units", "product_units"]].assign(score=booster.predict(c[cols]))
        tops.append(d.sort_values(["customer_key", "score"], ascending=[True, False]).groupby("customer_key").head(top))
    out = pd.concat(tops, ignore_index=True)
    out.to_parquet(OUT / f"item_scores_{name}.parquet", index=False)
    return out
