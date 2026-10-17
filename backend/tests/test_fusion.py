"""Fusion stage: hand-built OTTO sessions and H&M units with hand-computed answers."""
import duckdb
import numpy as np
import pandas as pd
import pytest

from atelier_data import fusion

FZ = {"visit_gap_minutes": 30, "utc_offset_hours": 0}
DAY = 86400
MON = 19570 * DAY  # 2023-08-07, a Monday (UTC)


def _events(rows):
    return pd.DataFrame(rows, columns=["session", "aid", "ts", "type"]).astype(
        {"session": "int32", "aid": "int32", "ts": "int32", "type": "int8"})


@pytest.fixture
def donors():
    ev = _events([
        # session 1: Monday 10:00. Click a, click b, click a (a review), cart a after 120 s, order a.
        (1, 10, MON + 36000, 0), (1, 11, MON + 36060, 0), (1, 10, MON + 36100, 0),
        (1, 10, MON + 36120, 1), (1, 10, MON + 36180, 2),
        # Saturday 20:00, new visit: click c, order a again and c (a rebuy of a on a later day).
        (1, 12, MON + 5 * DAY + 72000, 0), (1, 10, MON + 5 * DAY + 72060, 2), (1, 12, MON + 5 * DAY + 72060, 2),
        # session 2: clicks only, never orders -> not a donor.
        (2, 10, MON, 0), (2, 11, MON + 10, 0),
        # session 3: one order of item a, no clicks or carts.
        (3, 10, MON + 100, 2),
    ])
    con = duckdb.connect()
    con.register("ev_in", ev)
    return fusion.donor_raw(con, "ev_in", FZ, a=0).set_index("session")


def test_only_ordering_sessions(donors):
    assert sorted(donors.index) == [1, 3]


def test_bridge_values(donors):
    s = donors.loc[1]
    assert s["basket_size"] == pytest.approx(3 / 2)       # 3 order lines over 2 order days
    assert s["item_rebuy"] == pytest.approx(1 / 3)        # a on day 5 was ordered on day 0
    p = np.array([1, 2]) / 3
    assert s["activity_spread"] == pytest.approx(-(p * np.log(p)).sum() / np.log(2))
    assert donors.loc[3, "activity_spread"] == 0.0
    assert donors.loc[3, "purchase_frequency"] == 1.0     # 1 order day, active span under a month


def test_browsing_values(donors):
    s = donors.loc[1]
    assert s["click_to_cart"] == pytest.approx(1 / 3)     # clicked a, b, c; carted a
    assert s["cart_to_order"] == pytest.approx(1.0)
    assert s["comparison"] == pytest.approx(1 / 4)        # 4 clicks, 1 is a non-consecutive re-view
    assert s["exploration"] == pytest.approx((2 + 1) / 2)  # visit 0: a, b; visit 1: c
    assert s["decision_speed"] == pytest.approx(-120)     # first click of a to its cart
    assert s["multi_visit_research"] == 0.0               # a and c were each bought in the visit they were found
    assert s["weekend_share"] == pytest.approx(3 / 8)
    assert s["evening_share"] == pytest.approx(3 / 8)


def test_percentiles_missing_is_neutral():
    raw = pd.DataFrame({"x": [1.0, 2.0, np.nan, 2.0]})
    out = fusion.to_percentiles(raw, ["x"])["x"].tolist()
    assert out == [pytest.approx(1 / 6), pytest.approx(4 / 6), 0.5, pytest.approx(4 / 6)]


def test_hm_population_raw(tmp_path):
    units = pd.DataFrame({
        "customer_key": [1, 1, 1, 2],
        "t_dat": pd.to_datetime(["2020-01-01", "2020-01-01", "2020-02-01", "2020-01-05"]).date,
        "article_key": [100, 101, 100, 100],
        "q": [2, 1, 1, 3],
    })
    f = tmp_path / "units.parquet"
    units.to_parquet(f)
    raw = fusion.hm_population_raw(duckdb.connect(), f.as_posix()).set_index("customer_key")
    assert raw.loc[1, "basket_size"] == pytest.approx(4 / 2)
    assert raw.loc[1, "item_rebuy"] == pytest.approx(1 / 4)
    p = np.array([3, 1]) / 4
    assert raw.loc[1, "activity_spread"] == pytest.approx(-(p * np.log(p)).sum() / np.log(2))
    assert raw.loc[2, "activity_spread"] == 0.0


def test_fuse_frame_takes_neighbor_mean():
    cols = {c: 0.0 for c in fusion.profile_values(
        ["cat_garment_upper_body"] + [f"v{i}" for i in range(23)] + ["mainstream_score"])}
    hm = pd.DataFrame([{"customer_key": 1, "stratum": "light", "inclusion_weight": 1.0, **cols,
                        "purchase_frequency": 0.1, "basket_size": 0.1, "item_rebuy": 0.1,
                        "mainstream_score": 0.1, "activity_spread": 0.1}])
    dx = np.array([[0.1] * 5, [0.1] * 5, [0.9] * 5])
    db = np.array([[0.2] * 9, [0.4] * 9, [1.0] * 9])
    out = fusion.fuse_frame(hm, dx, db, k=2)
    assert out.loc[0, "click_to_cart"] == pytest.approx(0.3)
    assert len(fusion.vector_columns(out)) == 37
