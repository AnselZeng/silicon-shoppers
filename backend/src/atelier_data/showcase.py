"""8.13 showcase: per-stratum KMeans representatives + adapted quota + hash fill -> shopper_XXXX ids."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

from . import rules
from .evaluate import STRATA

ADAPT_KEYS = ["default_sort", "hero", "color_highlight", "price_filter_first"]


def select(cfg, prof: pd.DataFrame, cohort: pd.DataFrame, feats: list, L: dict, vocab: dict, defaults: dict) -> pd.DataFrame:
    """prof: final full-config profiles sorted by customer_key; L: its layout. Returns shopper_id <-> customer_key."""
    sc = cfg["showcase"]
    df = prof[["customer_key", "stratum"]].merge(cohort[["customer_key", "showcase_hash"]], on="customer_key")
    df["row"] = np.arange(len(df))
    df["adapted"] = [rules.differs(rules.values(L, i, vocab, cfg), defaults, ADAPT_KEYS) for i in range(len(df))]
    picked = []
    for s in STRATA:
        sub = df[df["stratum"] == s]
        if sub.empty:
            continue
        X = StandardScaler().fit_transform(prof.loc[sub["row"], feats].to_numpy(dtype=float))
        k = min(sc["kmeans_k"], len(sub))
        km = KMeans(n_clusters=k, n_init=10, random_state=cfg["seed"]).fit(X)
        dist = np.linalg.norm(X - km.cluster_centers_[km.labels_], axis=1)
        sub = sub.assign(cluster=km.labels_, dist=np.round(dist, 9))
        take = (sub.sort_values(["cluster", "dist", "showcase_hash"], kind="stable")
                .groupby("cluster", sort=True).head(sc["per_cluster"]))
        chosen = set(take["customer_key"])
        rest = sub[~sub["customer_key"].isin(chosen)].sort_values("showcase_hash", kind="stable")
        adapted = rest[rest["adapted"]].head(sc["adapted_quota"])
        chosen |= set(adapted["customer_key"])
        fill = rest[~rest["customer_key"].isin(chosen)].head(max(0, sc["per_stratum"] - len(chosen)))
        chosen |= set(fill["customer_key"])
        picked.append(sub[sub["customer_key"].isin(chosen)].sort_values("showcase_hash", kind="stable"))
    out = pd.concat(picked)[["customer_key", "stratum", "showcase_hash"]].reset_index(drop=True)
    out.insert(0, "shopper_id", [f"shopper_{i + 1:04d}" for i in range(len(out))])
    return out
