"""Unit tests (no OTTO data needed): live features on hand-built events, tree export, policy gating."""
import math

import lightgbm as lgb
import numpy as np
import pytest

from session_model import export
from session_model.features import FEATURES, session_features


def f(events):
    return dict(zip(FEATURES, session_features(events)))


def test_features_hand_computed():
    # visit 1: click A, click B, click A (a revisit), cart A; 2 h later visit 2: click C, cart B (researched), order B
    ev = [(0, 1, 0), (10, 2, 0), (40, 1, 0), (70, 1, 1),
          (7270, 3, 0), (7300, 2, 1), (7310, 2, 2)]
    x = f(ev)
    assert x["n_events"] == 7 and x["n_clicks"] == 4 and x["n_carts"] == 2 and x["n_orders"] == 1
    assert x["n_visits"] == 2 and x["events_per_visit"] == 3.5
    assert x["distinct_items"] == 3
    assert x["distinct_per_click"] == pytest.approx(3 / 4)
    assert x["explore_per_visit"] == pytest.approx((2 + 1) / 2)   # {A,B} then {C}
    assert x["revisit_share"] == pytest.approx(1 / 4)             # the second click on A
    assert x["repeat_share"] == 0
    # within-visit gaps: 10, 30, 30 | 30, 10
    assert x["pace_median_log"] == pytest.approx(math.log1p(30))
    assert x["cart_rate"] == pytest.approx(2 / 3)                 # A and B carted of A, B, C clicked
    assert x["decide_median_log"] == pytest.approx(math.log1p((70 + 7290) / 2))  # A: 70 s, B: 7290 s
    assert x["cart_after_research"] == pytest.approx(1 / 2)       # B first clicked in an earlier visit
    assert x["cart_to_order_now"] == pytest.approx(1 / 2)


def test_features_empty_and_single():
    assert all(math.isnan(v) for v in session_features([]))
    x = f([(5, 9, 0)])
    assert x["n_events"] == 1 and math.isnan(x["pace_median_log"]) and x["cart_rate"] == 0 and math.isnan(x["cart_to_order_now"])


def test_order_independent_of_arrival():
    ev = [(0, 1, 0), (10, 2, 0), (10, 2, 1), (50, 1, 0)]
    assert np.allclose(session_features(ev), session_features(ev[::-1]), equal_nan=True)


def test_flattened_trees_match_lightgbm():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(600, 4))
    X[rng.random(X.shape) < 0.1] = np.nan
    X[:, 3] = np.where(rng.random(600) < 0.3, 0.0, X[:, 3])
    y = np.nan_to_num(X[:, 0]) * 0.3 + (np.nan_to_num(X[:, 1]) > 0) * 0.2 + rng.normal(0, 0.05, 600)
    b = lgb.train({"objective": "regression", "verbose": -1, "num_leaves": 7, "min_data_in_leaf": 10},
                  lgb.Dataset(X, y), num_boost_round=30)
    trees = [export.flatten(t) for t in b.dump_model()["tree_info"]]
    ours = np.array([sum(export.tree_value(t, list(row)) for t in trees) for row in X])
    assert np.allclose(ours, b.predict(X), atol=1e-9)


def test_policy_waits_for_reliable_signal():
    model = {"min_r2": 0.1, "policy": export.POLICY,
             "targets": {t: {"r2_by_events": {"3": 0.02, "10": 0.3}} for t in
                         ["exploration", "comparison", "browsing_pace", "click_to_cart", "cart_to_order",
                          "decision_speed", "multi_visit_research"]}}
    style = {t: 0.9 for t in model["targets"]}
    early = export.decide(model, style, 5)
    assert all(not d["active"] for d in early.values())
    later = export.decide(model, style, 12)
    assert later["grid_columns"]["value"] == 4 and later["compare_panel"]["value"] == "on"
    assert later["cart_reminder"]["value"] == "off"            # needs low cart_to_order


def test_kaggle_credentials_from_env_file(tmp_path, monkeypatch):
    from session_model import data
    for k in data.KAGGLE_VARS:
        monkeypatch.delenv(k, raising=False)
    f = tmp_path / ".env"
    f.write_text('SUPABASE_URL=x\nKAGGLE_USERNAME="prabhu"\nKAGGLE_KEY=abc123\n# KAGGLE_API_TOKEN=ignored\n')
    assert data.load_kaggle_env(f) == {"KAGGLE_USERNAME": "prabhu", "KAGGLE_KEY": "abc123"}
    monkeypatch.setenv("KAGGLE_KEY", "from_shell")
    assert data.load_kaggle_env(f)["KAGGLE_KEY"] == "from_shell"
