"""Layout model: one LightGBM model per homepage decision, trained on dev-window buyers.

Each model predicts the shopper's next-purchase mix, and a policy turns predictions into a layout:
  category_order      <- predicted share of next units per category (multiclass on share-weighted rows, learned as
                         a deviation from the population mix and served on top of the store's popularity prior)
  landing_department  <- predicted share per department (multiclass)
  section_order       <- predicted share of next units carrying each section flag (4 x cross-entropy regression)
  default_sort        <- predicted mean position of next purchases under each sort (3 x regression);
                         switch from the store default only when the predicted gain clears a margin tuned on dev
  color_highlight     <- predicted share per master color (multiclass); highlight the top 2 only when they beat
                         the population's top 2 by a margin tuned on dev
Out-of-fold predictions on dev buyers are what gets tuned and scored on dev; the final window is scored once with
models fit on all dev buyers and applied to final-cutoff features.
"""
from __future__ import annotations

import warnings

import lightgbm as lgb
import numpy as np
import pandas as pd

from atelier_data import rules, targets
from atelier_data.rules import SORTS

warnings.filterwarnings("ignore", message=".*X does not have valid feature names.*")
warnings.filterwarnings("ignore", category=lgb.basic.LGBMDeprecationWarning) if hasattr(lgb.basic, "LGBMDeprecationWarning") else None
warnings.filterwarnings("ignore", message=".*eval_set.*")

PARAMS = dict(n_estimators=2000, learning_rate=0.03, num_leaves=31, min_child_samples=40, subsample=0.8,
              subsample_freq=1, colsample_bytree=0.7, reg_lambda=1.0, verbose=-1)
K = 5


# ---------- generic trainers ----------

def _expand(X: np.ndarray, Y: np.ndarray):
    """Rows (user, class) for every class with positive share; weight = share. Multiclass on these rows fits
    the expected share distribution (cross-entropy against soft labels)."""
    r, c = np.nonzero(Y > 0)
    return X[r], c, Y[r, c], r


class Multi:
    """Multiclass booster that learns each shopper's deviation from a population mix.

    Trained with a fixed offset log(pi_train) (the training window's population mix), so the trees model only
    the shopper-specific part f(x). At serving time p(c|x) is softmax(f(x) + log pi_serve), where pi_serve is the
    store's popularity prior at that cutoff: the same prior the default layout uses. This keeps one window's
    seasonality (e.g. late-summer swimwear) out of the personal signal.
    """

    def __init__(self, booster, n_class):
        self.booster, self.n_class = booster, n_class

    def raw(self, X):
        return self.booster.predict(X, raw_score=True).reshape(len(X), self.n_class)


def _offset(Y: np.ndarray) -> np.ndarray:
    pi = Y.mean(axis=0)
    return np.log(np.clip(pi, 1e-6, None))


def _fit_multiclass(Xtr, Ytr, Xva, Yva, n_class, seed, n_estimators=None):
    off = _offset(Ytr)
    xr, yr, wr, _ = _expand(Xtr, Ytr)
    params = {"objective": "multiclass", "num_class": n_class, "learning_rate": PARAMS["learning_rate"],
              "num_leaves": PARAMS["num_leaves"], "min_data_in_leaf": PARAMS["min_child_samples"],
              "bagging_fraction": PARAMS["subsample"], "bagging_freq": PARAMS["subsample_freq"],
              "feature_fraction": PARAMS["colsample_bytree"], "lambda_l2": PARAMS["reg_lambda"],
              "seed": seed, "verbose": -1, "num_threads": 0}
    dtr = lgb.Dataset(xr, yr, weight=wr, init_score=np.tile(off, (len(yr), 1)).ravel(order="F"),
                      free_raw_data=False)
    if Xva is not None:
        xv, yv, wv, _ = _expand(Xva, Yva)
        dva = lgb.Dataset(xv, yv, weight=wv, init_score=np.tile(off, (len(yv), 1)).ravel(order="F"), reference=dtr)
        b = lgb.train(params, dtr, num_boost_round=PARAMS["n_estimators"], valid_sets=[dva],
                      callbacks=[lgb.early_stopping(100, verbose=False)])
    else:
        b = lgb.train(params, dtr, num_boost_round=n_estimators or PARAMS["n_estimators"])
    m = Multi(b, n_class)
    m.best_iteration_ = b.best_iteration if Xva is not None else None
    return m


def serve_proba(f: np.ndarray, prior) -> np.ndarray:
    """p(c|x) = softmax(f(x) + log prior)."""
    z = f + np.log(np.clip(np.asarray(prior, dtype=float), 1e-6, None))
    z -= z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def _fit_reg(Xtr, ytr, Xva, yva, seed, objective, n_estimators=None):
    m = lgb.LGBMRegressor(objective=objective, random_state=seed,
                          **{**PARAMS, **({"n_estimators": n_estimators} if n_estimators else {})})
    if Xva is not None:
        m.fit(Xtr, ytr, eval_set=[(Xva, yva)], callbacks=[lgb.early_stopping(100, verbose=False)])
    else:
        m.fit(Xtr, ytr)
    return m


def cv_then_full(kind, X_lab, Y, folds, X_apply_list, seed, n_class=None, objective=None):
    """Out-of-fold predictions for labelled rows (each fold's model early-stops on that fold), then one model fit on
    all labelled rows with the mean best iteration, applied to each matrix in X_apply_list."""
    oof = np.zeros((len(X_lab), n_class)) if kind == "multi" else np.zeros(len(X_lab))
    iters = []
    for k in range(K):
        tr, va = folds != k, folds == k
        if kind == "multi":
            m = _fit_multiclass(X_lab[tr], Y[tr], X_lab[va], Y[va], n_class, seed + k)
            oof[va] = m.raw(X_lab[va])
        else:
            m = _fit_reg(X_lab[tr], Y[tr], X_lab[va], Y[va], seed + k, objective)
            oof[va] = m.predict(X_lab[va])
        iters.append(max(m.best_iteration_ or PARAMS["n_estimators"], 20))
    n = int(np.mean(iters))
    if kind == "multi":
        full = _fit_multiclass(X_lab, Y, None, None, n_class, seed + 99, n_estimators=n)
        applied = [full.raw(Xa) for Xa in X_apply_list]
    else:
        full = _fit_reg(X_lab, Y, None, None, seed + 99, objective, n_estimators=n)
        applied = [full.predict(Xa) for Xa in X_apply_list]
    return oof, applied, full, n


# ---------- labels ----------

def labels(T: targets.Targets, keys: np.ndarray) -> dict:
    """Label arrays plus each label set's row positions in the cohort key array."""
    pos = np.searchsorted(keys, T.keys)
    dsel = ~np.isnan(T.rel_dept).any(axis=1)
    mc = T.master_q / T.total_q[:, None]
    return {"pos": pos, "cat": T.rel_cat, "dept_pos": pos[dsel], "dept": T.rel_dept[dsel],
            "sec": T.rel_sec, "mc": mc, "sort_pos": np.searchsorted(keys, T.sort_keys), "gain": T.gain}


# ---------- training all decisions ----------

def train_all(X_dev: np.ndarray, X_final: np.ndarray, lab: dict, strata: np.ndarray, n_mc: int, seed: int) -> dict:
    """Predictions for every cohort shopper at both cutoffs. Dev predictions for labelled shoppers are out-of-fold."""
    from .common import strat_folds
    out = {"dev": {}, "final": {}, "models": {}, "iters": {}}

    def put(name, idx, oof, applied):
        dev, fin = applied
        dev = dev.copy()
        dev[idx] = oof
        out["dev"][name], out["final"][name] = dev, fin

    pos = lab["pos"]
    folds = strat_folds(pos, strata[pos], K, seed)
    for name, P, Y, nc in (("cat", pos, lab["cat"], lab["cat"].shape[1]),
                           ("mc", pos, lab["mc"], n_mc)):
        oof, ap, m, n = cv_then_full("multi", X_dev[P], Y, folds, [X_dev, X_final], seed, n_class=nc)
        put(name, P, oof, ap); out["models"][name] = m; out["iters"][name] = n
    dp = lab["dept_pos"]
    dfolds = strat_folds(dp, strata[dp], K, seed)
    oof, ap, m, n = cv_then_full("multi", X_dev[dp], lab["dept"], dfolds, [X_dev, X_final], seed,
                                 n_class=lab["dept"].shape[1])
    put("dept", dp, oof, ap); out["models"]["dept"] = m; out["iters"]["dept"] = n

    sec = [], [], []
    for j in range(lab["sec"].shape[1]):
        oof, ap, m, n = cv_then_full("reg", X_dev[pos], lab["sec"][:, j], folds, [X_dev, X_final], seed + 10 * j,
                                     objective="cross_entropy")
        sec[0].append(oof); sec[1].append(ap[0]); sec[2].append(ap[1])
        out["models"][f"sec{j}"] = m; out["iters"][f"sec{j}"] = n
    put("sec", pos, np.column_stack(sec[0]), [np.column_stack(sec[1]), np.column_stack(sec[2])])

    sp = lab["sort_pos"]
    sfolds = strat_folds(sp, strata[sp], K, seed)
    srt = [], [], []
    for j in range(lab["gain"].shape[1]):
        oof, ap, m, n = cv_then_full("reg", X_dev[sp], lab["gain"][:, j], sfolds, [X_dev, X_final], seed + 100 + j,
                                     objective="regression")
        srt[0].append(oof); srt[1].append(ap[0]); srt[2].append(ap[1])
        out["models"][f"sort{j}"] = m; out["iters"][f"sort{j}"] = n
    put("sort", sp, np.column_stack(srt[0]), [np.column_stack(srt[1]), np.column_stack(srt[2])])
    return out


# ---------- policy: predictions -> layout decisions ----------

def probabilities(pred: dict, priors: dict) -> dict:
    """Raw multiclass deviations -> served probabilities at a cutoff's popularity prior."""
    out = dict(pred)
    for k, nm in (("cat", "category"), ("dept", "department"), ("mc", "master_color")):
        out[k] = serve_proba(pred[k], priors[nm])
    return out


def to_layout(pred: dict, vocab: dict, cfg, defaults: dict, priors: dict, policy: dict) -> dict:
    """Decision arrays in the scorer's format (aligned to the cohort key order). `pred` holds raw deviations
    for the multiclass decisions; they're served at this cutoff's prior here."""
    pred = probabilities(pred, priors)
    cat_p, dept_p, sec_p, sort_p, mc_p = (pred[k] for k in ("cat", "dept", "sec", "sort", "mc"))
    n = len(cat_p)
    # category order: blend toward the store's popularity prior (alpha=1 is the pure model)
    prior_c = np.array(priors["category"])
    a = policy.get("cat_alpha", 1.0)
    cat_s = a * cat_p + (1 - a) * prior_c
    base_cat = np.array([vocab["category_keys"].index(k) for k in defaults["category_order"]])
    # stable sort on -score with ties broken by the default order
    rank_in_default = np.argsort(base_cat)
    cat_order = np.lexsort((np.tile(rank_in_default, (n, 1)), -cat_s), axis=1)

    base_d = vocab["department_keys"].index(defaults["landing_department"])
    dm = policy.get("dept_margin", 0.0)
    best_d = dept_p.argmax(axis=1)
    landing = np.where(dept_p[np.arange(n), best_d] - dept_p[:, base_d] > dm, best_d, base_d)

    secs = rules.sections(cfg)
    base_s = np.array([secs.index(s) for s in defaults["section_order"]])
    sec_order = np.lexsort((np.tile(np.argsort(base_s), (n, 1)), -sec_p), axis=1)

    s_star = SORTS.index(defaults["default_sort"])
    sm = policy.get("sort_margin", 0.0)
    best_s = sort_p.argmax(axis=1)
    sort = np.where(sort_p[np.arange(n), best_s] - sort_p[:, s_star] > sm, best_s, s_star)

    masters = vocab["master_colors"]
    pop2 = np.argsort(-np.array(priors["master_color"]), kind="stable")[:2]
    top2 = np.argsort(-mc_p, axis=1, kind="stable")[:, :2]
    lift = np.take_along_axis(mc_p, top2, 1).sum(1) - mc_p[:, pop2].sum(1)
    on = lift > policy.get("color_margin", np.inf)
    colors = [[masters[i] for i in top2[u]] if on[u] else [] for u in range(n)]
    return {"landing": landing, "cat_order": cat_order, "sec_order": sec_order, "sort": sort,
            "colors": colors, "color_on": on}


def layout_records(L: dict, keys: np.ndarray, vocab: dict, cfg) -> pd.DataFrame:
    """Scorer-format layout file (README 'Scoring your model')."""
    secs = rules.sections(cfg)
    return pd.DataFrame({
        "customer_key": keys,
        "landing_department": [vocab["department_keys"][i] for i in L["landing"]],
        "category_order": [[vocab["category_keys"][i] for i in r] for r in L["cat_order"]],
        "section_order": [[secs[i] for i in r] for r in L["sec_order"]],
        "default_sort": [SORTS[i] for i in L["sort"]],
        "color_highlight": L["colors"],
    })
