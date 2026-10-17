"""NDCG, hits, vectorized Kendall tau, chunked bootstrap, weighted means."""
from __future__ import annotations

import numpy as np


def ndcg(rel: np.ndarray, order: np.ndarray, k: int | None = None) -> np.ndarray:
    """Per-row NDCG@k for graded relevance rel (u, m) under item order (u, m); NaN where all rel are 0."""
    k = k or rel.shape[1]
    disc = 1.0 / np.log2(np.arange(2, k + 2))
    dcg = (np.take_along_axis(rel, order, axis=1)[:, :k] * disc).sum(axis=1)
    idcg = (-np.sort(-rel, axis=1)[:, :k] * disc).sum(axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(idcg > 0, dcg / idcg, np.nan)


def hit(rel: np.ndarray, order: np.ndarray, k: int) -> np.ndarray:
    return (np.take_along_axis(rel, order, axis=1)[:, :k] > 0).any(axis=1).astype(float)


def positions(order: np.ndarray) -> np.ndarray:
    """Item order (u, m) -> position of each item (u, m)."""
    pos = np.empty_like(order)
    np.put_along_axis(pos, order, np.arange(order.shape[1])[None, :].repeat(len(order), 0), axis=1)
    return pos


def kendall_tau(pos_a: np.ndarray, pos_b: np.ndarray) -> np.ndarray:
    """Per-row Kendall tau between two rankings given as item-position arrays (no ties)."""
    i, j = np.triu_indices(pos_a.shape[1], 1)
    return (np.sign(pos_a[:, i] - pos_a[:, j]) * np.sign(pos_b[:, i] - pos_b[:, j])).mean(axis=1)


def bootstrap_ci(x: np.ndarray, resamples: int, chunk: int, seed: int) -> list[float]:
    """95% percentile interval of the mean, resampling rows in chunks (never all indices at once)."""
    x = np.asarray(x, dtype=float)
    if len(x) == 0:
        return [float("nan"), float("nan")]
    rng = np.random.default_rng(seed)
    means = []
    for start in range(0, resamples, chunk):
        idx = rng.integers(0, len(x), size=(min(chunk, resamples - start), len(x)))
        means.append(x[idx].mean(axis=1))
    lo, hi = np.percentile(np.concatenate(means), [2.5, 97.5])
    return [float(lo), float(hi)]


def bootstrap_delta_ci(a: np.ndarray, b: np.ndarray, resamples: int, chunk: int, seed: int) -> list[float]:
    """95% interval of mean(a) - mean(b), resampling a and b separately."""
    if len(a) == 0 or len(b) == 0:
        return [float("nan"), float("nan")]
    rng = np.random.default_rng(seed)
    out = []
    for start in range(0, resamples, chunk):
        m = min(chunk, resamples - start)
        ma = a[rng.integers(0, len(a), size=(m, len(a)))].mean(axis=1)
        mb = b[rng.integers(0, len(b), size=(m, len(b)))].mean(axis=1)
        out.append(ma - mb)
    lo, hi = np.percentile(np.concatenate(out), [2.5, 97.5])
    return [float(lo), float(hi)]


def wmean(x, w) -> float:
    x, w = np.asarray(x, dtype=float), np.asarray(w, dtype=float)
    return float((x * w).sum() / w.sum()) if len(x) else float("nan")
