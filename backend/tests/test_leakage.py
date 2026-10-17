import re
from pathlib import Path

import numpy as np
import pandas as pd

from atelier_data import db, features
from atelier_data.config import read_json
from atelier_data.features import EVIDENCE, evidence_values, feature_order

SRC = Path(__file__).parents[1] / "src" / "atelier_data"
ALLOWED_READERS = {"db.py", "ingest.py", "verify.py"}
RAW_TX = re.compile(r"\b_tx\b|TX_VIEW|transactions\.parquet|transactions_train")


def test_transactions_reader_allowlist():
    offenders = [f.name for f in SRC.glob("*.py") if f.name not in ALLOWED_READERS and RAW_TX.search(f.read_text())]
    assert offenders == [], f"modules reading transactions outside db helpers: {offenders}"


def test_leakage_fixture(built, built_future):
    """Rows dated on/after C_dev must not change any dev reference, feature or the vocabulary."""
    pa, pb = built.paths, built_future.paths
    assert read_json(pa.processed / "vocabularies.json") == read_json(pb.processed / "vocabularies.json")
    pr_a, pr_b = read_json(pa.refs("dev") / "priors.json"), read_json(pb.refs("dev") / "priors.json")
    assert pr_a.keys() == pr_b.keys()
    for k in pr_a:  # float sums from parallel aggregation: compare with tolerance (pitfall 5)
        assert pr_a[k] == pr_b[k] if isinstance(pr_a[k][0] if isinstance(pr_a[k], list) else pr_a[k], str) \
            else np.allclose(pr_a[k], pr_b[k], atol=1e-12), k
    for f in ("article_ref.parquet", "anchor_cells.parquet"):
        pd.testing.assert_frame_equal(pd.read_parquet(pa.refs("dev") / f), pd.read_parquet(pb.refs("dev") / f))
    for n in ("price_level", "purchase_frequency", "mainstream_score"):
        assert np.allclose(np.load(pa.refs("dev") / f"pop_{n}.npy"), np.load(pb.refs("dev") / f"pop_{n}.npy"), atol=1e-12)
    fo = feature_order(read_json(pa.processed / "vocabularies.json"))
    for E in ("1", "3", "10", "all"):
        a = pd.read_parquet(pa.processed / f"profiles_dev_E{E}.parquet")
        b = pd.read_parquet(pb.processed / f"profiles_dev_E{E}.parquet")
        assert a["customer_key"].tolist() == b["customer_key"].tolist()
        assert np.allclose(a[fo].to_numpy(), b[fo].to_numpy(), atol=1e-9)
        for c in EVIDENCE:
            assert evidence_values(a[c]) == evidence_values(b[c]), c
    # sanity: the future rows did change the final cutoff
    fa = pd.read_parquet(pa.processed / "profiles_final_Eall.parquet")
    fb = pd.read_parquet(pb.processed / "profiles_final_Eall.parquet")
    assert not np.allclose(fa[fo].to_numpy(), fb[fo].to_numpy())


def test_leakage_check_command(built):
    features.leakage_check(built, db.connect(built), n=8)
    assert read_json(built.paths.reports / "leakage_check.json")["passed"]
