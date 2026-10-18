import math

import numpy as np
import pandas as pd
import pytest
from scipy.stats import kendalltau

from atelier_data import db, targets
from atelier_data.metrics import bootstrap_ci, hit, kendall_tau, ndcg, positions


def test_ndcg():
    rel = np.array([[0.5, 0.0, 0.3, 0.2]])
    order = np.array([[2, 0, 1, 3]])
    dcg = 0.3 + 0.5 / math.log2(3) + 0.0 / 2 + 0.2 / math.log2(5)
    idcg = 0.5 + 0.3 / math.log2(3) + 0.2 / 2
    assert ndcg(rel, order)[0] == pytest.approx(dcg / idcg)
    assert ndcg(rel, np.array([[0, 2, 3, 1]]))[0] == pytest.approx(1.0)
    assert np.isnan(ndcg(np.zeros((1, 4)), order)[0])
    assert hit(rel, order, 1)[0] == 1.0 and hit(rel, np.array([[1, 0, 2, 3]]), 1)[0] == 0.0


def test_kendall_vectorized():
    rng = np.random.default_rng(0)
    a = np.array([rng.permutation(8) for _ in range(200)])
    b = np.array([rng.permutation(8) for _ in range(200)])
    got = kendall_tau(positions(a), positions(b))
    want = [kendalltau(positions(a)[i], positions(b)[i]).statistic for i in range(200)]
    assert np.allclose(got, want)


def test_bootstrap_ci_chunked_deterministic():
    x = np.random.default_rng(1).normal(0.1, 1, 500)
    a = bootstrap_ci(x, 200, 50, 7)
    assert a == bootstrap_ci(x, 200, 50, 7) and a[0] < x.mean() < a[1]


def test_sort_positions(built):
    con = db.connect(built)
    sp = con.execute(f"SELECT * FROM {targets.sort_positions_sql(built.paths.refs('final'))}").df()
    assert len(sp) > 0
    multi = sp[sp["n"] >= 2]
    for col in ("pos_price_asc", "pos_newest", "pos_bestsellers"):
        g = multi.groupby("product_type_key")[col]
        assert (g.max() == 1).all() and (g.min() == 0).all()
        assert sp.loc[sp["n"] == 1, col].isna().all()
    assert (sp["n"] == 1).any()  # fixture has single-article types: excluded
