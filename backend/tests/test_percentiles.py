import numpy as np
import pytest

from atelier_data.percentiles import ecdf_midrank, within_config_pct


def test_ecdf_midrank():
    pop = np.array([1.0, 2.0, 2.0, 3.0])
    assert ecdf_midrank(pop, [0, 1, 2, 2.5, 3, 4]).tolist() == pytest.approx([0, 0.125, 0.5, 0.75, 0.875, 1.0])


def test_within_config_pct_rate():
    v = np.random.default_rng(20261004).random(10_000)
    pct = within_config_pct(v)
    assert pct.min() == pytest.approx(0.5 / 10_000) and pct.max() == pytest.approx(1 - 0.5 / 10_000)
    assert (pct >= 0.85).mean() == pytest.approx(0.15, abs=0.001)
    assert within_config_pct([1, 1, 2]).tolist() == pytest.approx([1 / 3, 1 / 3, 2.5 / 3])
