"""8.10 evaluate: baselines, frozen dev defaults, gains with CIs, targeting test, shuffle control."""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import references, rules, targets
from .config import append_preflight, merge_json, read_json, write_json
from .features import feature_order
from .log import DataLog
from .metrics import bootstrap_ci, bootstrap_delta_ci, hit, ndcg, wmean
from .rules import SORTS

FULL = "Eall_D25_identity_float32"
RULES_LABEL = "rules v1: hand-written baseline"
STRATA = ["light", "lower_mid", "upper_mid", "heavy"]
META = ["confidence", "newsletter", "top_colors", "known_color_units"]


def frozen_path(cfg):
    return cfg.paths.processed / "rules_frozen.json"


def save_frozen(cfg, updates: dict) -> dict:
    """Read-merge-write by key (validity and evaluate both write here); copied to reports/."""
    merged = merge_json(frozen_path(cfg), updates)
    write_json(cfg.paths.reports / "rules_frozen.json", merged)
    return merged


def load_frozen(cfg) -> dict:
    return read_json(frozen_path(cfg)) if frozen_path(cfg).exists() else {}


def freeze_from_dev(cfg, T: targets.Targets) -> dict:
    secs = rules.sections(cfg)
    sec_order = [secs[i] for i in np.argsort(-T.rel_sec.mean(axis=0), kind="stable")]
    return {"default_section_order": sec_order, "store_default_sort": SORTS[int(np.argmax(T.gain.mean(axis=0)))],
            "dev_section_means": dict(zip(secs, T.rel_sec.mean(axis=0).round(6).tolist())),
            "dev_sort_means": dict(zip(SORTS, T.gain.mean(axis=0).round(6).tolist()))}


def score(cfg, L: dict, T: targets.Targets, prof: pd.DataFrame, vocab: dict, defaults: dict, priors: dict,
          recent: dict) -> dict:
    """Per-user adapted and baseline values for each tested decision. `changed` marks users whose layout the
    decision changed from the store default; *_recent entries score against recent (28-day) popularity."""
    pk = prof["customer_key"].to_numpy()
    strat, wts = prof["stratum"].to_numpy(), prof["inclusion_weight"].to_numpy(dtype=float)
    idx = np.searchsorted(pk, T.keys)
    n = len(idx)
    out = {}

    def put(name, sel, adapted, baseline, changed, **extra):
        out[name] = {"keys": T.keys[sel] if sel is not None else T.keys, "adapted": adapted, "baseline": baseline,
                     "changed": changed,
                     "stratum": strat[idx[sel] if sel is not None else idx],
                     "weight": wts[idx[sel] if sel is not None else idx], **extra}

    cat_keys = vocab["category_keys"]
    base_order = np.tile([cat_keys.index(k) for k in defaults["category_order"]], (n, 1))
    rec_order = np.tile([cat_keys.index(k) for k in recent["category_order"]], (n, 1))
    ad_order = L["cat_order"][idx]
    ch = (ad_order != base_order).any(axis=1)
    put("cat_ndcg", None, ndcg(T.rel_cat, ad_order), ndcg(T.rel_cat, base_order), ch)
    put("cat_hit1", None, hit(T.rel_cat, ad_order, 1), hit(T.rel_cat, base_order, 1), ch)
    put("cat_hit3", None, hit(T.rel_cat, ad_order, 3), hit(T.rel_cat, base_order, 3), ch)
    ch_r = (ad_order != rec_order).any(axis=1)
    put("cat_ndcg_recent", None, ndcg(T.rel_cat, ad_order), ndcg(T.rel_cat, rec_order), ch_r)
    put("cat_hit1_recent", None, hit(T.rel_cat, ad_order, 1), hit(T.rel_cat, rec_order, 1), ch_r)
    put("cat_hit3_recent", None, hit(T.rel_cat, ad_order, 3), hit(T.rel_cat, rec_order, 3), ch_r)

    sel = ~np.isnan(T.rel_dept).any(axis=1)
    dk = vocab["department_keys"]
    base_d, rec_d = dk.index(defaults["landing_department"]), dk.index(recent["department_order"][0])
    rd = T.rel_dept[sel]
    land = L["landing"][idx[sel]]
    put("dept_share", sel, rd[np.arange(sel.sum()), land], rd[:, base_d], land != base_d)
    put("dept_share_recent", sel, rd[np.arange(sel.sum()), land], rd[:, rec_d], land != rec_d)

    secs = rules.sections(cfg)
    sel = T.rel_sec.sum(axis=1) > 0
    base_s = np.tile([secs.index(s) for s in defaults["section_order"]], (int(sel.sum()), 1))
    so = L["sec_order"][idx[sel]]
    put("section_ndcg", sel, ndcg(T.rel_sec[sel], so), ndcg(T.rel_sec[sel], base_s), (so != base_s).any(axis=1))

    sidx = np.searchsorted(pk, T.sort_keys)
    s_star = SORTS.index(defaults["default_sort"])
    chosen = L["sort"][sidx]
    out["sort_gain"] = {"keys": T.sort_keys, "adapted": T.gain[np.arange(len(sidx)), chosen],
                        "baseline": T.gain[:, s_star], "changed": chosen != s_star,
                        "stratum": strat[sidx], "weight": wts[sidx]}

    masters = vocab["master_colors"]
    sel = L["color_on"][idx]
    pop_top = [masters[i] for i in np.argsort(-np.array(priors["master_color"]), kind="stable")[:2]]
    base_codes = [masters.index(c) for c in pop_top]
    ad = np.array([T.master_q[u, [masters.index(c) for c in L["colors"][idx[u]]]].sum() / T.total_q[u]
                   for u in np.flatnonzero(sel)])
    base = T.master_q[sel][:, base_codes].sum(axis=1) / T.total_q[sel]
    # store default is no highlight; changed users are the highlighted ones, scored against the population's top 2
    put("color_share", sel, ad, base, np.ones(int(sel.sum()), dtype=bool), baseline_colors=pop_top)
    return out


def block(m: dict, cfg, seed_offset: int, ci=True) -> dict:
    ev = cfg["evaluation"]
    d = m["adapted"] - m["baseline"]
    res = {"users": int(len(d)), "adapted": float(np.mean(m["adapted"])) if len(d) else None,
           "baseline": float(np.mean(m["baseline"])) if len(d) else None, "gain": float(np.mean(d)) if len(d) else None}
    if ci:
        res["ci95"] = bootstrap_ci(d, ev["bootstrap_resamples"], ev["bootstrap_chunk"], cfg["seed"] + seed_offset)
    return res


HEADLINE = {"category_order": "cat_ndcg", "landing_department": "dept_share", "section_order": "section_ndcg",
            "default_sort": "sort_gain", "color_highlight": "color_share"}


def subset(m: dict, sel: np.ndarray) -> dict:
    return {k: (v[sel] if isinstance(v, np.ndarray) and len(v) == len(sel) else v) for k, v in m.items()}


def summarize(cfg, S: dict) -> dict:
    out = {"overall": {}, "per_stratum": {s: {} for s in STRATA}, "population_weighted": {}}
    for i, (dec, met) in enumerate(HEADLINE.items()):
        m = S[met]
        out["overall"][dec] = {"metric": met, **block(m, cfg, i)}
        # validated only if the users whose layout this decision changed do better than the default (CI > 0)
        chg = block(subset(m, m["changed"]), cfg, 50 + i)
        chg["validated"] = bool(chg["ci95"][0] is not None and np.isfinite(chg["ci95"][0]) and chg["ci95"][0] > 0)
        out["overall"][dec]["changed_users"] = chg
        if f"{met}_recent" in S:
            out["overall"][dec]["vs_recent_popularity"] = block(S[f"{met}_recent"], cfg, 70 + i)
        for j, s in enumerate(STRATA):
            out["per_stratum"][s][dec] = block(subset(m, m["stratum"] == s), cfg, 100 * (j + 1) + i)
            if f"{met}_recent" in S:
                r = S[f"{met}_recent"]
                out["per_stratum"][s][dec]["vs_recent_popularity"] = block(subset(r, r["stratum"] == s), cfg,
                                                                           300 + 10 * j + i)
        out["population_weighted"][dec] = {
            "adapted": wmean(m["adapted"], m["weight"]), "baseline": wmean(m["baseline"], m["weight"]),
            "gain": wmean(m["adapted"] - m["baseline"], m["weight"])}
    c = out["overall"]["category_order"]
    for h in ("hit1", "hit3"):
        c[h] = {"adapted": float(S[f"cat_{h}"]["adapted"].mean()), "baseline": float(S[f"cat_{h}"]["baseline"].mean()),
                "baseline_recent": float(S[f"cat_{h}_recent"]["baseline"].mean())}
    # the two popularity baselines head to head (no layout involved)
    out["baselines"] = {
        "popularity_all_time": {"cat_ndcg": float(S["cat_ndcg"]["baseline"].mean()),
                                "cat_hit1": float(S["cat_hit1"]["baseline"].mean()),
                                "cat_hit3": float(S["cat_hit3"]["baseline"].mean()),
                                "dept_share": float(S["dept_share"]["baseline"].mean())},
        "popularity_recent": {"cat_ndcg": float(S["cat_ndcg_recent"]["baseline"].mean()),
                              "cat_hit1": float(S["cat_hit1_recent"]["baseline"].mean()),
                              "cat_hit3": float(S["cat_hit3_recent"]["baseline"].mean()),
                              "dept_share": float(S["dept_share_recent"]["baseline"].mean()),
                              "window_days": cfg["evaluation"]["recent_popularity_days"]},
    }
    d = S["cat_ndcg_recent"]["baseline"] - S["cat_ndcg"]["baseline"]
    out["baselines"]["recent_minus_all_time_cat_ndcg"] = {
        "gain": float(d.mean()), "ci95": bootstrap_ci(d, cfg["evaluation"]["bootstrap_resamples"],
                                                      cfg["evaluation"]["bootstrap_chunk"], cfg["seed"] + 990)}
    out["overall"]["color_highlight"]["baseline_colors"] = S["color_share"]["baseline_colors"]
    return out


def targeting(cfg, L: dict, T: targets.Targets, prof: pd.DataFrame, s_star: str) -> list[dict]:
    ev = cfg["evaluation"]
    sidx = np.searchsorted(prof["customer_key"].to_numpy(), T.sort_keys)
    si = SORTS.index(s_star)
    res = []
    for k, c in enumerate(cfg.rules["decisions"]["default_sort"]["candidates"]):
        name = f"{c['feature']}->{c['sort']}"
        fired = L["sort_fired"][c["feature"]][sidx]
        row = {"rule": name, "feature": c["feature"], "fired_users": int(fired.sum()),
               "non_fired_users": int((~fired).sum())}
        if c["sort"] == s_star:
            res.append({**row, "delta": 0.0, "ci95": [0.0, 0.0], "validated": False,
                        "note": "rule sort equals store default; targeting not testable"})
            continue
        d = T.gain[:, SORTS.index(c["sort"])] - T.gain[:, si]
        delta = float(d[fired].mean() - d[~fired].mean()) if fired.any() and (~fired).any() else float("nan")
        ci = bootstrap_delta_ci(d[fired], d[~fired], ev["bootstrap_resamples"], ev["bootstrap_chunk"], cfg["seed"] + 500 + k)
        res.append({**row, "delta": delta, "ci95": ci, "validated": bool(ci[0] > 0), "note": ""})
    return res


def shuffle_control(cfg, L: dict, T: targets.Targets, prof: pd.DataFrame) -> dict:
    sidx = np.searchsorted(prof["customer_key"].to_numpy(), T.sort_keys)
    chosen = L["sort"][sidx]
    rows = np.arange(len(sidx))
    real = float(T.gain[rows, chosen].mean())
    rng = np.random.default_rng(cfg["seed"] + 900)
    perms = np.array([T.gain[rows, rng.permutation(chosen)].mean() for _ in range(cfg["evaluation"]["shuffle_permutations"])])
    return {"real_mean": real, "shuffled_mean": float(perms.mean()),
            "p_value": float((1 + (perms >= real).sum()) / (1 + len(perms))),
            "permutations": int(len(perms))}


def layout_for(cfg, prof: pd.DataFrame, vocab, defaults, disabled) -> dict:
    return rules.run(cfg, prof[feature_order(vocab)], prof[META], vocab, defaults, disabled)


def defaults_for(cfg, cut: str, frozen: dict) -> dict:
    return rules.store_defaults(cfg, read_json(cfg.paths.refs(cut) / "priors.json"), frozen)


def score_cut(con, cfg, cut: str, frozen: dict, vocab: dict, prof: pd.DataFrame, L: dict) -> dict:
    """Score one layout (decision arrays aligned to prof) against the cut's held-out purchases.
    Shared by the rules v1 evaluation and `python -m atelier_data score`."""
    T = targets.build(con, cfg, cut, vocab)
    defaults = defaults_for(cfg, cut, frozen)
    recent = references.recent_popularity(con, cfg, read_json(cfg.paths.reports / "split_manifest.json")[cut]["cutoff"],
                                          cfg.paths.interim / f"units_{cut}.parquet", vocab)
    S = score(cfg, L, T, prof, vocab, defaults, references.load(cfg, cut).priors, recent)
    pk = prof["customer_key"].to_numpy()
    strat = prof["stratum"].to_numpy()[np.searchsorted(pk, T.keys)]
    return {
        "cutoff_name": cut, "config": FULL, "store_defaults": defaults, "recent_popularity": recent,
        "eval_users": {"overall": int(len(T.keys)), "by_stratum": {s: int((strat == s).sum()) for s in STRATA}},
        "sort_eval_users": int(len(T.sort_keys)), "excluded_sort_pairs": T.excluded,
        **summarize(cfg, S),
        "shuffle_control": shuffle_control(cfg, L, T, prof),
        "_T": T,
    }


def evaluate_cut(con, cfg, cut: str, frozen: dict, vocab: dict) -> dict:
    prof = pd.read_parquet(cfg.paths.processed / f"profiles_{cut}_Eall.parquet")
    disabled = frozen.get("disabled_decisions", [])
    L = layout_for(cfg, prof, vocab, defaults_for(cfg, cut, frozen), disabled)
    res = score_cut(con, cfg, cut, frozen, vocab, prof, L)
    T = res.pop("_T")
    return {"cutoff_name": cut, "config": FULL, "rules_label": RULES_LABEL, "disabled_decisions": disabled, **res,
            "targeting": targeting(cfg, L, T, prof, res["store_defaults"]["default_sort"])}


# ---------- scoring external layouts: python -m atelier_data score ----------

class LayoutError(ValueError):
    pass


SCORE_COLUMNS = ["customer_key", "landing_department", "category_order", "section_order", "default_sort",
                 "color_highlight"]


def layouts_to_decisions(cfg, df: pd.DataFrame, prof: pd.DataFrame, vocab: dict) -> dict:
    """Validate a layout file and turn it into decision arrays aligned to prof (sorted by customer_key)."""
    missing_cols = [c for c in SCORE_COLUMNS if c not in df.columns]
    if missing_cols:
        raise LayoutError(f"layout file is missing columns {missing_cols}; required: {SCORE_COLUMNS}")
    keys = df["customer_key"]
    if keys.isna().any():
        raise LayoutError("customer_key has null values")
    dup = keys[keys.duplicated()].unique()
    if len(dup):
        raise LayoutError(f"{len(dup)} customer_key values appear more than once, e.g. {dup[:5].tolist()}")
    want = set(prof["customer_key"].tolist())
    got = set(keys.astype("int64").tolist())
    if want - got:
        miss = sorted(want - got)
        raise LayoutError(f"{len(miss)} cohort shoppers have no layout, e.g. customer_key {miss[:5]}")
    if got - want:
        extra = sorted(got - want)
        raise LayoutError(f"{len(extra)} customer_key values are not in the cohort, e.g. {extra[:5]}")
    df = df.assign(customer_key=keys.astype("int64")).set_index("customer_key").loc[prof["customer_key"]]
    cat, dept, masters = vocab["category_keys"], vocab["department_keys"], vocab["master_colors"]
    secs = rules.sections(cfg)

    def bad(col, mask, allowed):
        if mask.any():
            i = int(np.flatnonzero(mask)[0])
            raise LayoutError(f"{int(mask.sum())} rows have an invalid {col}; first: customer_key "
                              f"{int(df.index[i])} value {df[col].iloc[i]!r}; allowed: {allowed}")

    def perm(col, allowed):
        vals = [list(v) if v is not None else None for v in df[col]]
        bad(col, np.array([v is None or sorted(v) != sorted(allowed) or len(v) != len(allowed) for v in vals]),
            f"a list containing each of {allowed} exactly once")
        return np.array([[allowed.index(x) for x in v] for v in vals])

    bad("landing_department", ~df["landing_department"].isin(dept).to_numpy(), dept)
    bad("default_sort", ~df["default_sort"].isin(SORTS).to_numpy(), SORTS)
    colors = [list(v) if v is not None else None for v in df["color_highlight"]]
    bad("color_highlight", np.array([v is None or any(c not in masters for c in v) or len(set(v)) != len(v)
                                     for v in colors]), "a list of distinct master color names (may be empty)")
    return {"landing": np.array([dept.index(d) for d in df["landing_department"]]),
            "cat_order": perm("category_order", cat), "sec_order": perm("section_order", secs),
            "sort": np.array([SORTS.index(x) for x in df["default_sort"]]),
            "colors": colors, "color_on": np.array([len(v) > 0 for v in colors])}


def score_layouts(cfg, con, layouts_path, cut: str) -> dict:
    if cut not in ("dev", "final"):
        raise LayoutError(f"--cutoff must be dev or final, got {cut!r}")
    vocab = read_json(cfg.paths.processed / "vocabularies.json")
    frozen = load_frozen(cfg)
    prof = pd.read_parquet(cfg.paths.processed / f"profiles_{cut}_Eall.parquet")
    L = layouts_to_decisions(cfg, pd.read_parquet(layouts_path), prof, vocab)
    res = score_cut(con, cfg, cut, frozen, vocab, prof, L)
    res.pop("_T")
    res["config"] = None
    res["layouts"] = str(layouts_path)
    res["targeting"] = None  # needs the rule triggers that produced the layout; only defined for rules v1
    return res


def run(cfg, con, force: bool = False):
    p = cfg.paths
    outs = [p.reports / "eval_dev.json", p.reports / "eval_final.json"]
    if all(o.exists() for o in outs) and not force:
        print("evaluate: outputs exist, skipping (use --force)")
        return
    vocab = read_json(p.processed / "vocabularies.json")
    T_dev = targets.build(con, cfg, "dev", vocab)
    # granularity pre-flight: popularity Hit@3 at product-group level on the dev target
    pop_order = [vocab["category_keys"].index(k) for k in read_json(p.refs("dev") / "priors.json")["category_order"]]
    pop_hit3 = float(hit(T_dev.rel_cat, np.tile(pop_order, (len(T_dev.keys), 1)), 3).mean())
    headline = ["cat_ndcg", "cat_hit1"] if pop_hit3 >= cfg["evaluation"]["ceiling_hit3"] else ["cat_ndcg", "cat_hit3"]
    append_preflight(cfg, "granularity", {"popularity_hit3_dev": pop_hit3, "headline_category_metrics": headline})
    frozen = save_frozen(cfg, {**freeze_from_dev(cfg, T_dev), "headline_category_metrics": headline})
    log = DataLog(p.reports)
    for cut in ("dev", "final"):
        res = evaluate_cut(con, cfg, cut, frozen, vocab)
        write_json(p.reports / f"eval_{cut}.json", res)
        o = res["overall"]
        log.append(f"evaluate:{cut}", note=(f"eval users {res['eval_users']['overall']}, sort-eval {res['sort_eval_users']}; "
                   + "; ".join(f"{d} gain {o[d]['gain']} ci {o[d]['ci95']}" for d in HEADLINE)))
    log.append("evaluate:frozen", decisions=[f"store_default_sort={frozen['store_default_sort']}",
                                             f"default_section_order={frozen['default_section_order']}",
                                             f"headline_category_metrics={headline} (popularity hit3 {pop_hit3:.4f})"])
    print(f"evaluate: S*={frozen['store_default_sort']} sections={frozen['default_section_order']}")
