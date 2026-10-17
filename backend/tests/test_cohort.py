import pandas as pd
import pytest
from conftest import keys

from atelier_data.cohort import largest_remainder


def test_largest_remainder():
    w = {"light": 2, "lower_mid": 1, "upper_mid": 0, "heavy": 1}
    assert largest_remainder(1, w, caps=w) == {"light": 1, "lower_mid": 0, "upper_mid": 0, "heavy": 0}
    assert largest_remainder(3, w, caps=w) == {"light": 1, "lower_mid": 1, "upper_mid": 0, "heavy": 1}  # quotas 1.5, .75, .75
    assert sum(largest_remainder(4, w, caps=w).values()) == 4


def test_cohort_strata_and_deficit(built):
    c = pd.read_parquet(built.paths.processed / "cohort.parquet")
    assert len(c) == 4 * 2
    assert c["stratum"].value_counts().to_dict() == {"light": 3, "lower_mid": 2, "heavy": 2, "upper_mid": 1}
    w = c.groupby("stratum")["inclusion_weight"].first()
    assert w.to_dict() == pytest.approx({"light": 4 / 3, "lower_mid": 3 / 2, "upper_mid": 1.0, "heavy": 3 / 2})
    k = keys(built)
    assert k["c12"] not in set(c["customer_key"])           # only future purchases
    assert c.loc[c["customer_key"] == k["c08"], "units_dev"].item() == 7
    assert list(c.columns) == ["customer_key", "customer_id", "stratum", "units_dev", "inclusion_weight",
                               "fit_split", "attack_split", "showcase_hash"]


def test_cohort_future_independence(built, built_future):
    cols = ["customer_key", "stratum", "units_dev", "inclusion_weight"]
    a = pd.read_parquet(built.paths.processed / "cohort.parquet")[cols]
    b = pd.read_parquet(built_future.paths.processed / "cohort.parquet")[cols]
    pd.testing.assert_frame_equal(a, b)
