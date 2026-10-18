"""Multi-window layout models (v2): trained on 12 monthly windows, chosen on August, tested once on 2019.

Candidate setups per decision (both branches' best ideas, compared on the same harness):
  category    offset   multiclass on share-weighted rows, learned as a deviation from each window's population mix,
                       served on the cutoff's popularity prior                                  (model branch)
              long     one row per (shopper, category) with option features: cutoff popularity and the
                       shopper's own share over all/10/3/1 purchases; option id left out          (h&m-model branch)
  department  offset   as above, switch only past a tuned margin
              blend    w x own share + (1 - w) x popularity, w per confidence level              (h&m-model branch)
  sections    regress  4 cross-entropy regressions, one per section                              (model branch)
              long     one row per (shopper, section) with own-affinity features                 (h&m-model branch)
  sort        regress  predicted mean position per sort, switch only past a tuned margin
  color       offset   multiclass over 18 master colors, highlight top 2 only past a tuned margin

Inputs are model/work/runs/data/processed/users_<window>.parquet (windows.py): 25 profile values and evidence
(capped at 330 days), last-10/3/1 shares, basket_size, activity_spread, history features. No OTTO values, no
"last year" or 365-day features, no stratum (it is computed from purchases up to the dev cutoff).

Honesty
  - Margins and the blend weights are tuned on out-of-fold predictions pooled over the 12 training windows
    (folds by shopper), never on August or 2019.
  - August ("final") picks the setup per decision. It was already looked at, so it is a validation set now.
  - The reserved 2019 window (outside-cohort shoppers) is scored once, after freezing (test.py).
"""
from __future__ import annotations

import hashlib
import json
import pickle
import time
import warnings

import lightgbm as lgb
import numpy as np
import pandas as pd

from atelier_data import evaluate, references, rules, targets
from atelier_data.config import read_json, write_json
from atelier_data.metrics import hit, ndcg
from atelier_data.rules import SORTS

from . import common as C
from . import windows as W

warnings.filterwarnings("ignore")

OUT = C.WORK / "mw"
FROZEN = C.WORK / "frozen"
SEED = 20261015
K = 5
PARAMS = dict(learning_rate=0.05, num_leaves=31, min_data_in_leaf=60, feature_fraction=0.7, bagging_fraction=0.8,
              bagging_freq=1, lambda_l2=1.0, verbose=-1, num_threads=0)
MAX_ROUNDS = 1500
EXCLUDE = {"customer_key", "stratum", "inclusion_weight", "confidence", "newsletter"}
SECTION_FEATURE = {"new_in": "novelty_affinity", "sale": "markdown_affinity", "bestsellers": "mainstream_score",
                   "buy_again": "rebuy_share"}
SHORT = {"novelty_affinity", "markdown_affinity", "rebuy_share"}


# ---------------------------------------------------------------- data

class Win:
    """One window: user features, labels (Targets), priors, store defaults, recent popularity."""

    def __init__(self, rc, con, vocab, frozen, name, with_labels=True):
        self.name = name
        self.users = pd.read_parquet(rc.paths.processed / f"users_{name}.parquet").sort_values("customer_key")
        self.users = self.users.reset_index(drop=True)
        self.keys = self.users["customer_key"].to_numpy()
        self.priors = references.Refs(rc.paths.refs(name), vocab).priors
        self.defaults = evaluate.defaults_for(rc, name, frozen)
        cutoff = read_json(rc.paths.reports / "split_manifest.json")[name]["cutoff"]
        self.recent = references.recent_popularity(con, rc, cutoff, rc.paths.interim / f"units_{name}.parquet", vocab)
        self.prof = self.users[["customer_key", "stratum", "inclusion_weight"]]
        self.T = targets.build(con, rc, name, vocab) if with_labels else None
        if self.T is not None:
            keep = np.isin(self.T.keys, self.keys)
            if not keep.all():
                raise ValueError(f"{name}: labelled shoppers without features")


def feature_cols(users: pd.DataFrame) -> list[str]:
    return [c for c in users.columns if c not in EXCLUDE and users[c].dtype != object]


def matrix(users: pd.DataFrame, cols: list[str]) -> np.ndarray:
    X = users[cols].to_numpy(np.float32)
    conf = users["confidence"].map({"low": 0, "medium": 1, "high": 2}).fillna(0).to_numpy(np.float32)
    news = users["newsletter"].map({"not_subscribed": 0, "unknown": 1, "subscribed": 2}).fillna(1).to_numpy(np.float32)
    return np.column_stack([X, conf, news])


def labels(w: Win) -> dict:
    """Per-decision (row positions into w.users, label matrix)."""
    T = w.T
    pos = np.searchsorted(w.keys, T.keys)
    dsel = ~np.isnan(T.rel_dept).any(axis=1)
    ssel = T.rel_sec.sum(axis=1) > 0
    return {"cat": (pos, T.rel_cat), "dept": (pos[dsel], T.rel_dept[dsel]), "sec": (pos[ssel], T.rel_sec[ssel]),
            "mc": (pos, T.master_q / T.total_q[:, None]),
            "sort": (np.searchsorted(w.keys, T.sort_keys), T.gain)}


def folds_of(keys: np.ndarray) -> np.ndarray:
    return np.array([int(hashlib.md5(f"mw-fold|{k}".encode()).hexdigest()[:8], 16) % K for k in keys])


# ---------------------------------------------------------------- learners

def _expand(X, Y, off):
    r, c = np.nonzero(Y > 0)
    return X[r], c, Y[r, c], off[r]


def _lgb(params, dtr, dva=None, rounds=None):
    if dva is not None:
        return lgb.train(params, dtr, MAX_ROUNDS, valid_sets=[dva], callbacks=[lgb.early_stopping(50, verbose=False)])
    return lgb.train(params, dtr, rounds)


class MultiOffset:
    """Multiclass deviation from a per-row population mix (training: the row's window label mix)."""
    kind = "multi"

    def __init__(self, n_class):
        self.n = n_class

    def _ds(self, X, Y, off, ref=None):
        x, y, wt, o = _expand(X, Y, off)
        return lgb.Dataset(x, y, weight=wt, init_score=o.ravel(order="F"), reference=ref, free_raw_data=False)

    def fit(self, X, Y, off, Xv=None, Yv=None, offv=None, rounds=None, seed=SEED):
        p = dict(PARAMS, objective="multiclass", num_class=self.n, seed=seed)
        dtr = self._ds(X, Y, off)
        self.b = _lgb(p, dtr, self._ds(Xv, Yv, offv, dtr) if Xv is not None else None, rounds)
        self.iters = self.b.best_iteration or rounds
        return self

    def raw(self, X):
        return self.b.predict(X, raw_score=True).reshape(len(X), self.n)


def serve(raw: np.ndarray, prior) -> np.ndarray:
    z = raw + np.log(np.clip(np.asarray(prior, float), 1e-6, None))
    z -= z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


class Reg:
    def __init__(self, objective):
        self.obj = objective

    def fit(self, X, y, Xv=None, yv=None, rounds=None, seed=SEED):
        p = dict(PARAMS, objective=self.obj, seed=seed)
        dtr = lgb.Dataset(X, y, free_raw_data=False)
        self.b = _lgb(p, dtr, lgb.Dataset(Xv, yv, reference=dtr) if Xv is not None else None, rounds)
        self.iters = self.b.best_iteration or rounds
        return self

    def predict(self, X):
        return self.b.predict(X)


def long_rows(Xu: np.ndarray, own: np.ndarray, pop: np.ndarray):
    """Stack (shopper, option) rows: user features + option popularity + own affinity columns."""
    n, m = len(Xu), pop.shape[1]
    rows = np.repeat(Xu, m, axis=0)
    p = pop.reshape(-1, 1)
    o = own.reshape(n * m, -1)
    rank = (pop[:, None, :] > pop[:, :, None]).sum(-1).reshape(-1, 1).astype(np.float32)
    return np.hstack([rows, p, o, o[:, :1] - p, rank]).astype(np.float32)


# ---------------------------------------------------------------- own-affinity blocks for long format

def own_block(users: pd.DataFrame, decision: str, vocab: dict) -> np.ndarray:
    """(n, options, 4): own share over all history and the last 10/3/1 purchases (NaN where undefined)."""
    if decision == "cat":
        opts = vocab["category_keys"]
        cols = [[f"p_{o}", f"e10_{o}", f"e3_{o}", f"e1_{o}"] for o in opts]
    elif decision == "sec":
        cols = []
        for s in rules.sections(C.load_cfg()):
            f = SECTION_FEATURE[s]
            cols.append([f"p_{f}"] + ([f"e10_{f}", f"e3_{f}", f"e1_{f}"] if f in SHORT else [None, None, None]))
    else:
        raise ValueError(decision)
    n = len(users)
    out = np.full((n, len(cols), 4), np.nan, np.float32)
    for j, cs in enumerate(cols):
        for k, c in enumerate(cs):
            if c is not None:
                out[:, j, k] = users[c].to_numpy(np.float32)
    return out


def pop_block(w: Win, decision: str, frozen: dict, vocab: dict) -> np.ndarray:
    if decision == "cat":
        v = np.array(w.priors["category"], np.float32)
    else:
        v = np.array([frozen["dev_section_means"][s] for s in rules.sections(C.load_cfg())], np.float32)
    return np.tile(v, (len(w.users), 1))


# ---------------------------------------------------------------- policy

def layout(S: dict, w: Win, vocab: dict, cfg, policy: dict) -> dict:
    """Scores per decision -> scorer decision arrays. S holds probabilities/scores aligned to w.users."""
    d = w.defaults
    n = len(w.users)
    cat_keys = vocab["category_keys"]
    base_cat = np.array([cat_keys.index(k) for k in d["category_order"]])
    tie = np.tile(np.argsort(base_cat), (n, 1))
    cat_order = np.lexsort((tie, -S["cat"]), axis=1)
    base_d = vocab["department_keys"].index(d["landing_department"])
    best_d = S["dept"].argmax(1)
    landing = np.where(S["dept"][np.arange(n), best_d] - S["dept"][:, base_d] > policy["dept_margin"], best_d, base_d)
    secs = rules.sections(cfg)
    base_s = np.array([secs.index(s) for s in d["section_order"]])
    sec_order = np.lexsort((np.tile(np.argsort(base_s), (n, 1)), -S["sec"]), axis=1)
    s_star = SORTS.index(d["default_sort"])
    best_s = S["sort"].argmax(1)
    sort = np.where(S["sort"][np.arange(n), best_s] - S["sort"][:, s_star] > policy["sort_margin"], best_s, s_star)
    masters = vocab["master_colors"]
    pop2 = np.argsort(-np.array(w.priors["master_color"]), kind="stable")[:2]
    top2 = np.argsort(-S["mc"], axis=1, kind="stable")[:, :2]
    lift = np.take_along_axis(S["mc"], top2, 1).sum(1) - S["mc"][:, pop2].sum(1)
    on = lift > policy["color_margin"]
    colors = [[masters[i] for i in top2[u]] if on[u] else [] for u in range(n)]
    return {"landing": landing, "cat_order": cat_order, "sec_order": sec_order, "sort": sort,
            "colors": colors, "color_on": on}


def gains(cfg, L, w: Win, vocab) -> dict:
    S = evaluate.score(cfg, L, w.T, w.prof, vocab, w.defaults, w.priors, w.recent)
    out = {}
    for dec, met in evaluate.HEADLINE.items():
        m = S[met]
        dd = m["adapted"] - m["baseline"]
        out[dec] = {"total": float(dd.sum()), "users": int(len(dd)), "changed": int(np.sum(m["changed"]))}
    out["_S"] = S
    return out


GRID = {"dept_margin": [0.0, 0.02, 0.05, 0.1, 0.2, 0.3, np.inf],
        "sort_margin": [0.0, 0.01, 0.02, 0.05, 0.1, np.inf],
        "color_margin": [0.0, 0.05, 0.1, 0.15, 0.2, 0.3, np.inf]}
DEC_OF = {"dept_margin": "landing_department", "sort_margin": "default_sort", "color_margin": "color_highlight"}


def tune(cfg, oof: dict, wins: list[Win], vocab) -> tuple[dict, dict]:
    """Margins maximizing total gain over the pooled training windows (out-of-fold scores)."""
    policy = {"dept_margin": 0.0, "sort_margin": 0.0, "color_margin": np.inf}
    trace = {}
    for knob, vals in GRID.items():
        rows = []
        for v in vals:
            pol = {**policy, knob: v}
            tot = users = changed = 0
            for w in wins:
                g = gains(cfg, layout(oof[w.name], w, vocab, cfg, pol), w, vocab)[DEC_OF[knob]]
                tot += g["total"]; users += g["users"]; changed += g["changed"]
            rows.append({"value": None if not np.isfinite(v) else v, "total": tot, "changed": changed})
        best = max(rows, key=lambda r: (r["total"], -(r["changed"])))
        policy[knob] = np.inf if best["value"] is None else best["value"]
        trace[knob] = rows
    return policy, trace


# ---------------------------------------------------------------- training

def stack(wins: list[Win], decision: str, cols: list[str], vocab, frozen):
    """Training rows over windows for one decision."""
    X, Y, off, keys, win = [], [], [], [], []
    for w in wins:
        pos, Yw = labels(w)[decision]
        Xw = matrix(w.users, cols)[pos]
        X.append(Xw); Y.append(Yw); keys.append(w.keys[pos]); win.append(np.full(len(pos), w.name))
        if decision in ("cat", "dept", "mc"):
            o = np.log(np.clip(Yw.mean(0), 1e-6, None))
            off.append(np.tile(o, (len(pos), 1)))
    return (np.vstack(X), np.vstack(Y), np.vstack(off) if off else None, np.concatenate(keys), np.concatenate(win))


def fit_cv(make, X, Y, off, keys, kind, seed=SEED):
    """5 folds by shopper -> out-of-fold predictions (raw scores) + full model on all rows."""
    f = folds_of(keys)
    n_out = Y.shape[1] if Y.ndim > 1 else 1
    oof = np.zeros((len(X), n_out)) if kind != "reg" else np.zeros(len(X))
    iters = []
    for k in range(K):
        tr, va = f != k, f == k
        m = make()
        if kind == "multi":
            m.fit(X[tr], Y[tr], off[tr], X[va], Y[va], off[va], seed=seed + k)
            oof[va] = m.raw(X[va])
        else:
            m.fit(X[tr], Y[tr], X[va], Y[va], seed=seed + k)
            oof[va] = m.predict(X[va])
        iters.append(max(m.iters or 20, 20))
    full = make()
    n_iter = int(np.mean(iters))
    if kind == "multi":
        full.fit(X, Y, off, rounds=n_iter, seed=seed + 99)
    else:
        full.fit(X, Y, rounds=n_iter, seed=seed + 99)
    return oof, full, iters


def predict_scores(models: dict, w: Win, cols, vocab, frozen, cfg) -> dict:
    """Every candidate's scores for every shopper of a window (serving)."""
    Xu = matrix(w.users, cols)
    S = {}
    for name, (kind, m) in models.items():
        dec, setup = name.split(":")
        if kind == "multi":
            prior = {"cat": w.priors["category"], "dept": w.priors["department"], "mc": w.priors["master_color"]}[dec]
            S[name] = serve(m.raw(Xu), prior)
        elif kind == "long":
            own, pop = own_block(w.users, dec, vocab), pop_block(w, dec, frozen, vocab)
            S[name] = m.predict(long_rows(Xu, own, pop)).reshape(len(Xu), pop.shape[1])
        elif kind == "reg_multi":
            S[name] = np.column_stack([mm.predict(Xu) for mm in m])
        elif kind == "blend":
            own = w.users[[f"p_{k}" for k in vocab["department_keys"]]].to_numpy(float)
            prior = np.array(w.priors["department"])
            conf = w.users["confidence"].map({"low": 0, "medium": 1, "high": 2}).fillna(0).to_numpy(int)
            wt = np.array([m[c] for c in conf])[:, None]
            S[name] = np.where(np.isnan(own), prior, wt * np.nan_to_num(own) + (1 - wt) * prior)
    return S


def train(train_names: list[str], valid_name: str = "final", seed: int = SEED):
    t0 = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    rc = W.run_cfg()
    con = W.db.connect(rc)
    vocab = read_json(rc.paths.processed / "vocabularies.json")
    frozen = evaluate.load_frozen(rc)
    wins = [Win(rc, con, vocab, frozen, n) for n in train_names]
    valid = Win(rc, con, vocab, frozen, valid_name)
    cols = feature_cols(wins[0].users)
    for w in wins + [valid]:
        missing = [c for c in cols if c not in w.users.columns]
        if missing:
            raise ValueError(f"{w.name}: missing {missing[:5]}")
    print(f"windows {train_names} + valid {valid_name}: {len(cols) + 2} features ({time.time() - t0:.0f}s)", flush=True)
    models, oof = {}, {w.name: {} for w in wins}

    def scatter(name, raw_oof, win_ids, keys, transform):
        for w in wins:
            sel = win_ids == w.name
            full = np.zeros((len(w.users), raw_oof.shape[1]))
            full[np.searchsorted(w.keys, keys[sel])] = transform(raw_oof[sel], w)
            oof[w.name][name] = full

    # multiclass with offset: category, department, color
    for dec, nm in (("cat", "category"), ("dept", "department"), ("mc", "master_color")):
        X, Y, off, keys, win = stack(wins, dec, cols, vocab, frozen)
        o, m, it = fit_cv(lambda: MultiOffset(Y.shape[1]), X, Y, off, keys, "multi", seed)
        models[f"{dec}:offset"] = ("multi", m)
        scatter(f"{dec}:offset", o, win, keys, lambda r, w, nm=nm: serve(r, w.priors[nm]))
        print(f"  {dec}:offset trained, iters {it} ({time.time() - t0:.0f}s)", flush=True)

    # long format: category and sections
    for dec in ("cat", "sec"):
        Xs, ys, ks, ws = [], [], [], []
        for w in wins:
            pos, Yw = labels(w)[dec]
            Xu = matrix(w.users, cols)[pos]
            own = own_block(w.users.iloc[pos].reset_index(drop=True), dec, vocab)
            pop = pop_block(w, dec, frozen, vocab)[pos]
            Xs.append(long_rows(Xu, own, pop)); ys.append(Yw.reshape(-1))
            ks.append(np.repeat(w.keys[pos], Yw.shape[1])); ws.append(np.repeat(np.full(len(pos), w.name), Yw.shape[1]))
        X, y, keys, win = np.vstack(Xs), np.concatenate(ys), np.concatenate(ks), np.concatenate(ws)
        o, m, it = fit_cv(lambda: Reg("cross_entropy"), X, y, None, keys, "reg", seed)
        models[f"{dec}:long"] = ("long", m)
        n_opt = 8 if dec == "cat" else 4
        o2 = o.reshape(-1, n_opt)
        scatter(f"{dec}:long", o2, win[::n_opt], keys[::n_opt], lambda r, w: r)
        print(f"  {dec}:long trained, iters {it} ({time.time() - t0:.0f}s)", flush=True)

    # per-option regressions: sections (model branch), sort
    for dec, obj in (("sec", "cross_entropy"), ("sort", "regression")):
        X, Y, _, keys, win = stack(wins, dec, cols, vocab, frozen)
        cols_oof, ms = [], []
        for j in range(Y.shape[1]):
            o, m, _ = fit_cv(lambda: Reg(obj), X, Y[:, j], None, keys, "reg", seed + 10 * j)
            cols_oof.append(o); ms.append(m)
        models[f"{dec}:regress"] = ("reg_multi", ms)
        scatter(f"{dec}:regress", np.column_stack(cols_oof), win, keys, lambda r, w: r)
        print(f"  {dec}:regress trained ({time.time() - t0:.0f}s)", flush=True)

    # department blend: w per confidence level, fitted on the pooled training windows (no trees, nothing to cross-fit)
    best_w = {}
    for c, cname in enumerate(["low", "medium", "high"]):
        best, bw = -np.inf, 0.0
        for wt in np.linspace(0, 1, 21):
            tot = 0.0
            for w in wins:
                pos, Yd = labels(w)["dept"]
                u = w.users.iloc[pos]
                sel = (u["confidence"] == cname).to_numpy()
                if not sel.any():
                    continue
                own = np.nan_to_num(u[[f"p_{k}" for k in vocab["department_keys"]]].to_numpy(float))
                prior = np.array(w.priors["department"])
                s = wt * own + (1 - wt) * prior
                tot += Yd[sel, s[sel].argmax(1)].sum()
            if tot > best + 1e-9:
                best, bw = tot, float(wt)
        best_w[c] = bw
    models["dept:blend"] = ("blend", best_w)
    for w in wins:
        oof[w.name]["dept:blend"] = predict_scores({"dept:blend": models["dept:blend"]}, w, cols, vocab, frozen,
                                                   rc)["dept:blend"]
    print(f"  dept:blend weights per confidence {best_w}", flush=True)

    # evaluate every combination of setups on the training windows (oof) and on August (valid)
    choices = {"cat": ["offset", "long"], "dept": ["offset", "blend"], "sec": ["regress", "long"]}
    combos = [{"cat": c, "dept": d, "sec": s} for c in choices["cat"] for d in choices["dept"] for s in choices["sec"]]
    Sv = predict_scores(models, valid, cols, vocab, frozen, rc)
    with open(OUT / "valid_scores.pkl", "wb") as fh:
        pickle.dump(Sv, fh)

    def pick(S, combo):
        return {"cat": S[f"cat:{combo['cat']}"], "dept": S[f"dept:{combo['dept']}"], "sec": S[f"sec:{combo['sec']}"],
                "sort": S["sort:regress"], "mc": S["mc:offset"]}

    # margins only touch department, sort and color, so they depend on the department setup alone
    tuned = {}
    for d in choices["dept"]:
        combo0 = {"cat": "offset", "dept": d, "sec": "regress"}
        tuned[d] = tune(rc, {w.name: pick(oof[w.name], combo0) for w in wins}, wins, vocab)
        print(f"  margins with dept:{d}: {tuned[d][0]} ({time.time() - t0:.0f}s)", flush=True)
    results = []
    for combo in combos:
        policy, trace = tuned[combo["dept"]]
        Lv = layout(pick(Sv, combo), valid, vocab, rc, policy)
        res = evaluate.score_cut(con, rc, valid_name, frozen, vocab, valid.prof, Lv)
        res.pop("_T")
        results.append({"combo": combo, "policy": {k: (None if not np.isfinite(v) else v) for k, v in policy.items()},
                        "valid": summarize(res), "tune_trace": trace})
        print(f"  {combo} -> " + ", ".join(f"{d} {v['gain']:+.4f}{'*' if v['validated'] else ''}"
                                           for d, v in results[-1]["valid"].items() if d != "_extra"), flush=True)
    with open(OUT / "models.pkl", "wb") as fh:
        pickle.dump({"models": models, "cols": cols}, fh)
    write_json(OUT / "results.json", {"train": train_names, "valid": valid_name, "features": len(cols) + 2,
                                      "combos": results, "seconds": round(time.time() - t0)})
    return results


def summarize(res: dict) -> dict:
    o = res["overall"]
    out = {d: {"gain": o[d]["gain"], "ci95": o[d].get("ci95"), "adapted": o[d]["adapted"], "baseline": o[d]["baseline"],
               "changed_users": o[d]["changed_users"]["users"], "changed_gain": o[d]["changed_users"]["gain"],
               "validated": o[d]["changed_users"]["validated"]} for d in evaluate.HEADLINE}
    c = o["category_order"]
    out["_extra"] = {"cat_hit1": c["hit1"], "cat_hit3": c["hit3"], "eval_users": res["eval_users"]["overall"],
                     "per_stratum": {s: {d: res["per_stratum"][s][d]["gain"] for d in evaluate.HEADLINE}
                                     for s in res["per_stratum"]}}
    return out


# ---------------------------------------------------------------- section variants trained on one window

class LongRank:
    """LambdaRank over (shopper, option) rows; labels are shares graded 0..10 (as on h&m-model)."""
    GRADES = 10

    def __init__(self, n_opt):
        self.n = n_opt

    def _ds(self, X, y, ref=None):
        g = np.rint(np.clip(y, 0, 1) * self.GRADES).astype(int)
        return lgb.Dataset(X, g, group=np.full(len(X) // self.n, self.n), reference=ref, free_raw_data=False)

    def fit(self, X, y, Xv=None, yv=None, rounds=None, seed=SEED):
        p = dict(PARAMS, objective="lambdarank", metric="ndcg", eval_at=[self.n],
                 label_gain=list(range(self.GRADES + 1)), seed=seed)
        dtr = self._ds(X, y)
        self.b = _lgb(p, dtr, self._ds(Xv, yv, dtr) if Xv is not None else None, rounds)
        self.iters = self.b.best_iteration or rounds
        return self

    def predict(self, X):
        return self.b.predict(X)


def add_section_variants(only: list[str] = ("dev",), seed: int = SEED):
    """Section models trained on `only` (July, as on h&m-model): long + cross-entropy, long + LambdaRank, and the
    4 regressions. Appended to models.pkl / valid_scores.pkl / results.json and scored on August like the rest."""
    t0 = time.time()
    rc = W.run_cfg()
    con = W.db.connect(rc)
    vocab = read_json(rc.paths.processed / "vocabularies.json")
    frozen = evaluate.load_frozen(rc)
    with open(OUT / "models.pkl", "rb") as fh:
        pk = pickle.load(fh)
    models, cols = pk["models"], pk["cols"]
    wins = [Win(rc, con, vocab, frozen, n) for n in only]
    valid = Win(rc, con, vocab, frozen, "final")
    tag = "_".join(only)
    Xs, ys, ks = [], [], []
    for w in wins:
        pos, Yw = labels(w)["sec"]
        own = own_block(w.users.iloc[pos].reset_index(drop=True), "sec", vocab)
        Xs.append(long_rows(matrix(w.users, cols)[pos], own, pop_block(w, "sec", frozen, vocab)[pos]))
        ys.append(Yw.reshape(-1)); ks.append(np.repeat(w.keys[pos], Yw.shape[1]))
    X, y, keys = np.vstack(Xs), np.concatenate(ys), np.concatenate(ks)
    _, m_ce, it = fit_cv(lambda: Reg("cross_entropy"), X, y, None, keys, "reg", seed)
    models[f"sec:long_{tag}"] = ("long", m_ce)
    print(f"  sec:long_{tag} iters {it} ({time.time() - t0:.0f}s)", flush=True)
    _, m_rk, it = fit_cv(lambda: LongRank(4), X, y, None, keys, "reg", seed)
    models[f"sec:rank_{tag}"] = ("long", m_rk)
    print(f"  sec:rank_{tag} iters {it} ({time.time() - t0:.0f}s)", flush=True)
    Xw, Yw, _, kw, _ = stack(wins, "sec", cols, vocab, frozen)
    ms = [fit_cv(lambda: Reg("cross_entropy"), Xw, Yw[:, j], None, kw, "reg", seed + 10 * j)[1] for j in range(4)]
    models[f"sec:regress_{tag}"] = ("reg_multi", ms)
    print(f"  sec:regress_{tag} trained ({time.time() - t0:.0f}s)", flush=True)
    new = [f"sec:long_{tag}", f"sec:rank_{tag}", f"sec:regress_{tag}"]
    with open(OUT / "valid_scores.pkl", "rb") as fh:
        Sv = pickle.load(fh)
    Sv.update(predict_scores({n: models[n] for n in new}, valid, cols, vocab, frozen, rc))
    with open(OUT / "valid_scores.pkl", "wb") as fh:
        pickle.dump(Sv, fh)
    with open(OUT / "models.pkl", "wb") as fh:
        pickle.dump({"models": models, "cols": cols}, fh)
    res = read_json(OUT / "results.json")
    base = {r["combo"]["dept"]: r for r in res["combos"] if r["combo"]["cat"] == "offset" and r["combo"]["sec"] == "regress"}
    for name in new:
        setup = name.split(":")[1]
        for cat in ("offset", "long"):
            for dept, ref in base.items():
                combo = {"cat": cat, "dept": dept, "sec": setup}
                policy = {k: (np.inf if v is None else v) for k, v in ref["policy"].items()}
                picks = {"cat": Sv[f"cat:{cat}"], "dept": Sv[f"dept:{dept}"], "sec": Sv[name],
                         "sort": Sv["sort:regress"], "mc": Sv["mc:offset"]}
                r = evaluate.score_cut(con, rc, "final", frozen, vocab, valid.prof, layout(picks, valid, vocab, rc, policy))
                r.pop("_T")
                res["combos"].append({"combo": combo, "policy": ref["policy"], "valid": summarize(r),
                                      "tune_trace": ref["tune_trace"]})
        v = next(c for c in res["combos"] if c["combo"]["sec"] == setup)["valid"]["section_order"]
        print(f"  {name}: August section_order {v['gain']:+.4f} {v['ci95']} validated {v['validated']}", flush=True)
    write_json(OUT / "results.json", res)
