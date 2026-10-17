import numpy as np
import pandas as pd
import pytest

from atelier_data import compress
from atelier_data.config import read_json
from atelier_data.features import feature_order

VOCAB = {"category_keys": ["cat_a", "cat_b", "cat_other"], "department_keys": ["dept_l", "dept_m"]}
FO = VOCAB["category_keys"] + VOCAB["department_keys"] + ["color_neutral", "color_warm", "color_cool", "x"]


def test_quantization_roundtrip():
    rng = np.random.default_rng(0)
    Z = rng.normal(size=(500, 6))
    fit = np.arange(500) < 400
    q, deq, lo, hi = compress.quantize(Z, fit)
    assert q.dtype == np.uint8
    inside = fit  # within the fit range the error is at most one step
    assert (np.abs(deq - Z)[inside] <= (hi - lo) / 255 + 1e-12).all()
    q2, deq2, _, _ = compress.quantize(np.ones((5, 2)), np.ones(5, bool))  # hi == lo -> q = 0, exact value back
    assert (q2 == 0).all() and np.allclose(deq2, 1.0)


def test_reconstruction():
    ref = np.array([0.5, 0.3, 0.2, 0.6, 0.4, 0.5, 0.3, 0.2, 0.5])
    R = np.array([[0.4, 0.4, 0.4, 0.0, 0.0, 1.2, -0.1, 0.3, 0.7],
                  [0.0, 0.0, 0.0, 0.3, 0.3, 0.2, 0.2, 0.6, 0.1]])
    out = compress.finish(R.copy(), FO, VOCAB, ref)
    assert out.min() >= 0 and out.max() <= 1
    for b in compress.blocks(FO, VOCAB):
        assert np.allclose(out[:, b].sum(axis=1), 1.0)
    assert np.allclose(out[0, 3:5], [0.6, 0.4])        # zero department block -> priors
    assert np.allclose(out[1, 0:3], [0.5, 0.3, 0.2])    # zero category block -> priors
    assert np.allclose(out[0, 5:8], np.array([1.0, 0.0, 0.3]) / 1.3)  # clipped then renormalized


def test_random_subsets_reproducible():
    fo = [f"f{i}" for i in range(25)]
    X = np.random.default_rng(1).random((10, 25))
    k = {"compressor": "random", "D": 4, "draw": 3}
    a = compress.encode(k, X, np.ones(10, bool), fo, [], 20261004)
    b = compress.encode(k, X, np.ones(10, bool), fo, [], 20261004)
    assert a[1] == b[1] and len(set(a[1]["selected"])) == 4
    assert [fo.index(f) for f in a[1]["selected"]] == np.random.default_rng(20261004 + 4000 + 3).choice(25, 4, replace=False).tolist()


def test_config_grid():
    from atelier_data import config
    cfg = config.load()
    ks = compress.configurations(cfg)
    assert len(ks) == 200  # per cutoff: 8 identity + 192 for D in {4, 8}
    assert len({compress.config_id(k) for k in ks}) == 200


def test_compressors_future_independent(built, built_future):
    """PCA, identity and random fits at the dev cutoff ignore rows on/after C_dev. (MI selection uses the dev
    target window by definition, so it is excluded here.)"""
    out = []
    for cfg in (built, built_future):
        vocab = read_json(cfg.paths.processed / "vocabularies.json")
        fo = feature_order(vocab)
        prof = pd.read_parquet(cfg.paths.processed / "profiles_dev_Eall.parquet")
        X = prof[fo].to_numpy()
        fit = np.ones(len(X), bool)
        k = {"compressor": "pca", "D": 4, "draw": None}
        Z, params = compress.encode(k, X, fit, fo, [], 1)
        out.append(np.abs(Z))
    assert np.allclose(out[0], out[1], atol=1e-9)
