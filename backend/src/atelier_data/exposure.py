"""8.12 exposure audit (final cutoff). The ONLY module that reads customers_audit.parquet (age, postal code).

Data-only scope: uniqueness, temporal linkability, age inference and family ablation on the shipped
representations. No utility axis (fairness and utility frontier are left to the model stage).
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, roc_auc_score
from sklearn.neighbors import NearestNeighbors
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import cohort, compress
from .config import read_json, write_json
from .features import COLOR_KEYS, feature_order
from .log import DataLog

FAMILIES = ["category", "department", "color", "solid", "price_level", "markdown", "novelty", "rebuy", "channel_2",
            "frequency", "mainstream"]


def _audit(cfg) -> str:
    return f"read_parquet('{cfg.paths.ingested / 'customers_audit.parquet'}')"


def source_checks(cfg, con) -> dict:
    """Aggregate age/postal checks for verify (8.2 item 10). Never returns the postal value itself."""
    lo, hi = cfg["exposure"]["age_min"], cfg["exposure"]["age_max"]
    missing, outside = con.execute(f"""
        SELECT count(*) FILTER (WHERE age IS NULL),
               count(*) FILTER (WHERE age IS NOT NULL AND (age < {lo} OR age > {hi}))
        FROM {_audit(cfg)}""").fetchone()
    top = con.execute(f"""
        SELECT count(*) AS n FROM {_audit(cfg)} WHERE postal_code IS NOT NULL
        GROUP BY postal_code ORDER BY n DESC LIMIT 2""").fetchall()
    first = top[0][0] if top else 0
    second = top[1][0] if len(top) > 1 else 0
    return {"age_missing": missing, "age_outside_range": outside,
            "postal_top_count": first, "postal_second_count": second,
            "postal_top_is_placeholder": bool(second and first > 10 * second)}


def age_labels(cfg, con, keys: np.ndarray) -> pd.DataFrame:
    """customer_key -> age band index for cohort customers with age in [age_min, age_max]."""
    ex = cfg["exposure"]
    con.register("age_keys", pd.DataFrame({"customer_key": keys}))
    df = con.execute(f"""SELECT customer_key, age FROM {_audit(cfg)}
                         WHERE customer_key IN (SELECT customer_key FROM age_keys)
                           AND age BETWEEN {ex['age_min']} AND {ex['age_max']}""").df()
    band = np.full(len(df), -1)
    for i, (_, lo, hi) in enumerate(ex["age_bands"]):
        band[(df["age"] >= lo) & (df["age"] <= hi)] = i
    return pd.DataFrame({"customer_key": df["customer_key"], "band": band})[band >= 0]


def uniqueness(codes: np.ndarray, decimals: int) -> dict:
    x = np.round(codes.astype(float), decimals) if codes.dtype != np.uint8 else codes
    _, inv, counts = np.unique(x, axis=0, return_inverse=True, return_counts=True)
    size = counts[inv.ravel()]
    return {"unique_share": float((size == 1).mean()), "class_lt5_share": float((size < 5).mean()),
            "class_lt10_share": float((size < 10).mean())}


def attack(cfg, Xtr, ytr, Xte, yte, n_bands: int) -> dict:
    """Macro one-vs-rest AUC and macro-F1 for LR and HGB; headline is the higher AUC."""
    ex = cfg["exposure"]
    present = [b for b in range(n_bands) if (yte == b).any() and (yte != b).any()]
    out = {"skipped_classes_no_test_positives": [b for b in range(n_bands) if b not in present]}
    models = {"lr": make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)),
              "hgb": HistGradientBoostingClassifier(max_iter=ex["hgb_max_iter"], early_stopping=True,
                                                    random_state=cfg["seed"])}
    for name, m in models.items():
        m.fit(Xtr, ytr)
        proba = m.predict_proba(Xte)
        cls = list(m.classes_)
        aucs = [roc_auc_score(yte == b, proba[:, cls.index(b)]) for b in present if b in cls]
        out[name] = {"auc": float(np.mean(aucs)), "macro_f1": float(f1_score(yte, m.predict(Xte), average="macro"))}
    best = max(("lr", "hgb"), key=lambda k: out[k]["auc"])
    maj = np.bincount(ytr).argmax()
    out.update({"age_auc": out[best]["auc"], "age_auc_attacker": best, "age_macro_f1": out[best]["macro_f1"],
                "majority_auc": 0.5, "majority_f1": float(f1_score(yte, np.full(len(yte), maj), average="macro"))})
    return out


def encode_with(params: dict, k: dict, X: np.ndarray, fo: list) -> np.ndarray:
    """Apply a saved compressor (and its quantization) to new rows, giving codes as shipped."""
    if k["compressor"] == "pca":
        Z = ((X - np.array(params["scaler_mean"])) / np.array(params["scaler_scale"]) - np.array(params["pca_mean"])) \
            @ np.array(params["components"]).T
    elif k["compressor"] == "identity":
        Z = X
    else:
        Z = X[:, [fo.index(f) for f in params["selected"]]]
    if k["precision"] == "int8":
        lo, hi = np.array(params["quant_lo"]), np.array(params["quant_hi"])
        span = np.where(hi > lo, hi - lo, 1.0)
        return np.where(hi > lo, np.clip(np.round((Z - lo) / span * 255), 0, 255), 0).astype(np.uint8)
    return Z.astype(np.float32)


def linkability(cfg, k: dict, params: dict, early: np.ndarray, late: np.ndarray, fo: list) -> dict:
    a = encode_with(params, k, early, fo).astype(float)
    b = encode_with(params, k, late, fo).astype(float)
    n = len(a)
    nn = NearestNeighbors(n_neighbors=min(10, n)).fit(b)
    idx = nn.kneighbors(a, return_distance=False)
    truth = np.arange(n)[:, None]
    return {"link_users": n, "link_top1": float((idx[:, 0] == truth[:, 0]).mean()),
            "link_top10": float((idx == truth).any(axis=1).mean()), "chance_top1": 1 / n, "chance_top10": min(10, n) / n}


def family_columns(fo: list, vocab: dict) -> dict:
    fam = {"category": vocab["category_keys"], "department": vocab["department_keys"],
           "color": COLOR_KEYS + ["color_concentration"], "solid": ["solid_share"], "price_level": ["price_level"],
           "markdown": ["markdown_affinity"], "novelty": ["novelty_affinity"], "rebuy": ["rebuy_share"],
           "channel_2": ["channel_2_share"], "frequency": ["purchase_frequency"], "mainstream": ["mainstream_score"]}
    return {f: [fo.index(c) for c in cols] for f, cols in fam.items()}


def ablate(X: np.ndarray, cols: list, ref: np.ndarray, fo: list, vocab: dict) -> np.ndarray:
    Xa = X.copy()
    Xa[:, cols] = ref[cols]
    return compress.finish(Xa, fo, vocab, ref)


def run(cfg, con, force: bool = False):
    p = cfg.paths
    out = p.reports / "exposure_report.json"
    if out.exists() and not force:
        print("audit: outputs exist, skipping (use --force)")
        return
    ex = cfg["exposure"]
    vocab = read_json(p.processed / "vocabularies.json")
    fo = feature_order(vocab)
    coh = cohort.load(cfg)[["customer_key", "attack_split", "showcase_hash"]]
    labels = age_labels(cfg, con, coh["customer_key"].to_numpy())
    lab = coh.merge(labels, on="customer_key")
    nb = len(ex["age_bands"])
    band_names = [b[0] for b in ex["age_bands"]]

    # halves for linkability: first linkability_sample eligible cohort customers in showcase-hash order
    h = pd.read_parquet(p.processed / "halves_final.parquet").merge(coh[["customer_key", "showcase_hash"]], on="customer_key")
    link_keys = (h[["customer_key", "showcase_hash"]].drop_duplicates().sort_values("showcase_hash", kind="stable")
                 .head(ex["linkability_sample"])["customer_key"].to_numpy())
    link_keys = np.sort(link_keys)
    early = h[(h["half"] == "early") & h["customer_key"].isin(link_keys)].sort_values("customer_key")[fo].to_numpy()
    late = h[(h["half"] == "late") & h["customer_key"].isin(link_keys)].sort_values("customer_key")[fo].to_numpy()

    rows = []
    rep = p.processed / "representations" / "final"
    for k in compress.configurations(cfg):
        cid = compress.config_id(k)
        r = pd.read_parquet(rep / f"{cid}.parquet")
        codes = r[[c for c in r.columns if c.startswith("c") and c[1:].isdigit()]].to_numpy()
        row = {"config": cid, **k, "bytes": (4 if k["precision"] == "float32" else 1) * k["D"],
               **uniqueness(codes, ex["uniqueness_round_decimals"])}
        d = r[["customer_key"]].assign(i=np.arange(len(r))).merge(lab, on="customer_key")
        tr, te = d[d["attack_split"] == "A"], d[d["attack_split"] == "B"]
        row.update(attack(cfg, codes[tr["i"]].astype(float), tr["band"].to_numpy(),
                          codes[te["i"]].astype(float), te["band"].to_numpy(), nb))
        if k["E"] == "all":
            params = read_json(p.processed / "compressors" / "final" / f"{cid}.json")
            row.update(linkability(cfg, k, params, early, late, fo))
        rows.append(row)
        print(f"audit: {cid} auc={row['age_auc']:.4f} unique={row['unique_share']:.3f}", flush=True)

    # family ablation on the full configuration with the HGB attacker
    prof = pd.read_parquet(p.processed / "profiles_final_Eall.parquet")
    priors = read_json(p.refs("final") / "priors.json")
    fit = prof.merge(cohort.load(cfg)[["customer_key", "fit_split"]], on="customer_key")["fit_split"].to_numpy()
    X = prof[fo].to_numpy(dtype=float)
    ref = compress.reference_values(fo, vocab, priors, X[fit])
    d = prof[["customer_key"]].assign(i=np.arange(len(prof))).merge(lab, on="customer_key")
    tr, te = d[d["attack_split"] == "A"], d[d["attack_split"] == "B"]

    def hgb_auc(M):
        return attack(cfg, M[tr["i"]], tr["band"].to_numpy(), M[te["i"]], te["band"].to_numpy(), nb)["hgb"]["auc"]
    full_auc = hgb_auc(X)
    fams = family_columns(fo, vocab)
    drop = {f: full_auc - hgb_auc(ablate(X, cols, ref, fo, vocab)) for f, cols in fams.items()}
    dropped = sorted(drop, key=lambda f: -drop[f])[:2]
    Xa = ablate(X, [c for f in dropped for c in fams[f]], ref, fo, vocab)
    ablated = {"config": "ablated", "dropped": dropped,
               **attack(cfg, Xa[tr["i"]], tr["band"].to_numpy(), Xa[te["i"]], te["band"].to_numpy(), nb),
               **uniqueness(Xa.astype(np.float32), ex["uniqueness_round_decimals"])}
    keep_cols = [i for i in range(len(fo)) if i not in [c for f in dropped for c in fams[f]]]
    ablated.update(linkability(cfg, {"compressor": "identity", "precision": "float32"}, {},
                               ablate(early, [c for f in dropped for c in fams[f]], ref, fo, vocab),
                               ablate(late, [c for f in dropped for c in fams[f]], ref, fo, vocab), fo))
    ablated["kept_features"] = [fo[i] for i in keep_cols]

    df = pd.DataFrame(rows)
    summary = [r for r in rows if r["compressor"] != "random"]
    metrics = ["unique_share", "class_lt5_share", "class_lt10_share", "age_auc", "age_macro_f1", "link_top1", "link_top10"]
    for (E, D, prec), g in df[df["compressor"] == "random"].groupby(["E", "D", "precision"], sort=False):
        s = {"config": f"E{E}_D{D}_random_{prec}", "E": E, "D": int(D), "compressor": "random", "precision": prec,
             "draws": int(len(g)), "bytes": int(g["bytes"].iloc[0])}
        for m_ in metrics:
            if m_ in g and g[m_].notna().any():
                s[m_], s[f"{m_}_sd"] = float(g[m_].mean()), float(g[m_].std(ddof=0))
        summary.append(s)
    frontier = [{k_: r.get(k_) for k_ in ("config", "E", "D", "compressor", "precision", "bytes", "age_auc",
                                          "link_top1", "unique_share")} for r in summary]
    frontier.append({"config": "ablated", "bytes": 4 * len(keep_cols), "age_auc": ablated["age_auc"],
                     "link_top1": ablated["link_top1"], "unique_share": ablated["unique_share"]})
    full = next(r for r in rows if r["config"] == "Eall_D25_identity_float32")
    report = {
        "cutoff_name": "final", "age_bands": band_names, "labeled_users": int(len(lab)),
        "train_users_A": int((lab["attack_split"] == "A").sum()), "test_users_B": int((lab["attack_split"] == "B").sum()),
        "band_counts": {band_names[b]: int((lab["band"] == b).sum()) for b in range(nb)},
        "linkability_users": int(len(link_keys)),
        "configurations": rows, "summary": summary,
        "ablation": {"attacker": "hgb", "full_auc": full_auc, "family_auc_drop": drop, "dropped": dropped, "ablated": ablated},
        "frontier": frontier,
        "note": "Data-only audit: no utility axis. Lower exposure may only be claimed at matched utility, which the "
                "model stage measures.",
        "results_json": {
            "full": {"age_auc": full["age_auc"], "age_auc_attacker": full["age_auc_attacker"],
                     "age_macro_f1": full["age_macro_f1"], "majority_f1": full["majority_f1"],
                     "link_top1": full["link_top1"], "chance_top1": full["chance_top1"],
                     "unique_share": full["unique_share"]},
            "canonical": {},
            "ablation": {"family_auc_drop": drop, "dropped": dropped,
                         "ablated": {m_: ablated.get(m_) for m_ in ("age_auc", "link_top1", "unique_share")}},
            "frontier": frontier},
    }
    write_json(out, report)
    DataLog(p.reports).append("audit", note=(f"{len(rows)} configurations; full AUC {full['age_auc']:.4f} "
                                             f"({full['age_auc_attacker']}), link top1 {full['link_top1']:.4f}, "
                                             f"unique {full['unique_share']:.4f}; ablation dropped {dropped}"))
    print(f"audit: full AUC {full['age_auc']:.4f}, link top-1 {full['link_top1']:.4f}, dropped {dropped}")
