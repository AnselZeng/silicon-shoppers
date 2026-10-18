"""Shared loaders: config with machine-sized DuckDB settings, vocabularies, defaults, fused vectors."""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pandas as pd

from atelier_data import config, db, evaluate
from atelier_data.config import read_json

CUTS = ("dev", "final")

# all model outputs (features, predictions, layouts, exports) go here; gitignored
WORK = Path(__file__).resolve().parent / "work"

# The 37 fused values, in FUSION.md order.
H25 = ["cat_garment_upper_body", "cat_garment_lower_body", "cat_garment_full_body", "cat_swimwear", "cat_underwear",
       "cat_accessories", "cat_shoes", "cat_other", "dept_ladieswear", "dept_menswear", "dept_divided", "dept_sport",
       "dept_baby_children", "color_neutral", "color_warm", "color_cool", "color_concentration", "solid_share",
       "price_level", "markdown_affinity", "novelty_affinity", "rebuy_share", "channel_2_share", "purchase_frequency",
       "mainstream_score"]
BRIDGE = ["basket_size", "activity_spread"]
OTTO = ["click_to_cart", "cart_to_order", "comparison", "exploration", "decision_speed", "browsing_pace",
        "multi_visit_research", "evening_share", "weekend_share", "match_confidence"]
FUSED37 = H25 + BRIDGE + OTTO


def load_cfg():
    """Repo config with DuckDB sized to this machine (env ATELIER_DUCKDB_MEM / ATELIER_DUCKDB_THREADS)."""
    return config.load(overrides={
        "duckdb.memory_limit": os.environ.get("ATELIER_DUCKDB_MEM", "4GB"),
        "duckdb.threads": int(os.environ.get("ATELIER_DUCKDB_THREADS", os.cpu_count() or 2)),
    })


def connect(cfg):
    return db.connect(cfg)


def vocab(cfg) -> dict:
    return read_json(cfg.paths.processed / "vocabularies.json")


def defaults(cfg, cut: str) -> dict:
    return evaluate.defaults_for(cfg, cut, evaluate.load_frozen(cfg))


def cohort(cfg) -> pd.DataFrame:
    """Cohort shoppers sorted by customer_key (the order every layout array uses)."""
    c = pd.read_parquet(cfg.paths.processed / "cohort.parquet",
                        columns=["customer_key", "stratum", "inclusion_weight", "fit_split"])
    return c.sort_values("customer_key").reset_index(drop=True)


def fused(cfg, cut: str) -> pd.DataFrame:
    f = pd.read_parquet(cfg.paths.processed / f"fused_{cut}.parquet")
    return f.sort_values("customer_key").reset_index(drop=True)


def strat_folds(keys: np.ndarray, strata: np.ndarray, k: int, seed: int) -> np.ndarray:
    """Fold id per row, balanced within stratum, deterministic."""
    rng = np.random.default_rng(seed)
    fold = np.empty(len(keys), dtype=int)
    for s in np.unique(strata):
        idx = np.flatnonzero(strata == s)
        idx = idx[rng.permutation(len(idx))]
        fold[idx] = np.arange(len(idx)) % k
    return fold
