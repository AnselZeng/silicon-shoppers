"""Unit tests for the shopper model (no data needed), plus integration checks on built outputs."""
import numpy as np
import pandas as pd
import pytest

from model import items, layout


def test_map_at_k_matches_hand_computed():
    truth = {1: {10, 20}, 2: {30}}
    pred = {1: [10, 99, 20], 2: [5, 6]}
    # user 1: hits at ranks 1 and 3 -> (1/1 + 2/3) / 2 ; user 2: 0
    assert items.map_at_k(pred, truth) == pytest.approx(((1 + 2 / 3) / 2 + 0) / 2)
    assert items.map_at_k({}, truth) == 0.0


def test_expand_soft_labels():
    X = np.arange(6, dtype=float).reshape(3, 2)
    Y = np.array([[0.5, 0.5, 0], [0, 0, 1.0], [0.25, 0, 0.75]])
    xr, yr, wr, r = layout._expand(X, Y)
    assert list(yr) == [0, 1, 2, 0, 2]
    assert np.allclose(wr, [0.5, 0.5, 1.0, 0.25, 0.75])
    assert np.array_equal(xr, X[[0, 0, 1, 2, 2]])


def test_serve_proba_zero_deviation_returns_prior():
    prior = np.array([0.6, 0.3, 0.1])
    p = layout.serve_proba(np.zeros((4, 3)), prior)
    assert np.allclose(p, np.tile(prior, (4, 1)))
    assert np.allclose(p.sum(1), 1)


def _toy(n=6):
    vocab = {"category_keys": [f"c{i}" for i in range(8)], "department_keys": [f"d{i}" for i in range(5)],
             "master_colors": [f"m{i}" for i in range(18)]}
    priors = {"category": list(np.linspace(0.3, 0.02, 8) / np.linspace(0.3, 0.02, 8).sum()),
              "department": [0.6, 0.1, 0.2, 0.05, 0.05], "master_color": list(np.r_[0.4, 0.3, np.full(16, 0.3 / 16)])}
    defaults = {"category_order": vocab["category_keys"], "landing_department": "d0",
                "section_order": ["bestsellers", "sale", "new_in", "buy_again"], "default_sort": "bestsellers"}
    rng = np.random.default_rng(0)
    pred = {"cat": rng.normal(size=(n, 8)), "dept": rng.normal(size=(n, 5)), "mc": rng.normal(size=(n, 18)),
            "sec": rng.random((n, 4)), "sort": rng.random((n, 3))}
    return vocab, priors, defaults, pred


class _Cfg:
    rules = {"decisions": {"section_order": {"sections": {"new_in": 0, "sale": 0, "bestsellers": 0, "buy_again": 0}}}}


def test_infinite_margins_keep_store_defaults():
    vocab, priors, defaults, pred = _toy()
    L = layout.to_layout(pred, vocab, _Cfg(), defaults, priors,
                         {"cat_alpha": 0.0, "dept_margin": np.inf, "sort_margin": np.inf, "color_margin": np.inf})
    assert (L["landing"] == 0).all()
    assert (L["sort"] == 2).all()  # bestsellers
    assert not L["color_on"].any() and all(c == [] for c in L["colors"])
    assert (L["cat_order"] == np.arange(8)).all()  # alpha 0 -> pure prior, which is the default order


def test_layout_orders_are_permutations():
    vocab, priors, defaults, pred = _toy(50)
    L = layout.to_layout(pred, vocab, _Cfg(), defaults, priors,
                         {"cat_alpha": 1.0, "dept_margin": 0.0, "sort_margin": 0.0, "color_margin": 0.0})
    assert all(sorted(r) == list(range(8)) for r in L["cat_order"])
    assert all(sorted(r) == list(range(4)) for r in L["sec_order"])
    assert all(len(c) == 2 for c, on in zip(L["colors"], L["color_on"]) if on)


@pytest.mark.integration
def test_shipped_layouts_pass_the_scorer_validation():
    from atelier_data import evaluate
    from model import common as C
    cfg = C.load_cfg()
    vocab = C.vocab(cfg)
    prof = pd.read_parquet(cfg.paths.processed / "profiles_final_Eall.parquet").sort_values("customer_key")
    df = pd.read_parquet(C.WORK / "layouts" / "layouts_f37_hist_final.parquet")
    evaluate.layouts_to_decisions(cfg, df, prof, vocab)  # raises LayoutError on any invalid row


@pytest.mark.integration
def test_history_features_end_before_cutoff():
    from model import common as C
    h = pd.read_parquet(C.WORK / "history_dev.parquet")
    assert (h["days_since_last"] >= 1).all()  # nothing on or after the cutoff day
    assert len(h) == 100_000 and h["customer_key"].is_unique


def test_window_plan_never_touches_the_reserved_window():
    import datetime as dt
    from model import windows as W
    p = W.plan(W.base_cfg())
    start = dt.date(2018, 9, 20)
    r0, r1 = W.RESERVED
    train = {k: v for k, v in p.items() if v["role"] == "train"}
    assert len(train) == 12 and p["final"]["role"] == "valid" and p["reserved"]["role"] == "test"
    for name, w in train.items():
        c, t1 = dt.date.fromisoformat(w["target"][0]), dt.date.fromisoformat(w["target"][1])
        assert t1 <= r0 or c >= r1, f"{name} overlaps the reserved window"
        assert c - dt.timedelta(days=W.HISTORY_CAP_DAYS) >= start, f"{name} has less than the capped history"
    assert dt.date.fromisoformat(p["reserved"]["cutoff"]) - dt.timedelta(days=W.HISTORY_CAP_DAYS) >= start


def test_history_features_have_no_last_year_or_365_day_columns():
    from model import history
    assert history.WINDOWS == (7, 30, 90) and history.HISTORY_CAP_DAYS == 330
