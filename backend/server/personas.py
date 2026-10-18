"""Data-earned personas: the four shopper types the demo UI already shows, assigned from evidence.

Two paths with the same output shape:

- assign_hm(row)      - for the 100k H&M shoppers, from their 25-value profile (fused_*.parquet).
                        Every signal is a percentile within the dataset, so the "why" can say
                        "58% on markdown (store average 21%)".
- assign_live(events) - for store shoppers, from their own EVENTS rows (sorts, filters, what they
                        add and how it is priced). Needs MIN_EVENTS before a persona is shown at
                        all; confidence rises with evidence.

Personas DESCRIBE shoppers; they are not a tested prediction. Descriptions are templates filled
with the shopper's own numbers, so every label carries its reason.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

# the four personas the website shows; names match the UI exactly
PERSONAS: dict[str, dict] = {
    "price_hunter": {
        "name": "Price Hunter",
        "description": "Looks for deals first: sale items, low prices, markdowns.",
        "signals": [("markdown_affinity", 0.55), ("price_level_inv", 0.45)],
    },
    "trend_seeker": {
        "name": "Trend Seeker",
        "description": "Shops what is new: recent drops and less-common picks.",
        "signals": [("novelty_affinity", 0.7), ("mainstream_inv", 0.3)],
    },
    "mission_shopper": {
        "name": "Mission Shopper",
        "description": "Shops with a goal: fewer trips, a focused basket.",
        "signals": [("purchase_frequency_inv", 0.5), ("top_cat_share", 0.5)],
    },
    "brand_loyalist": {
        "name": "Brand Loyalist",
        "description": "Comes back for the same things: rebuys and a steady palette.",
        "signals": [("rebuy_share", 0.6), ("color_concentration", 0.4)],
    },
}
PERSONA_IDS = list(PERSONAS)

# a persona only shows in the document once there is this much behaviour to read
MIN_EVENTS = 5

_CAT_COLS = [
    "cat_garment_upper_body", "cat_garment_lower_body", "cat_garment_full_body", "cat_swimwear",
    "cat_underwear", "cat_accessories", "cat_shoes", "cat_other",
]

# raw features each persona reads, including derived inversions
_SIGNAL_FEATURES = {
    "markdown_affinity", "price_level", "novelty_affinity", "mainstream_score",
    "purchase_frequency", "top_cat_share", "rebuy_share", "color_concentration",
}


# ---------------------------------------------------------------- reference stats

class Ref:
    """Dataset reference: means for the 'vs average' text and sorted arrays for percentiles."""

    def __init__(self, df: pd.DataFrame):
        feats = _features(df)
        self.means = feats.mean().to_dict()
        self.sorted = {c: np.sort(feats[c].to_numpy()) for c in feats.columns}
        self.n = len(feats)

    def pct(self, feature: str, x: float) -> float:
        return float(np.searchsorted(self.sorted[feature], x) / self.n)


_ref: Ref | None = None


def reference(fused_path: str | Path | None = None) -> Ref:
    """Dataset stats, computed once per process. Default: the frozen fused_final parquet."""
    global _ref
    if _ref is None:
        from .config import REPO
        p = Path(fused_path) if fused_path else REPO / "data" / "processed" / "fused_final.parquet"
        _ref = Ref(pd.read_parquet(p))
    return _ref


def _features(df: pd.DataFrame) -> pd.DataFrame:
    """Raw persona features from a fused/profile frame (adds top_cat_share + inversions)."""
    f = pd.DataFrame(index=df.index)
    f["markdown_affinity"] = df["markdown_affinity"]
    f["price_level"] = df["price_level"]
    f["novelty_affinity"] = df["novelty_affinity"]
    f["mainstream_score"] = df["mainstream_score"]
    f["purchase_frequency"] = df["purchase_frequency"]
    f["rebuy_share"] = df["rebuy_share"]
    f["color_concentration"] = df["color_concentration"]
    f["top_cat_share"] = df[[c for c in _CAT_COLS if c in df]].max(axis=1)
    f["price_level_inv"] = 1.0 - f["price_level"]
    f["mainstream_inv"] = 1.0 - f["mainstream_score"]
    f["purchase_frequency_inv"] = 1.0 - f["purchase_frequency"]
    return f


# ---------------------------------------------------------------- shared shape

def _conf(margin: float, evidence: float = 1.0) -> str:
    if margin >= 0.25 and evidence >= 0.5:
        return "high"
    if margin >= 0.12:
        return "medium"
    return "low"


def _out(pid: str, confidence: str, reason: str) -> dict:
    p = PERSONAS[pid]
    return {"persona_id": pid, "name": p["name"], "description": p["description"],
            "confidence": confidence, "reason": reason}


# ---------------------------------------------------------------- H&M shoppers

def assign_hm(row: pd.Series | dict, ref: Ref) -> dict:
    """Persona for one H&M shopper from their profile row. row: fused_* columns."""
    f = _features(pd.DataFrame([row])).iloc[0]
    pcts = {feat: ref.pct(feat, float(f[feat])) for feat in _SIGNAL_FEATURES | {"price_level_inv", "mainstream_inv", "purchase_frequency_inv"}}
    scores = {pid: sum(pcts[s] * w for s, w in pd_["signals"]) for pid, pd_ in PERSONAS.items()}
    order = sorted(scores, key=scores.get, reverse=True)
    pid = order[0]
    margin = scores[pid] - scores[order[1]]
    return _out(pid, _conf(margin), _hm_reason(pid, f, pcts, ref))


def _hm_reason(pid: str, f: pd.Series, pcts: dict, ref: Ref) -> str:
    if pid == "price_hunter":
        return (f"{f['markdown_affinity']:.0%} of purchases on markdown "
                f"(store avg {ref.means['markdown_affinity']:.0%}), price percentile {f['price_level']:.0%}")
    if pid == "trend_seeker":
        return (f"{f['novelty_affinity']:.0%} of purchases within 28 days of release "
                f"(store avg {ref.means['novelty_affinity']:.0%})")
    if pid == "mission_shopper":
        return (f"shops less often than {pcts['purchase_frequency_inv']:.0%} of shoppers; "
                f"{f['top_cat_share']:.0%} of purchases in one product group")
    return (f"{f['rebuy_share']:.0%} of purchases are items bought before "
            f"(store avg {ref.means['rebuy_share']:.0%}), sticks to a few colors")


def hm_reasons(df: pd.DataFrame, pids: pd.Series, ref: Ref) -> pd.Series:
    """Per-shopper reason text, vectorised: one formatted column per persona, picked by pids."""
    f = _features(df)
    pct = lambda s: (s * 100).round().astype(int).astype(str)
    avg = lambda c: f"{ref.means[c]:.0%}"
    finv = pd.Series(np.searchsorted(ref.sorted["purchase_frequency_inv"],
                                     f["purchase_frequency_inv"]) / ref.n, index=df.index)
    allr = pd.concat({
        "price_hunter": pct(f["markdown_affinity"]) + "% of purchases on markdown (store avg "
                        + avg("markdown_affinity") + "), price percentile " + pct(f["price_level"]) + "%",
        "trend_seeker": pct(f["novelty_affinity"]) + "% of purchases within 28 days of release (store avg "
                        + avg("novelty_affinity") + ")",
        "mission_shopper": "shops less often than " + pct(finv) + "% of shoppers; "
                           + pct(f["top_cat_share"]) + "% of purchases in one product group",
        "brand_loyalist": pct(f["rebuy_share"]) + "% of purchases are items bought before (store avg "
                          + avg("rebuy_share") + "), sticks to a few colors",
    }, axis=1)
    return pd.Series(allr.values[np.arange(len(df)), allr.columns.get_indexer(pids)], index=df.index)


def hm_assignments(df: pd.DataFrame, ref: Ref) -> pd.DataFrame:
    """Everything publish needs per H&M shopper: persona id/name/confidence + the reason string."""
    af = personas_frame(df, ref)
    af["reason"] = hm_reasons(df, af["persona_id"], ref)
    return af


def personas_frame(df: pd.DataFrame, ref: Ref) -> pd.DataFrame:
    """Vectorised assignment for the whole fused table: persona id/name/confidence per row."""
    feats = _features(df)
    pcts = feats.apply(lambda c: np.searchsorted(ref.sorted[c.name], c) / ref.n)
    scores = pd.DataFrame({
        pid: sum(pcts[s] * w for s, w in pd_["signals"]) for pid, pd_ in PERSONAS.items()
    })
    top = scores.values.argsort(axis=1)
    order = scores.columns.to_numpy()
    win = order[top[:, -1]]
    margin = scores.values[np.arange(len(scores)), top[:, -1]] - scores.values[np.arange(len(scores)), top[:, -2]]
    conf = np.where((margin >= 0.25), "high", np.where(margin >= 0.12, "medium", "low"))
    return pd.DataFrame({"persona_id": win, "persona_name": [PERSONAS[p]["name"] for p in win],
                         "persona_confidence": conf}, index=df.index)


# ---------------------------------------------------------------- store shoppers (behaviour)

def live_stats(ev: pd.DataFrame, attrs: pd.DataFrame) -> dict:
    """Behaviour counts for one shopper's events (empty-safe). attrs = the CATALOG table."""
    props = ev["properties"].apply(
        lambda p: p if isinstance(p, dict) else (json.loads(p) if isinstance(p, str) and p else {}))
    types = ev["type"]
    sorts = [p.get("value") or p.get("sort") for t, p in zip(types, props)
             if t == "sort_changed" and (p.get("value") or p.get("sort"))]
    filters = [p.get("type") or p.get("filter") or p.get("section") for t, p in zip(types, props)
               if t == "filter_applied" and (p.get("type") or p.get("filter") or p.get("section"))]
    searches = int((types == "search_performed").sum())
    views = int((types == "product_viewed").sum())
    adds = int((types == "add_to_bag").sum())
    wishlist = int((types == "add_to_wishlist").sum())

    added = ev.loc[types == "add_to_bag", "product_id"].dropna().astype(str)
    a = attrs.set_index(attrs["product_id"].astype(str))
    price_med = float(attrs["price"].median())
    added = a.reindex(added)
    n_add = int(added["name"].notna().sum())
    sale_adds = float(added["sale_price"].notna().mean()) if n_add else 0.0
    new_adds = float(added["is_new"].mean()) if n_add else 0.0
    cheap_adds = float((added["price"] <= price_med).mean()) if n_add else 0.0
    coll_adds = float(added["collection"].value_counts(normalize=True).iloc[0]) if n_add else 0.0
    color_adds = float(
        added["colors"].explode().value_counts(normalize=True).iloc[0]) if n_add else 0.0
    # how directly they buy: product views per bag add (bounded), lower = more mission-like
    views_per_add = views / max(adds, 1)

    viewed = ev.loc[types == "product_viewed", "product_id"].dropna()
    repeat_views = float(viewed.value_counts().gt(1).mean()) if len(viewed) else 0.0

    n_sorts, n_filt = len(sorts), len(filters)
    return {
        "n_events": int(len(ev)), "n_views": views, "n_adds": adds, "n_wishlist": wishlist,
        "sale_adds": sale_adds, "new_adds": new_adds, "cheap_adds": cheap_adds,
        "coll_adds": coll_adds, "color_adds": color_adds,
        "price_sort": (sorts.count("price_asc") / n_sorts) if n_sorts else 0.0,
        "newest_sort": (sorts.count("newest") / n_sorts) if n_sorts else 0.0,
        "sale_filter": (filters.count("sale") / n_filt) if n_filt else 0.0,
        "search_rate": min(1.0, searches / 3.0), "directness": min(1.0, 3.0 / (1.0 + views_per_add)),
        "repeat_views": repeat_views,
        "n_sorts": n_sorts, "n_filters": n_filt, "n_searches": searches,
    }


def assign_live(stats: dict) -> dict | None:
    """Persona from behaviour stats; None when there is too little to say (doc gets persona: null)."""
    if stats["n_events"] < MIN_EVENTS:
        return None
    s = stats
    scores = {
        "price_hunter": 0.40 * s["sale_adds"] + 0.20 * s["cheap_adds"] + 0.25 * s["price_sort"] + 0.15 * s["sale_filter"],
        "trend_seeker": 0.60 * s["new_adds"] + 0.40 * s["newest_sort"],
        "mission_shopper": 0.45 * s["search_rate"] + 0.30 * s["directness"] + 0.25 * min(1.0, s["n_filters"] / 3.0),
        "brand_loyalist": 0.45 * s["repeat_views"] + 0.30 * s["coll_adds"] + 0.25 * s["color_adds"],
    }
    order = sorted(scores, key=scores.get, reverse=True)
    pid, margin = order[0], scores[order[0]] - scores[order[1]]
    # a persona nobody behaves like still wins argmax; demand some signal before naming one
    if scores[pid] < 0.20:
        return None
    confidence = _conf(margin, min(1.0, s["n_events"] / 30.0))
    return _out(pid, confidence, _live_reason(pid, s))


def _live_reason(pid: str, s: dict) -> str:
    bits = []
    if s["n_adds"]:
        bits.append(f"{s['n_adds']} bag add{'s' if s['n_adds'] > 1 else ''}")
        if s["sale_adds"] > 0:
            bits.append(f"{s['sale_adds']:.0%} of them on sale")
        if s["new_adds"] > 0:
            bits.append(f"{s['new_adds']:.0%} of them new in")
    if s["n_sorts"]:
        if s["price_sort"] > 0:
            bits.append(f"sorted by price {s['n_sorts'] * s['price_sort']:.0f}x")
        if s["newest_sort"] > 0:
            bits.append(f"sorted by newest {s['n_sorts'] * s['newest_sort']:.0f}x")
    if s["n_searches"]:
        bits.append(f"{s['n_searches']} search{'es' if s['n_searches'] > 1 else ''}")
    if s["repeat_views"] > 0:
        bits.append(f"revisited {s['repeat_views']:.0%} of viewed products")
    return "; ".join(bits) or f"{s['n_events']} events so far"


def shopper_block(user_id: str, assigned: dict | None) -> dict:
    """The v1 `shopper` block for a store shopper's document."""
    if not assigned:
        return {"id": user_id, "label": "New shopper", "persona": None, "confidence": "low"}
    return {"id": user_id, "label": assigned["name"], "persona_id": assigned["persona_id"],
            "persona": {"name": assigned["name"], "description": assigned["description"]},
            "confidence": assigned["confidence"], "persona_reason": assigned["reason"]}


# ---------------------------------------------------------------- PERSONAS table

TABLE_COLS = ["persona_id", "name", "description", "key_traits", "n_members_hm", "high_conf_share", "updated_at"]


def personas_rows(df_hm: pd.DataFrame, ref: Ref, now: str) -> pd.DataFrame:
    """One row per persona for the PERSONAS table; n_members_hm from assigning all 100k shoppers."""
    assigned = personas_frame(df_hm, ref)
    counts = assigned["persona_id"].value_counts()
    conf_mean = assigned.groupby("persona_id")["persona_confidence"].apply(
        lambda s: float((s == "high").mean()))
    rows = []
    for pid, p in PERSONAS.items():
        traits = [{"feature": s, "weight": w} for s, w in p["signals"]]
        rows.append({"persona_id": pid, "name": p["name"], "description": p["description"],
                     "key_traits": traits, "n_members_hm": int(counts.get(pid, 0)),
                     "high_conf_share": round(conf_mean.get(pid, 0.0), 3), "updated_at": now})
    return pd.DataFrame(rows)[TABLE_COLS]
