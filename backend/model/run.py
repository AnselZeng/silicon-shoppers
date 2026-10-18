"""Training and scoring for the layout models and the item ranker. Run through the CLI: python -m model --help

run_layouts: trains the layout models for each feature set, tunes the policy margins on dev out-of-fold
predictions, scores dev with the repo's harness, and (with final=True) scores the final window once.
run_items: trains the item ranker on dev buyers (5-fold MAP@12), then (with final=True) ranks tiles for every
shopper at the final cutoff.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from atelier_data import evaluate, references, targets
from atelier_data.config import read_json, write_json
from . import common as C
from . import history, layout

WORK = C.WORK


def feature_sets(cfg) -> dict:
    hist_cols = [c for c in pd.read_parquet(WORK / "history_dev.parquet").columns if c != "customer_key"]
    return {
        "h25": C.H25,
        "h27": C.H25 + C.BRIDGE,
        "f37": C.FUSED37,
        "hist": hist_cols,
        "f37_hist": C.FUSED37 + hist_cols,
        "h27_hist": C.H25 + C.BRIDGE + hist_cols,
        # the repo's compressed profiles (PCA of the 25 H&M values, all history), for the compact-profile claim
        "pca4": [f"pca4_c{i}" for i in range(4)],
        "pca8": [f"pca8_c{i}" for i in range(8)],
    }


def matrix(cfg, cut: str, cols: list[str], keys: np.ndarray, extra: dict | None = None) -> np.ndarray:
    f = C.fused(cfg, cut)
    h = pd.read_parquet(WORK / f"history_{cut}.parquet")
    df = f.merge(h, on="customer_key", how="left")
    for d in (4, 8):
        rp = cfg.paths.processed / "representations" / cut / f"Eall_D{d}_pca_float32.parquet"
        if rp.exists():
            r = pd.read_parquet(rp)
            df = df.merge(r.rename(columns={c: f"pca{d}_{c}" for c in r.columns if c != "customer_key"}),
                          on="customer_key", how="left")
    for name, frame in (extra or {}).items():
        df = df.merge(frame[cut], on="customer_key", how="left")
    assert (df["customer_key"].to_numpy() == keys).all()
    return df[cols].to_numpy(dtype=np.float32)


def ensure_history(cfg, con, vocab, keys, force: bool = False):
    WORK.mkdir(parents=True, exist_ok=True)
    for cut in C.CUTS:
        p = WORK / f"history_{cut}.parquet"
        if force or not p.exists():
            t = time.time()
            history.build(con, cfg, cut, vocab, keys).to_parquet(p)
            print(f"history {cut}: {p} ({time.time() - t:.1f}s)", flush=True)


def build_history(force: bool = True):
    cfg = C.load_cfg(); con = C.connect(cfg); vocab = C.vocab(cfg); co = C.cohort(cfg)
    ensure_history(cfg, con, vocab, co["customer_key"].to_numpy(), force=force)


def prof_for(cfg, cut):
    prof = pd.read_parquet(cfg.paths.processed / f"profiles_{cut}_Eall.parquet")
    return prof.sort_values("customer_key").reset_index(drop=True)


def decision_gains(cfg, L, T, prof, vocab, defaults, priors, recent) -> dict:
    S = evaluate.score(cfg, L, T, prof, vocab, defaults, priors, recent)
    g = {}
    for dec, met in evaluate.HEADLINE.items():
        m = S[met]
        d = m["adapted"] - m["baseline"]
        g[dec] = {"total": float(d.sum()), "mean": float(d.mean()) if len(d) else 0.0, "users": int(len(d)),
                  "changed": int(np.sum(m["changed"]))}
    return g


GRID = {"cat_alpha": [0.0, 0.25, 0.5, 0.75, 1.0],
        "dept_margin": [0.0, 0.02, 0.05, 0.1, 0.2, 0.3, np.inf],
        "sort_margin": [0.0, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12, np.inf],
        "color_margin": [0.0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, np.inf]}
DEC_OF = {"cat_alpha": "category_order", "dept_margin": "landing_department", "sort_margin": "default_sort",
          "color_margin": "color_highlight"}
MIN_COLOR_USERS = 200


def tune(cfg, pred, T, prof, vocab, defaults, priors, recent) -> tuple[dict, dict]:
    """Each knob only affects its own decision, so tune them one at a time on total gain over eval users."""
    policy = {"cat_alpha": 1.0, "dept_margin": 0.0, "sort_margin": 0.0, "color_margin": np.inf}
    trace = {}
    for knob, values in GRID.items():
        best, best_v, rows = -np.inf, policy[knob], []
        for v in values:
            L = layout.to_layout(pred, vocab, cfg, defaults, priors, {**policy, knob: v})
            g = decision_gains(cfg, L, T, prof, vocab, defaults, priors, recent)[DEC_OF[knob]]
            rows.append({"value": None if not np.isfinite(v) else v, **g})
            ok = knob != "color_margin" or g["users"] >= MIN_COLOR_USERS or not np.isfinite(v)
            if ok and g["total"] > best + 1e-12:
                best, best_v = g["total"], v
        policy[knob] = best_v
        trace[knob] = rows
    return policy, trace


def summary(res: dict) -> dict:
    o = res["overall"]
    return {d: {"gain": o[d]["gain"], "ci95": o[d].get("ci95"), "adapted": o[d]["adapted"],
                "baseline": o[d]["baseline"], "changed_users": o[d]["changed_users"]["users"],
                "changed_gain": o[d]["changed_users"]["gain"], "changed_ci95": o[d]["changed_users"]["ci95"],
                "validated": o[d]["changed_users"]["validated"]} for d in evaluate.HEADLINE}


def run_layouts(set_names: list[str], do_final: bool, seed: int, extra_sets: dict | None = None):
    cfg = C.load_cfg(); con = C.connect(cfg); vocab = C.vocab(cfg); co = C.cohort(cfg)
    keys, strata = co["customer_key"].to_numpy(), co["stratum"].to_numpy()
    ensure_history(cfg, con, vocab, keys)
    frozen = evaluate.load_frozen(cfg)
    ctx = {}
    for cut in C.CUTS:
        T = targets.build(con, cfg, cut, vocab)
        cutoff = read_json(cfg.paths.reports / "split_manifest.json")[cut]["cutoff"]
        ctx[cut] = dict(T=T, prof=prof_for(cfg, cut), defaults=C.defaults(cfg, cut),
                        priors=references.load(cfg, cut).priors,
                        recent=references.recent_popularity(con, cfg, cutoff, cfg.paths.interim / f"units_{cut}.parquet",
                                                            vocab))
        assert (ctx[cut]["prof"]["customer_key"].to_numpy() == keys).all()
    lab = layout.labels(ctx["dev"]["T"], keys)
    sets = {**feature_sets(cfg), **(extra_sets or {}).get("cols", {})}
    results = {}
    out_dir = WORK / "layouts"; out_dir.mkdir(parents=True, exist_ok=True)
    for name in set_names:
        t0 = time.time()
        cols = sets[name]
        X = {cut: matrix(cfg, cut, cols, keys, (extra_sets or {}).get("frames")) for cut in C.CUTS}
        tr = layout.train_all(X["dev"], X["final"], lab, strata, len(vocab["master_colors"]), seed)
        d = ctx["dev"]
        policy, trace = tune(cfg, tr["dev"], d["T"], d["prof"], vocab, d["defaults"], d["priors"], d["recent"])
        L_dev = layout.to_layout(tr["dev"], vocab, cfg, d["defaults"], d["priors"], policy)
        res_dev = evaluate.score_cut(con, cfg, "dev", frozen, vocab, d["prof"], L_dev); res_dev.pop("_T")
        entry = {"features": len(cols), "policy": {k: (None if not np.isfinite(v) else v) for k, v in policy.items()},
                 "iters": tr["iters"], "dev": summary(res_dev), "tune_trace": trace}
        np.savez_compressed(WORK / f"pred_{name}.npz", **{f"{c}_{k}": v for c in ("dev", "final")
                                                         for k, v in tr[c].items()})
        if do_final:
            f = ctx["final"]
            pf = tr["final"]  # multiclass deviations are served at the final cutoff's prior inside to_layout
            L_fin = layout.to_layout(pf, vocab, cfg, f["defaults"], f["priors"], policy)
            res_fin = evaluate.score_cut(con, cfg, "final", frozen, vocab, f["prof"], L_fin); res_fin.pop("_T")
            entry["final"] = summary(res_fin)
            layout.layout_records(L_fin, keys, vocab, cfg).to_parquet(out_dir / f"layouts_{name}_final.parquet")
            write_json(out_dir / f"eval_{name}_final.json", res_fin)
        layout.layout_records(L_dev, keys, vocab, cfg).to_parquet(out_dir / f"layouts_{name}_dev.parquet")
        write_json(out_dir / f"eval_{name}_dev.json", res_dev)
        entry["seconds"] = round(time.time() - t0, 1)
        results[name] = entry
        print(f"[{name}] {len(cols)} features, {entry['seconds']}s, policy {entry['policy']}", flush=True)
        for dec, v in entry["dev"].items():
            print(f"   dev  {dec:20s} gain {v['gain']:+.4f} ci {np.round(v['ci95'], 4)}  changed {v['changed_users']}"
                  f" gain {v['changed_gain'] if v['changed_gain'] is None else round(v['changed_gain'], 4)}"
                  f" validated {v['validated']}", flush=True)
        if do_final:
            for dec, v in entry["final"].items():
                print(f"   FINAL {dec:20s} gain {v['gain']:+.4f} ci {np.round(v['ci95'], 4)} validated {v['validated']}",
                      flush=True)
        prev = read_json(WORK / "layout_results.json") if (WORK / "layout_results.json").exists() else {}
        prev[name] = entry
        write_json(WORK / "layout_results.json", prev)
    return results


# ---------- item ranker ----------

def user_frame(cfg, cut: str) -> pd.DataFrame:
    return C.fused(cfg, cut).merge(pd.read_parquet(WORK / f"history_{cut}.parquet"), on="customer_key", how="left")


def run_items(seed: int, do_final: bool, chunk: int = 10000, drop: tuple = (), tag: str = ""):
    from . import items
    cfg = C.load_cfg(); con = C.connect(cfg); vocab = C.vocab(cfg); co = C.cohort(cfg)
    keys, strata = co["customer_key"].to_numpy(), co["stratum"].to_numpy()
    ensure_history(cfg, con, vocab, keys)
    res = {}
    # dev: candidates for dev-window buyers, 5-fold by shopper -> out-of-fold MAP@12
    tg = pd.read_parquet(cfg.paths.interim / "targets_dev.parquet")
    truth = tg.groupby("customer_key")["article_key"].apply(set).to_dict()
    buyers = np.array(sorted(truth))
    info = items.prepare(con, cfg, "dev", vocab)
    df = items.add_user_features(items.candidates(con, info, buyers), user_frame(cfg, "dev"))
    df = items.attach_labels(df, tg)
    cols = [c for c in items.feature_cols(df) if c not in drop]
    folds = C.strat_folds(buyers, strata[np.searchsorted(keys, buyers)], 5, seed)
    fold_of = dict(zip(buyers, folds))
    f = df["customer_key"].map(fold_of).to_numpy()
    has_pos = df.groupby("customer_key")["label"].transform("max").to_numpy() > 0
    oof = np.zeros(len(df)); iters = []
    for k in range(5):
        tr, va = (f != k) & has_pos, f == k
        m = items.fit_ranker(df[tr], cols, seed + k, valid=df[va & has_pos])
        oof[va] = m.predict(df.loc[va, cols])
        iters.append(max(m.best_iteration_ or items.PARAMS["n_estimators"], 20))
    pred = items.topk(df, oof, 12)
    pop = df[df["s_pop"] == 1]
    base = items.topk(pop, -pop["pop_rank"].to_numpy(), 12)
    st = dict(zip(keys, strata))
    res["dev"] = {"buyers": len(buyers), "candidates_per_buyer": len(df) / len(buyers),
                  "pair_recall": float(df["label"].sum() / sum(len(v) for v in truth.values())),
                  "map12_model": items.map_at_k(pred, truth), "map12_popular7d": items.map_at_k(base, truth),
                  "by_stratum": {s: {"model": items.map_at_k(pred, {u: t for u, t in truth.items() if st[u] == s}),
                                     "popular7d": items.map_at_k(base, {u: t for u, t in truth.items() if st[u] == s})}
                                 for s in ["light", "lower_mid", "upper_mid", "heavy"]},
                  "iters": iters}
    print("items dev", json.dumps(res["dev"], indent=1), flush=True)
    n = int(np.mean(iters))
    full = items.fit_ranker(df[has_pos], cols, seed + 99, n_estimators=n)
    imp = pd.Series(full.booster_.feature_importance("gain"), index=cols).sort_values(ascending=False)
    res["importance_top20"] = (imp / imp.sum()).head(20).round(4).to_dict()
    res["features"] = cols
    full.booster_.save_model(str(WORK / f"item_ranker{tag}.txt"))
    del df
    if do_final:
        # apply the dev-trained ranker at the final cutoff to every cohort shopper, in chunks
        info = items.prepare(con, cfg, "final", vocab)
        uf = user_frame(cfg, "final")
        tops = []
        for i in range(0, len(keys), chunk):
            c = items.add_user_features(items.candidates(con, info, keys[i:i + chunk]), uf)
            s = full.predict(c[cols])
            d = c[["customer_key", "article_key", "s_rebuy", "s_variant", "s_pop", "s_seg", "s_copurch", "s_new",
                   "cat_idx"]].assign(score=s)
            d = d.sort_values(["customer_key", "score"], ascending=[True, False]).groupby("customer_key").head(48)
            tops.append(d)
            print(f"  final chunk {i // chunk + 1}/{-(-len(keys) // chunk)}", flush=True)
        tops = pd.concat(tops, ignore_index=True)
        tops.to_parquet(WORK / "item_scores_final.parquet")
        tf = pd.read_parquet(cfg.paths.interim / "targets_final.parquet")
        truth_f = tf.groupby("customer_key")["article_key"].apply(set).to_dict()
        pred_f = tops.groupby("customer_key")["article_key"].apply(lambda s: list(s)[:12]).to_dict()
        art = con.execute("SELECT article_key FROM art2 ORDER BY pop_rank LIMIT 12").df()["article_key"].tolist()
        res["final"] = {"buyers": len(truth_f), "map12_model": items.map_at_k(pred_f, truth_f),
                        "map12_popular7d": items.map_at_k({u: art for u in truth_f}, truth_f)}
        print("items final", res["final"], flush=True)
    write_json(WORK / f"item_results{tag}.json", res)
    return res

