"""Persona assignment: the four UI personas, H&M-profile rules, live-behaviour rules."""

import pandas as pd
import pytest

from server import personas as P


def _fused_like(n: int, seed: int = 0, **const):
    """A small fused_*-shaped frame; **const pins columns, the rest get spread values."""
    rng = __import__("numpy").random.default_rng(seed)
    d = {c: rng.uniform(0.05, 0.95, n) for c in
         ["price_level", "novelty_affinity", "mainstream_score", "purchase_frequency"]}
    d["markdown_affinity"] = rng.uniform(0.05, 0.6, n)
    d["rebuy_share"] = rng.uniform(0.02, 0.3, n)
    d["color_concentration"] = rng.uniform(0.05, 0.5, n)
    for c in P._CAT_COLS:
        d[c] = rng.uniform(0.01, 0.4, n)
    d["cat_garment_upper_body"] = rng.uniform(0.2, 0.6, n)
    for c, v in const.items():
        d[c] = v
    return pd.DataFrame(d)


def _events(seq):
    """seq of (type, properties, product_id) tuples -> EVENTS-shaped frame."""
    return pd.DataFrame({
        "user_id": "u1", "session_id": "s1", "type": [t for t, _, _ in seq],
        "ts": pd.date_range("2026-04-01", periods=len(seq), freq="min"),
        "route": "/", "product_id": [pid for _, _, pid in seq],
        "color": None, "properties": [p for _, p, _ in seq],
    })


ATTRS = pd.DataFrame({
    "product_id": ["a", "b", "c", "d"],
    "name": ["A", "B", "C", "D"], "department": "women", "category": "dresses",
    "collection": ["basic", "basic", "party", "party"],
    "price": [10.0, 20.0, 60.0, 80.0],
    "sale_price": [7.0, 15.0, None, None],
    "colors": [["black"], ["black"], ["red"], ["blue"]],
    "is_new": [False, False, True, True],
    "popularity": [0.9, 0.8, 0.5, 0.4],
})


def test_hm_personas_pick_the_right_side():
    ref = P.Ref(_fused_like(400))
    hunter = P.assign_hm(_fused_like(1, markdown_affinity=0.9, price_level=0.02).iloc[0], ref)
    assert hunter["persona_id"] == "price_hunter" and "markdown" in hunter["reason"]
    loyal = P.assign_hm(_fused_like(1, rebuy_share=0.9, color_concentration=0.9).iloc[0], ref)
    assert loyal["persona_id"] == "brand_loyalist"
    trendy = P.assign_hm(_fused_like(1, novelty_affinity=0.95, mainstream_score=0.05).iloc[0], ref)
    assert trendy["persona_id"] == "trend_seeker"
    mission = P.assign_hm(_fused_like(1, purchase_frequency=0.02,
                                      **{c: 0.01 for c in P._CAT_COLS[1:]},
                                      cat_garment_upper_body=0.9).iloc[0], ref)
    assert mission["persona_id"] == "mission_shopper"


def test_live_needs_evidence():
    ev = _events([("product_viewed", {"productId": "a"}, "a"),
                  ("product_viewed", {"productId": "b"}, "b")])
    assert P.assign_live(P.live_stats(ev, ATTRS)) is None
    blk = P.shopper_block("u1", None)
    assert blk["persona"] is None and blk["label"] == "New shopper"


def test_live_deal_hunter_behaviour():
    seq = ([("product_viewed", {"productId": "a"}, "a"), ("add_to_bag", {"productId": "a"}, "a"),
            ("product_viewed", {"productId": "b"}, "b"), ("add_to_bag", {"productId": "b"}, "b"),
            ("sort_changed", {"value": "price_asc"}, None),
            ("sort_changed", {"value": "price_asc"}, None),
            ("filter_applied", {"type": "sale", "value": "true"}, None)])
    a = P.assign_live(P.live_stats(_events(seq), ATTRS))
    assert a["persona_id"] == "price_hunter" and a["confidence"] in ("low", "medium", "high")
    blk = P.shopper_block("u1", a)
    assert blk["label"] == "Price Hunter" and blk["persona"]["name"] == "Price Hunter"
    assert "sale" in blk["persona_reason"] or "price" in blk["persona_reason"]


def test_live_mission_behaviour():
    seq = ([("search_performed", {"q": "black dress"}, None),
            ("search_performed", {"q": "black dress"}, None),
            ("search_performed", {"q": "midi"}, None),
            ("filter_applied", {"type": "category", "value": "dresses"}, None),
            ("add_to_bag", {"productId": "d"}, "d")])
    a = P.assign_live(P.live_stats(_events(seq), ATTRS))
    assert a["persona_id"] == "mission_shopper"


def test_personas_frame_and_rows():
    df = _fused_like(300)
    ref = P.Ref(df)
    af = P.personas_frame(df, ref)
    assert set(af["persona_id"]) <= set(P.PERSONA_IDS)
    assert set(af["persona_confidence"]) <= {"low", "medium", "high"}
    rows = P.personas_rows(df, ref, "2026-04-01T00:00:00")
    assert len(rows) == 4 and rows["n_members_hm"].sum() == 300
    assert all(c in rows.columns for c in P.TABLE_COLS)
