"""8.11 compress (data only): PCA, MI selection, random subsets and identity for every (E, D, precision),
with saved codes, reconstructions and reconstruction error. No utility-based selection: the model stage
chooses the canonical size."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.feature_selection import mutual_info_classif
from sklearn.preprocessing import StandardScaler

from . import cohort, targets
from .config import read_json, write_json
from .features import COLOR_KEYS, cat_breadth, feature_order
from .log import DataLog

ECDF_FEATURES = ["price_level", "purchase_frequency", "mainstream_score"]
BINARY_PRIORS = {"solid_share": "is_solid", "markdown_affinity": "markdown", "novelty_affinity": "novel",
                 "rebuy_share": "rebuy", "channel_2_share": "channel_2"}


def reference_values(fo: list, vocab: dict, priors: dict, X_fit: np.ndarray) -> np.ndarray:
    """Fill values for unselected features (8.11): block priors, binary priors, 0.5 for ECDF features,
    fit-row median for color_concentration."""
    ref = dict(zip(vocab["category_keys"], priors["category"]))
    ref.update(zip(vocab["department_keys"], priors["department"]))
    ref.update(zip(COLOR_KEYS, priors["color_family"]))
    ref.update({k: priors[v] for k, v in BINARY_PRIORS.items()})
    ref.update({k: 0.5 for k in ECDF_FEATURES})
    ref["color_concentration"] = float(np.median(X_fit[:, fo.index("color_concentration")]))
    return np.array([ref[k] for k in fo])


def blocks(fo: list, vocab: dict) -> list[np.ndarray]:
    return [np.array([fo.index(k) for k in b]) for b in (vocab["category_keys"], vocab["department_keys"], COLOR_KEYS)]


def finish(R: np.ndarray, fo: list, vocab: dict, ref: np.ndarray) -> np.ndarray:
    """Clip to [0, 1]; renormalize each share block to 1 (a zero block takes its priors)."""
    R = np.clip(R, 0, 1)
    for b in blocks(fo, vocab):
        s = R[:, b].sum(axis=1, keepdims=True)
        R[:, b] = np.where(s > 0, R[:, b] / np.where(s > 0, s, 1), ref[b] / ref[b].sum())
    return R


def quantize(Z: np.ndarray, fit: np.ndarray):
    """int8 per code dimension: lo/hi from fit rows; q = clip(round((z-lo)/(hi-lo)*255), 0, 255)."""
    lo, hi = Z[fit].min(axis=0), Z[fit].max(axis=0)
    span = np.where(hi > lo, hi - lo, 1.0)
    q = np.where(hi > lo, np.clip(np.round((Z - lo) / span * 255), 0, 255), 0).astype(np.uint8)
    deq = lo + q / 255.0 * np.where(hi > lo, hi - lo, 0.0)
    return q, deq, lo, hi


def errors(X: np.ndarray, R: np.ndarray, fo: list, vocab: dict, held: np.ndarray) -> dict:
    e = R - X
    cat, dept, col = blocks(fo, vocab)
    rest = np.setdiff1d(np.arange(len(fo)), np.concatenate([cat, dept, col]))
    h = e[held]

    def rmse(a):
        return float(np.sqrt(np.mean(a ** 2)))
    return {"rmse_all": rmse(e), "rmse_heldout": rmse(h), "mae_heldout": float(np.abs(h).mean()),
            "max_abs_heldout": float(np.abs(h).max()),
            "rmse_heldout_by_block": {"category": rmse(h[:, cat]), "department": rmse(h[:, dept]),
                                      "color_family": rmse(h[:, col]), "other": rmse(h[:, rest])},
            "rmse_heldout_by_feature": dict(zip(fo, np.sqrt((h ** 2).mean(axis=0)).round(6).tolist()))}


def mi_ranking(con, cfg, vocab, fo) -> dict:
    """Features ranked by mutual information with the dev target's top category (8.11), computed once."""
    c = cfg["compression"]
    s = read_json(cfg.paths.reports / "split_manifest.json")
    prof = pd.read_parquet(cfg.paths.processed / "profiles_dev_Eall.parquet")
    coh = cohort.load(cfg)[["customer_key", "fit_split", "showcase_hash"]]
    T = targets.build(con, cfg, "dev", vocab)
    y = pd.DataFrame({"customer_key": T.keys, "y": T.rel_cat.argmax(axis=1)})
    d = prof.merge(coh, on="customer_key").merge(y, on="customer_key")
    d = d[d["fit_split"]].sort_values("showcase_hash", kind="stable").head(c["mi_sample"])
    mi = mutual_info_classif(d[fo].to_numpy(), d["y"].to_numpy(), discrete_features=False, random_state=cfg["seed"])
    order = np.argsort(-mi, kind="stable")
    return {"cutoff": s["dev"]["cutoff"], "rows": int(len(d)), "mi": dict(zip(fo, mi.round(6).tolist())),
            "ranking": [fo[i] for i in order]}


def configurations(cfg) -> list[dict]:
    c = cfg["compression"]
    out = []
    for E in c["history_budgets"]:
        for prec in c["precisions"]:
            out.append({"E": E, "D": 25, "compressor": "identity", "precision": prec, "draw": None})
            for D in (d for d in c["dims"] if d < 25):
                out.append({"E": E, "D": D, "compressor": "pca", "precision": prec, "draw": None})
                out.append({"E": E, "D": D, "compressor": "mi", "precision": prec, "draw": None})
                for r in range(c["random_subset_draws"]):
                    out.append({"E": E, "D": D, "compressor": "random", "precision": prec, "draw": r})
    return out


def config_id(k: dict) -> str:
    base = f"E{k['E']}_D{k['D']}_{k['compressor']}_{k['precision']}"
    return base + (f"_r{k['draw']}" if k["draw"] is not None else "")


def encode(k: dict, X: np.ndarray, fit: np.ndarray, fo: list, mi_rank: list, seed: int):
    """Returns (codes before quantization, fitted params)."""
    if k["compressor"] == "identity":
        return X.copy(), {}
    if k["compressor"] == "pca":
        sc = StandardScaler().fit(X[fit])
        pca = PCA(n_components=k["D"], svd_solver="full", random_state=seed).fit(sc.transform(X[fit]))
        params = {"scaler_mean": sc.mean_.tolist(), "scaler_scale": sc.scale_.tolist(),
                  "components": pca.components_.tolist(), "pca_mean": pca.mean_.tolist(),
                  "explained_variance_ratio": pca.explained_variance_ratio_.tolist()}
        return pca.transform(sc.transform(X)), params
    if k["compressor"] == "mi":
        sel = [fo.index(f) for f in mi_rank[:k["D"]]]
    else:
        sel = np.random.default_rng(seed + 1000 * k["D"] + k["draw"]).choice(25, k["D"], replace=False).tolist()
    return X[:, sel], {"selected": [fo[i] for i in sel]}


def decode(params: dict, codes: np.ndarray, fo: list, vocab: dict) -> np.ndarray:
    """Shipped codes + saved compressor -> finished 25-value reconstruction (dequantize, invert, fill, renormalize).
    Used by both `compress` and `reconstruct`, so rebuilt reconstructions are bit-identical."""
    Z = codes.astype(float)
    if params["precision"] == "int8":
        lo, hi = np.array(params["quant_lo"]), np.array(params["quant_hi"])
        Z = lo + Z / 255.0 * np.where(hi > lo, hi - lo, 0.0)
    ref = np.array([params["reference_values"][f] for f in fo])
    if params["compressor"] == "pca":
        R = (Z @ np.array(params["components"]) + np.array(params["pca_mean"])) * np.array(params["scaler_scale"]) \
            + np.array(params["scaler_mean"])
    elif params["compressor"] == "identity":
        R = Z
    else:  # feature selection: keep selected values, fill the rest with reference values
        R = np.tile(ref, (len(Z), 1))
        R[:, [fo.index(f) for f in params["selected"]]] = Z
    return finish(R, fo, vocab, ref)


def reconstruction_frame(keys: np.ndarray, R: np.ndarray, fo: list, vocab: dict) -> pd.DataFrame:
    out = pd.DataFrame(R.astype(np.float32), columns=[f"r_{f}" for f in fo])
    out.insert(0, "customer_key", keys)
    out["r_cat_breadth"] = cat_breadth(R[:, [fo.index(c) for c in vocab["category_keys"]]]).astype(np.float32)
    return out


def run_cut(con, cfg, cut: str, vocab: dict, mi: dict, log: DataLog) -> list[dict]:
    p = cfg.paths
    fo = feature_order(vocab)
    priors = read_json(p.refs(cut) / "priors.json")
    coh = cohort.load(cfg)[["customer_key", "fit_split"]]
    rep_dir, comp_dir = p.processed / "representations" / cut, p.processed / "compressors" / cut
    rec_dir = p.processed / "reconstructions" / cut
    for d in (rep_dir, comp_dir, rec_dir):
        d.mkdir(parents=True, exist_ok=True)
    rows = []
    profs = {}
    for k in configurations(cfg):
        E = k["E"]
        if E not in profs:
            prof = pd.read_parquet(p.processed / f"profiles_{cut}_E{E}.parquet").merge(coh, on="customer_key")
            profs[E] = prof
        prof = profs[E]
        X = prof[fo].to_numpy(dtype=float)
        fit = prof["fit_split"].to_numpy()
        ref = reference_values(fo, vocab, priors, X[fit])
        Z, params = encode(k, X, fit, fo, mi["ranking"], cfg["seed"])
        if k["precision"] == "float32":
            codes = Z.astype(np.float32)
        else:
            codes, _, lo, hi = quantize(Z, fit)
            params.update({"quant_lo": lo.tolist(), "quant_hi": hi.tolist()})
        cid = config_id(k)
        params = {"config": cid, **k, "cutoff": cut, "fit_rows": int(fit.sum()),
                  "reference_values": dict(zip(fo, ref.tolist())), **params}
        write_json(comp_dir / f"{cid}.json", params)
        out = pd.DataFrame(codes, columns=[f"c{i}" for i in range(codes.shape[1])])
        out.insert(0, "customer_key", prof["customer_key"].to_numpy())
        out.to_parquet(rep_dir / f"{cid}.parquet", index=False, compression="zstd")
        R = decode(params, codes, fo, vocab)
        reconstruction_frame(prof["customer_key"].to_numpy(), R, fo, vocab).to_parquet(
            rec_dir / f"{cid}.parquet", index=False, compression="zstd")
        bytes_per = (4 if k["precision"] == "float32" else 1) * k["D"]
        rows.append({"config": cid, **k, "bytes": bytes_per, **errors(X, R, fo, vocab, ~fit),
                     **({"selected": params["selected"]} if "selected" in params else {}),
                     **({"explained_variance": float(np.sum(params["explained_variance_ratio"]))}
                        if "explained_variance_ratio" in params else {})})
    log.append(f"compress:{cut}", note=f"{len(rows)} configurations written to {rep_dir}")
    return rows


def summary(rows: list[dict]) -> list[dict]:
    """Non-random configurations plus one E{E}_D{D}_random_{precision} row (mean and sd over draws)."""
    keep = [{k: v for k, v in r.items() if k not in ("rmse_heldout_by_feature",)} for r in rows if r["compressor"] != "random"]
    df = pd.DataFrame([r for r in rows if r["compressor"] == "random"])
    if len(df):
        for (E, D, prec), g in df.groupby(["E", "D", "precision"], sort=False):
            keep.append({"config": f"E{E}_D{D}_random_{prec}", "E": E, "D": int(D), "compressor": "random",
                         "precision": prec, "draws": int(len(g)), "bytes": int(g["bytes"].iloc[0]),
                         **{m: float(g[m].mean()) for m in ("rmse_all", "rmse_heldout", "mae_heldout", "max_abs_heldout")},
                         **{f"{m}_sd": float(g[m].std(ddof=0)) for m in ("rmse_all", "rmse_heldout")}})
    return keep


def run(cfg, con, force: bool = False):
    p = cfg.paths
    outs = [p.reports / "compression_dev.json", p.reports / "compression_final.json"]
    if all(o.exists() for o in outs) and not force:
        print("compress: outputs exist, skipping (use --force)")
        return
    vocab = read_json(p.processed / "vocabularies.json")
    log = DataLog(p.reports)
    mi = mi_ranking(con, cfg, vocab, feature_order(vocab))
    write_json(p.processed / "compressors" / "mi_selection.json", mi)
    write_json(p.reports / "mi_selection.json", mi)
    for cut in ("dev", "final"):
        rows = run_cut(con, cfg, cut, vocab, mi, log)
        write_json(p.reports / f"compression_{cut}.json", {"cutoff_name": cut, "configurations": rows,
                                                           "summary": summary(rows)})
        print(f"compress[{cut}]: {len(rows)} configurations")


def reconstruct(cfg, con, force: bool = False):
    """Rebuild data/processed/reconstructions/ from committed codes (representations/) and compressors/."""
    p = cfg.paths
    vocab = read_json(p.processed / "vocabularies.json")
    fo = feature_order(vocab)
    n = 0
    for cut in ("dev", "final"):
        rec_dir = p.processed / "reconstructions" / cut
        rec_dir.mkdir(parents=True, exist_ok=True)
        for f in sorted((p.processed / "representations" / cut).glob("*.parquet")):
            out = rec_dir / f.name
            if out.exists() and not force:
                continue
            params = read_json(p.processed / "compressors" / cut / f"{f.stem}.json")
            c = pd.read_parquet(f)
            codes = c[[x for x in c.columns if x != "customer_key"]].to_numpy()
            reconstruction_frame(c["customer_key"].to_numpy(), decode(params, codes, fo, vocab), fo, vocab).to_parquet(
                out, index=False, compression="zstd")
            n += 1
    print(f"reconstruct: {n} reconstruction files written")
