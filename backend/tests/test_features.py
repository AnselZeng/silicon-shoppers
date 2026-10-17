import datetime as dt

import numpy as np
import pandas as pd
import pytest
from conftest import flags_df, keys
from fixtures import ARTICLES, C_DEV

from atelier_data.config import read_json
from atelier_data.features import feature_order, smoothed


def test_smoothed_share_hand():
    p = smoothed(np.array([[2.0, 1.0, 0.0]]), np.array([3.0]), [0.5, 0.3, 0.2], 5)
    assert p[0].tolist() == pytest.approx([0.5625, 0.3125, 0.125])
    assert p.sum() == pytest.approx(1.0)


def test_smoothed_share_profile(built):
    """c01 has one unit (A01: Upper body, Ladieswear, Black, Solid) on 2019-06-01."""
    v = read_json(built.paths.processed / "vocabularies.json")
    assert v["category_keys"] == ["cat_garment_upper_body", "cat_shoes", "cat_other"]
    pr = read_json(built.paths.refs("dev") / "priors.json")
    prof = pd.read_parquet(built.paths.processed / "profiles_dev_Eall.parquet")
    row = prof[prof["customer_key"] == keys(built)["c01"]].iloc[0]
    w = 2 ** (-(C_DEV - dt.date(2019, 6, 1)).days / 180)
    assert row["cat_garment_upper_body"] == pytest.approx((w + 5 * pr["category"][0]) / (w + 5), abs=1e-6)
    assert row["cat_shoes"] == pytest.approx(5 * pr["category"][1] / (w + 5), abs=1e-6)
    assert row["dept_ladieswear"] == pytest.approx((w + 5 * pr["department"][0]) / (w + 5), abs=1e-6)
    assert row["solid_share"] == pytest.approx((w + 5 * pr["is_solid"]) / (w + 5), abs=1e-6)
    assert row["units_used"] == 1 and row["confidence"] == "low" and list(row["top_colors"]) == ["Black"]
    assert row["newsletter"] == "subscribed"
    for block in (v["category_keys"], v["department_keys"], ["color_neutral", "color_warm", "color_cool"]):
        assert np.allclose(prof[block].sum(axis=1), 1.0, atol=1e-5)
    fo = feature_order(v)
    assert prof[fo].min().min() >= 0 and prof[fo].max().max() <= 1 and not prof[fo].isna().any().any()


def _f(df, cust, art, day=None):
    m = (df["customer_id"] == cust) & (df["article_id"] == ARTICLES[art][0])
    if day:
        m &= df["t_dat"] == dt.date.fromisoformat(day)
    return df[m]


def test_novelty(built):
    f = flags_df(built)
    assert not _f(f, "c10", "OLD")["nov_elig"].iloc[0]                 # left-censored
    new = _f(f, "c09", "NEW").iloc[0]
    assert new["nov_elig"] and new["nov"]                               # 28 days: inclusive
    new2 = _f(f, "c09", "NEW2").iloc[0]
    assert new2["nov_elig"] and not new2["nov"]                         # 29 days


def test_rebuy(built):
    f = flags_df(built)
    assert not _f(f, "c08", "R1", "2020-01-10")["rebuy"].iloc[0]
    assert not _f(f, "c08", "R2", "2020-01-10")["rebuy"].iloc[0]      # same product_code, same date
    assert _f(f, "c08", "R1", "2020-03-10")["rebuy"].iloc[0]           # strictly later date


def test_markdown_anchor(built):
    f = flags_df(built)
    cells = pd.read_parquet(built.paths.refs("dev") / "anchor_cells.parquet")
    ak = dict(zip(pd.read_parquet(built.paths.ingested / "articles.parquet")["article_id"],
                  pd.read_parquet(built.paths.ingested / "articles.parquet")["article_key"]))
    md_cell = cells[cells["article_key"] == ak[ARTICLES["MD"][0]]].iloc[0]
    assert md_cell["n"] == 21 and md_cell["anchor"] == pytest.approx(10.0)  # q90 of [6.5] + 20 x [10.0]
    md = _f(f, "c09", "MD").iloc[0]
    assert md["md_elig"] and md["md"]                                   # 6.5 <= markdown_ratio 0.70 * 10.0
    assert not _f(f, "c10", "MD")["md"].any()
    assert not _f(f, "c10", "A19")["md_elig"].any()                     # 19 rows: no anchor
