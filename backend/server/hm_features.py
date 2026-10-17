"""Purchase features for any shopper, in exactly the form the frozen H&M models were trained on.

The training pipeline computes 195 features per shopper with DuckDB over H&M purchase rows
(atelier_data.features, model/windows.user_table, model/history). This module recomputes the same
features in numpy from a plain table of "unit" rows, so the refresh job can score new shoppers without the
H&M database. `tests/test_server.py::test_features_match_pipeline` checks that, fed real H&M rows, the
result matches the pipeline's own feature table for the same shoppers.

A unit row is one (shopper, day, channel, product) group with these columns:
    user, t_dat (datetime.date), channel (1 store / 2 online), article (int, tie-break order), n_rows, q,
    price_pct (0..1 or NaN), cat_idx, dept_idx (NaN if unknown), fam (0..2 known color family, 3 unknown),
    master_code, is_solid (bool), art_pop_pct (0..1 or NaN), md_elig, md (bool: markdown-eligible / on markdown),
    nov_elig, nov (bool: novelty-eligible / new), product_code_key (int: rebuy identity),
    f_new, f_sale (bool: history-module flags, which define "new" and "sale" slightly differently)
"""
from __future__ import annotations

import datetime as dt
import math

import numpy as np
import pandas as pd

HISTORY_CAP_DAYS = 330
BUDGETS = ("all", "10", "3", "1")
SHORT = ["markdown_affinity", "novelty_affinity", "rebuy_share"]
COLOR_KEYS = ["color_neutral", "color_warm", "color_cool"]
WINDOWS = (7, 30, 90)
TIE = 9


def feature_order(vocab):
    return (vocab["category_keys"] + vocab["department_keys"] + COLOR_KEYS + ["color_concentration", "solid_share",
            "price_level", "markdown_affinity", "novelty_affinity", "rebuy_share", "channel_2_share",
            "purchase_frequency", "mainstream_score"])


def ecdf_midrank(pop_sorted, x):
    x = np.asarray(x, dtype=float)
    lo = np.searchsorted(pop_sorted, x, side="left")
    hi = np.searchsorted(pop_sorted, x, side="right")
    return (lo + 0.5 * (hi - lo)) / len(pop_sorted)


def _smooth(num, den, prior, k):
    return (np.asarray(num, float) + k * np.asarray(prior, float)) / (den + k)


def _round_block(v, decimals=6):
    r = np.round(v, decimals)
    top = int(r.argmax())
    r[top] = np.round(r[top] + (1.0 - r.sum()), decimals)
    return r


def _breadth(shares):
    p = np.clip(shares, 1e-300, None)
    return float(-(shares * np.log(p)).sum() / math.log(len(shares)))


def _budget(R: pd.DataFrame, E, cutoff: dt.date, hl: float) -> pd.DataFrame:
    """Most recent E units (t_dat desc, article asc, channel asc), q capped by what's left of the budget."""
    age = np.array([(cutoff - d).days for d in R["t_dat"]], float)
    if E == "all":
        out = R.copy()
        out["w"] = out["q"].to_numpy(float) * np.power(2.0, -age / hl)
        return out
    E = int(E)
    o = R.assign(_age=age, _neg=-np.array([d.toordinal() for d in R["t_dat"]]))
    o = o.sort_values(["_neg", "article", "channel"], kind="stable")
    q = o["q"].to_numpy(int)
    cum_prev = np.concatenate([[0], np.cumsum(q)[:-1]])
    keep = cum_prev < E
    o = o[keep].copy()
    qe = np.minimum(q[keep], E - cum_prev[keep])
    o["q"] = qe
    o["w"] = qe * np.power(2.0, -o["_age"].to_numpy() / hl)
    return o.drop(columns=["_age", "_neg"])


def _profile(S: pd.DataFrame, cutoff: dt.date, B: dict) -> dict:
    """atelier_data.features.assemble for one shopper's (budgeted) unit rows."""
    v, pr, k = B["vocab"], B["priors"], B["pseudo_count"]
    ncat, ndept, K = len(v["category_keys"]), len(v["department_keys"]), len(v["master_colors"])
    w = S["w"].to_numpy(float)
    q = S["q"].to_numpy(float)
    # rebuy inside this row set: a later day than the first purchase of the same product
    first = S.groupby("product_code_key")["t_dat"].transform("min")
    rebuy = (S["t_dat"] > first).to_numpy()
    dept = S["dept_idx"].to_numpy(float)
    fam = S["fam"].to_numpy(int)
    pp = S["price_pct"].to_numpy(float)
    known = fam < 3
    w_all = w.sum()
    w_dept = w[~np.isnan(dept)].sum()
    w_known = w[known].sum()
    pp_ok = ~np.isnan(pp)
    days = sorted(set(S["t_dat"]))
    first_date, last_date = days[0], days[-1]
    span_days = (cutoff - first_date).days

    def piv(idx, n, mask=None):
        m = np.zeros(n)
        sel = np.ones(len(S), bool) if mask is None else mask
        idx = np.asarray(idx)
        ok = sel & ~pd.isna(idx)
        np.add.at(m, idx[ok].astype(int), w[ok])
        return m

    cat = _smooth(piv(S["cat_idx"].to_numpy(), ncat), w_all, pr["category"], k)
    dep = _smooth(piv(dept, ndept), w_dept, pr["department"], k)
    fm = _smooth(piv(fam, 3, known), w_known, pr["color_family"], k)
    s_m = _smooth(piv(S["master_code"].to_numpy(), K), w_known, pr["master_color"], k)
    hhi = float((s_m ** 2).sum())
    conc = float(np.clip((hhi - 1 / K) / (1 - 1 / K), 0, 1))
    md_e, md = S["md_elig"].to_numpy(bool), S["md"].to_numpy(bool)
    nv_e, nv = S["nov_elig"].to_numpy(bool), S["nov"].to_numpy(bool)
    pop = S["art_pop_pct"].to_numpy(float)
    out = {}
    for i, key in enumerate(v["category_keys"]):
        out[key] = cat[i]
    for i, key in enumerate(v["department_keys"]):
        out[key] = dep[i]
    for i, key in enumerate(COLOR_KEYS):
        out[key] = fm[i]
    out["color_concentration"] = conc
    out["solid_share"] = float(_smooth(w[S["is_solid"].to_numpy(bool)].sum(), w_all, pr["is_solid"], k))
    raw_pl = (float((w[pp_ok] * pp[pp_ok]).sum()) + k * 0.5) / (w[pp_ok].sum() + k)
    raw_pf = len(days) / max(1.0, span_days / 30.4375)
    raw_ms = (float(np.nansum(w * pop)) + k * round(pr["mu"], TIE)) / (w_all + k)
    out["price_level"] = float(ecdf_midrank(B["pop"]["price_level"], round(raw_pl, TIE)))
    out["markdown_affinity"] = float(_smooth(w[md_e & md].sum(), w[md_e].sum(), pr["markdown"], k))
    out["novelty_affinity"] = float(_smooth(w[nv_e & nv].sum(), w[nv_e].sum(), pr["novel"], k))
    out["rebuy_share"] = float(_smooth(w[rebuy].sum(), w_all, pr["rebuy"], k))
    out["channel_2_share"] = float(_smooth(w[S["channel"].to_numpy() == 2].sum(), w_all, pr["channel_2"], k))
    out["purchase_frequency"] = float(ecdf_midrank(B["pop"]["purchase_frequency"], round(raw_pf, TIE)))
    out["mainstream_score"] = float(ecdf_midrank(B["pop"]["mainstream_score"], round(raw_ms, TIE)))
    fo = feature_order(v)
    for f in fo:
        out[f] = round(float(out[f]), 6)
    for blk in (v["category_keys"], v["department_keys"], COLOR_KEYS):
        r = _round_block(np.array([out[f] for f in blk]))
        for f, x in zip(blk, r):
            out[f] = float(x)
    out["cat_breadth"] = _breadth(np.array([out[f] for f in v["category_keys"]]))
    units_used = int(q.sum())
    kc = int(q[known].sum())
    c = B["confidence"]
    out.update(units_used=units_used, shopping_days=len(days), history_days=(last_date - first_date).days,
               days_since_last=(cutoff - last_date).days, known_color_units=kc,
               color_coverage=kc / max(units_used, 1),
               confidence="low" if units_used < c["low_below_units"]
               else "high" if units_used >= c["high_from_units"] else "medium")
    return out


def _bridge(R: pd.DataFrame, B: dict) -> tuple[float, float]:
    ad = R.groupby(["t_dat", "article"])["q"].sum()
    dq = ad.groupby(level=0).sum().to_numpy(float)
    days = len(dq)
    basket = dq.sum() / days
    p = dq / dq.sum()
    spread = 0.0 if days < 2 else float(-(p * np.log(p)).sum() / math.log(days))
    return (float(ecdf_midrank(B["bridge_pop"]["basket_size"], round(basket, TIE))),
            float(ecdf_midrank(B["bridge_pop"]["activity_spread"], round(spread, TIE))))


def _div(a, b):
    return a / b if b > 0 else np.nan


def _history(R: pd.DataFrame, cutoff: dt.date, B: dict) -> dict:
    """model.history.build for one shopper (rows already capped at 330 days)."""
    v = B["vocab"]
    ncat, ndept, nmc = len(v["category_keys"]), len(v["department_keys"]), len(v["master_colors"])
    out = {}
    if len(R) == 0:
        for w in WINDOWS:
            out[f"units_{w}d"] = 0.0
            out[f"days_{w}d"] = 0.0
        out.update(units_all=0.0, days_all=0.0, articles_all=0.0, units_last_day=0.0)
        for name in ("days_since_last", "days_since_first", "online_90d", "online_last",
                     "price_pct_90d", "price_pct_last", "pop_pct_90d", "new_share_90d", "sale_share_90d",
                     "rebuy_share_raw", "new_share_all", "sale_share_all", "solid_90d", "mean_gap_days"):
            out[name] = np.nan
        for pre, n, wins in (("hcat", ncat, ("30d", "90d", "last", "all")), ("hdept", ndept, ("30d", "90d", "last", "all")),
                             ("hmc", nmc, ("90d", "all"))):
            for wn in wins:
                for i in range(n):
                    out[f"{pre}_{wn}_{i}"] = np.nan
        out["no_recent_history"] = 1.0
        return out
    age = np.array([(cutoff - d).days for d in R["t_dat"]], float)
    q = R["q"].to_numpy(float)
    last_day = max(R["t_dat"])
    f_last = (R["t_dat"] == last_day).to_numpy()
    first = R.groupby("product_code_key")["t_dat"].transform("min")
    f_rebuy = (R["t_dat"] > first).to_numpy()
    ch2 = (R["channel"].to_numpy() == 2).astype(float)
    pp = R["price_pct"].to_numpy(float)
    pop = R["art_pop_pct"].to_numpy(float)
    f_new = R["f_new"].to_numpy(bool).astype(float)
    f_sale = R["f_sale"].to_numpy(bool).astype(float)
    solid = R["is_solid"].to_numpy(bool).astype(float)
    tdat = R["t_dat"].to_numpy()
    for w in WINDOWS:
        m = age < w
        out[f"units_{w}d"] = float(q[m].sum())
        out[f"days_{w}d"] = float(len(set(tdat[m])))
    m90 = age < 90
    out["units_all"] = float(q.sum())
    out["days_all"] = float(len(set(tdat)))
    out["articles_all"] = float(R["article"].nunique())
    out["days_since_last"] = float(age.min())
    out["days_since_first"] = float(age.max())
    out["units_last_day"] = float(q[f_last].sum())
    out["online_90d"] = _div((q * ch2)[m90].sum(), q[m90].sum())
    out["online_last"] = _div((q * ch2)[f_last].sum(), q[f_last].sum())
    out["price_pct_90d"] = float(np.nanmean(pp[m90])) if np.isfinite(pp[m90]).any() else np.nan
    out["price_pct_last"] = float(np.nanmean(pp[f_last])) if np.isfinite(pp[f_last]).any() else np.nan
    out["pop_pct_90d"] = float(np.nanmean(pop[m90])) if np.isfinite(pop[m90]).any() else np.nan
    out["new_share_90d"] = _div((q * f_new)[m90].sum(), q[m90].sum())
    out["sale_share_90d"] = _div((q * f_sale)[m90].sum(), q[m90].sum())
    out["rebuy_share_raw"] = _div((q * f_rebuy).sum(), q.sum())
    out["new_share_all"] = _div((q * f_new).sum(), q.sum())
    out["sale_share_all"] = _div((q * f_sale).sum(), q.sum())
    out["solid_90d"] = _div((q * solid)[m90].sum(), q[m90].sum())
    out["mean_gap_days"] = (age.max() - age.min()) / max(len(set(tdat)) - 1, 1)
    filt = {"30d": age < 30, "90d": m90, "last": f_last, "all": np.ones(len(R), bool)}

    def share(col, n, prefix, names):
        idx = R[col].to_numpy(float)
        for name in names:
            sel = filt[name]
            den = q[sel].sum()
            m = np.zeros(n)
            ok = sel & ~np.isnan(idx)
            np.add.at(m, idx[ok].astype(int), q[ok])
            for i in range(n):
                out[f"{prefix}_{name}_{i}"] = m[i] / den if den > 0 else np.nan

    share("cat_idx", ncat, "hcat", ["30d", "90d", "last", "all"])
    share("dept_idx", ndept, "hdept", ["30d", "90d", "last", "all"])
    share("master_code", nmc, "hmc", ["90d", "all"])
    out["no_recent_history"] = 0.0
    return out


def build_users(units: pd.DataFrame, users: list, cutoff: dt.date, B: dict) -> pd.DataFrame:
    """One feature row per user (in the given order), NaN where the pipeline leaves gaps."""
    v = B["vocab"]
    fo = feature_order(v)
    lo = cutoff - dt.timedelta(days=HISTORY_CAP_DAYS)
    hl = B["half_life"]
    grouped = {u: g for u, g in units.groupby("user", sort=False)} if len(units) else {}
    rows = []
    for u in users:
        R = grouped.get(u)
        if R is not None:
            R = R[(R["t_dat"] >= lo) & (R["t_dat"] < cutoff)]
            R = R.sort_values(["t_dat", "article", "channel"], kind="stable").reset_index(drop=True)
        row = {"customer_key": u}
        has = R is not None and len(R) > 0
        for E in BUDGETS:
            prof = _profile(_budget(R, E, cutoff, hl), cutoff, B) if has else None
            if E == "all":
                for f in fo:
                    row[f"p_{f}"] = prof[f] if prof else np.nan
                for f in ("units_used", "shopping_days", "history_days", "days_since_last", "known_color_units",
                          "color_coverage", "cat_breadth"):
                    row[f"ev_{f}"] = float(prof[f]) if prof else np.nan
                row["confidence"] = prof["confidence"] if prof else "low"
            else:
                for f in v["category_keys"] + v["department_keys"] + SHORT:
                    row[f"e{E}_{f}"] = prof[f] if prof else np.nan
        if has:
            row["basket_size"], row["activity_spread"] = _bridge(R, B)
        else:
            row["basket_size"] = row["activity_spread"] = np.nan
        row.update(_history(R if has else pd.DataFrame(), cutoff, B))
        rows.append(row)
    df = pd.DataFrame(rows)
    df["newsletter"] = "unknown"
    df["stratum"] = "light"
    df["inclusion_weight"] = 1.0
    return df
