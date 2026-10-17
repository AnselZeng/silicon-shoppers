"""Population ECDF (mid-rank ties) and within-configuration trigger percentiles."""
import numpy as np
from scipy.stats import rankdata


def ecdf_midrank(pop_sorted: np.ndarray, x) -> np.ndarray:
    """(count(pop < x) + 0.5 * count(pop == x)) / N; pop_sorted must be ascending."""
    x = np.asarray(x, dtype=float)
    lo = np.searchsorted(pop_sorted, x, side="left")
    hi = np.searchsorted(pop_sorted, x, side="right")
    return (lo + 0.5 * (hi - lo)) / len(pop_sorted)


def within_config_pct(values) -> np.ndarray:
    """(rankdata(values, 'average') - 0.5) / n over all rows of one configuration."""
    v = np.asarray(values, dtype=float)
    return (rankdata(v, method="average") - 0.5) / len(v)
