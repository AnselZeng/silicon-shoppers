"""8.15 export: showcase map, layouts, shoppers.json, catalog.json, results.json."""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from . import catalog, cohort, evaluate, rules, showcase, splits
from .config import read_json, write_json
from .features import feature_order
from .log import DataLog

TESTED = ["landing_department", "category_order", "section_order", "color_highlight", "default_sort"]
DEFAULT_KEYS = ["landing_department", "category_order", "section_order", "default_sort", "hero", "grid_columns",
                "filter_order", "popups"]
BROWSING_NOTE = "Browsing track deferred; browsing-controlled decisions use store defaults."


def feature_labels(cfg, vocab) -> dict:
    labels = dict(zip(vocab["category_keys"], vocab["category_names"]))
    labels.update(zip(vocab["department_keys"], vocab["department_names"]))
    fl = cfg.rules["feature_labels"]
    for k in feature_order(vocab):
        if k not in labels:
            labels[k] = fl.get(k, k.replace("_", " ").capitalize())
    return labels


def validated_flags(ev: dict, disabled) -> dict:
    """A tested decision is validated only if the users whose layout it changed did better than the store
    default (95% CI of the mean difference above 0, final cutoff). The targeting test does not set it."""
    return {d: (None if d in disabled else ev["overall"][d]["changed_users"]["validated"]) for d in TESTED}


def claims(res: dict) -> list[dict]:
    h = res["headline"]

    def ci_claim(text, dec, ev):
        lo = h[dec]["ci95"][0]
        return {"claim": text, "status": "supported" if lo is not None and lo > 0 else "not_supported",
                "evidence": f"{ev}.ci95 lower bound = {lo}"}

    sort_lo = h["default_sort"]["ci95"][0]
    any_valid = any(t["validated"] for t in h["targeting"])
    if sort_lo is not None and sort_lo > 0 and any_valid:
        sort_status = "supported"
    else:
        sort_status = "open"
    compact = {"status": "open", "evidence": "data-only build: the model stage chooses the canonical size"}
    return [
        ci_claim("Adapted category order beats popularity order", "category_order", "category_order"),
        ci_claim("Adapted landing department beats the most popular department", "landing_department", "landing_department"),
        ci_claim("Adapted section order beats the best fixed order", "section_order", "section_order"),
        {"claim": "Targeted default sort beats the best single sort", "status": sort_status,
         "evidence": f"default_sort.ci95 lower bound = {sort_lo}; targeting rules validated: {any_valid}"},
        {"claim": "A compact profile keeps 95% of the full profile's gain", **compact},
        {"claim": "The compact profile is harder to link or to infer age from at matched utility", "status": "open",
         "evidence": "exposure audit compares against random-subset controls; never stronger than 'open' without that"},
        {"claim": "Pop-ups respect consent", "status": "supported", "evidence": "pop-ups on only for newsletter subscribers"},
        {"claim": "Hero, grid and filter choices suit the shopper", "status": "open", "evidence": "assumed rules, untested"},
        {"claim": "Browsing style is personalized", "status": "not_supported", "evidence": BROWSING_NOTE},
        {"claim": "The profile is anonymous or private", "status": "never_claim", "evidence": "never claimed"},
    ]


def run(cfg, con, force: bool = False):
    p = cfg.paths
    outs = [p.frontend / f for f in ("shoppers.json", "catalog.json", "results.json")]
    if all(o.exists() for o in outs) and not force:
        print("export: outputs exist, skipping (use --force)")
        return
    s = splits.load(cfg)
    vocab = read_json(p.processed / "vocabularies.json")
    frozen = evaluate.load_frozen(cfg)
    disabled = frozen.get("disabled_decisions", [])
    ev = read_json(p.reports / "eval_final.json")
    coh = cohort.load(cfg)
    prof = pd.read_parquet(p.processed / "profiles_final_Eall.parquet")
    fo = feature_order(vocab)
    defaults = evaluate.defaults_for(cfg, "final", frozen)
    L = evaluate.layout_for(cfg, prof, vocab, defaults, disabled)
    vals = [rules.values(L, i, vocab, cfg) for i in range(len(prof))]
    pd.DataFrame({"customer_key": prof["customer_key"], "config": evaluate.FULL, "rules": evaluate.RULES_LABEL,
                  "layout": [json.dumps(v) for v in vals]}).to_parquet(p.processed / "layouts_final.parquet", index=False)

    sm = showcase.select(cfg, prof, coh, fo, L, vocab, defaults)
    sm[["shopper_id", "customer_key"]].to_parquet(p.processed / "showcase_map.parquet", index=False)

    validated = validated_flags(ev, disabled)
    row_of = dict(zip(prof["customer_key"], range(len(prof))))
    shoppers = []
    for r in sm.itertuples(index=False):
        i = row_of[r.customer_key]
        pr = prof.iloc[i]
        shoppers.append({
            "id": r.shopper_id, "stratum": r.stratum,
            "profile": {k: round(float(pr[k]), 2) for k in fo},
            "evidence": {"units": int(pr["units_used"]), "shopping_days": int(pr["shopping_days"]),
                         "history_days": int(pr["history_days"]), "days_since_last": int(pr["days_since_last"]),
                         "confidence": pr["confidence"], "top_colors": list(pr["top_colors"]),
                         "top_groups": list(pr["top_groups"])},
            "consent": {"newsletter": pr["newsletter"]},
            "browsing": {"source": "deferred", "values": None, "grades": None},
            "adapted": rules.differs(vals[i], defaults),
            "layout": rules.render(L, i, pr, vocab, cfg, defaults, validated),
            "variants": {},
        })
    write_json(p.frontend / "shoppers.json", {
        "dataset_version": cfg["dataset_version"], "schema_version": cfg["schema_version"],
        "cutoff": s["final"]["cutoff"], "feature_order": fo, "feature_labels": feature_labels(cfg, vocab),
        "store_defaults": {k: defaults[k] for k in DEFAULT_KEYS}, "canonical_config": None,
        "rules_label": evaluate.RULES_LABEL, "browsing_note": BROWSING_NOTE, "shoppers": shoppers})

    arts = catalog.build(con, cfg, s["final"]["cutoff"], p.refs("final"), vocab)
    write_json(p.frontend / "catalog.json", {"dataset_version": cfg["dataset_version"],
                                             "cutoff": s["final"]["cutoff"], "articles": arts})

    headline = {"label": evaluate.RULES_LABEL, **ev["overall"], "targeting": ev["targeting"],
                "shuffle_control": ev["shuffle_control"]}
    comp = p.reports / "compression_final.json"
    curve = read_json(comp)["summary"] if comp.exists() else []
    expo = p.reports / "exposure_report.json"
    exposure = read_json(expo)["results_json"] if expo.exists() else {
        "full": {}, "canonical": {}, "ablation": {"family_auc_drop": {}, "dropped": [], "ablated": {}}, "frontier": []}
    rel = p.reports / "reliability.json"
    mdp = p.reports / "markdown_proxy.json"
    res = {
        "dataset_version": cfg["dataset_version"],
        "cutoffs": {"dev": s["dev"]["cutoff"], "final": s["final"]["cutoff"]},
        "cohort_size": int(len(coh)),
        "eval_users": ev["eval_users"], "sort_eval_users": ev["sort_eval_users"],
        "excluded_sort_pairs": {k: ev["excluded_sort_pairs"][k] for k in ("outside_assortment", "single_article_type")},
        "rules_label": evaluate.RULES_LABEL,
        "canonical_config": None,
        "compression_declared_successful": None,
        "store_defaults": {"default_sort": defaults["default_sort"], "section_order": defaults["section_order"]},
        "baselines": ev["baselines"],
        "headline": headline, "canonical": {},
        "per_stratum": ev["per_stratum"], "population_weighted": ev["population_weighted"],
        "compression_curve": curve,
        "exposure": exposure,
        "validity": {"reliability_disabled": disabled,
                     "reliability": read_json(rel)["features"] if rel.exists() else None,
                     "markdown_peak_to_trough": read_json(mdp)["peak_to_trough"] if mdp.exists() else None},
    }
    res["claims"] = claims(res)
    write_json(p.frontend / "results.json", res)

    adapted = np.array([rules.differs(v, defaults) for v in vals])
    by = {st: float(adapted[prof["stratum"].to_numpy() == st].mean()) for st in evaluate.STRATA}
    DataLog(p.reports).append("export", note=(f"{len(shoppers)} shoppers, {len(arts)} catalog articles; "
                                              f"cohort share with layout != store defaults: {by}"))
    figures(cfg)
    data_card(cfg)
    print(f"export: {len(shoppers)} shoppers, {len(arts)} articles")


# ---------- figures (8.15) ----------

MARKERS = {"identity": "s", "pca": "o", "mi": "^", "random": "x"}


def figures(cfg):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    p = cfg.paths
    p.figures.mkdir(parents=True, exist_ok=True)
    size = {"figsize": (16, 10), "dpi": 100}

    comp = p.reports / "compression_final.json"
    if comp.exists():
        df = pd.DataFrame(read_json(comp)["summary"])
        df["E"] = df["E"].astype(str)
        fig, ax = plt.subplots(**size)
        for E, g in df.groupby("E", sort=False):
            best = g.groupby("bytes")["rmse_heldout"].min().sort_index().cummin()  # best at or below each size
            line, = ax.step(best.index, best.values, where="post", lw=1.8, label=f"E = {E} (best at or below size)")
            for comp_, gg in g.groupby("compressor"):
                ax.scatter(gg["bytes"], gg["rmse_heldout"], marker=MARKERS[comp_], s=70, color=line.get_color())
        for comp_, mk in MARKERS.items():
            ax.scatter([], [], marker=mk, color="grey", label=comp_)
        ax.set_xscale("log")
        ax.set_xlabel("bytes per profile (log scale)", fontsize=14)
        ax.set_ylabel("held-out reconstruction RMSE (feature units, 0-1)", fontsize=14)
        ax.set_title("Reconstruction error by representation size, final cutoff (random = mean of draws)", fontsize=16)
        ax.legend(fontsize=12)
        ax.grid(alpha=0.3)
        fig.savefig(p.figures / "compression_curve.png")
        plt.close(fig)

    expo = p.reports / "exposure_report.json"
    if expo.exists():
        r = read_json(expo)
        df = pd.DataFrame(r["summary"])
        fig, axes = plt.subplots(1, 2, **size)
        for ax, metric, chance, ylab in ((axes[0], "age_auc", 0.5, "headline age-band AUC (macro one-vs-rest)"),
                                         (axes[1], "link_top1", None, "temporal linkability, top-1 accuracy (E = all)")):
            for comp_, g in df.groupby("compressor"):
                g = g[g[metric].notna()] if metric in g else g.iloc[0:0]
                ax.scatter(g["bytes"], g[metric], marker=MARKERS[comp_], s=80, label=comp_)
                if comp_ == "random":
                    for _, row in g[g["E"].astype(str) == "all"].iterrows():
                        ax.annotate(row["config"], (row["bytes"], row[metric]), fontsize=8, alpha=0.7)
            ab = r["ablation"]["ablated"]
            if ab.get(metric) is not None:
                ax.scatter([4 * len(ab["kept_features"])], [ab[metric]], marker="*", s=250, color="black", label="ablated")
                ax.annotate("ablated: no " + " + ".join(ab["dropped"]), (4 * len(ab["kept_features"]), ab[metric]), fontsize=10)
            if chance is not None:
                ax.axhline(chance, color="grey", ls="--", lw=1, label="chance")
            elif "chance_top1" in r["results_json"]["full"]:
                ax.axhline(r["results_json"]["full"]["chance_top1"], color="grey", ls="--", lw=1, label="chance")
            ax.set_xscale("log")
            ax.set_xlabel("bytes per profile (log scale)", fontsize=14)
            ax.set_ylabel(ylab, fontsize=14)
            ax.grid(alpha=0.3)
            ax.legend(fontsize=11)
        fig.suptitle("Exposure by representation size, final cutoff (no utility axis in this data-only build)", fontsize=16)
        fig.savefig(p.figures / "exposure_frontier.png")
        plt.close(fig)

    ev = p.reports / "eval_final.json"
    if ev.exists():
        t = [x for x in read_json(ev)["targeting"]]
        fig, ax = plt.subplots(**size)
        y = np.arange(len(t))
        delta = np.array([x["delta"] for x in t])
        lo = delta - np.array([x["ci95"][0] for x in t])
        hi = np.array([x["ci95"][1] for x in t]) - delta
        ax.errorbar(delta, y, xerr=[lo, hi], fmt="o", capsize=8, ms=10)
        ax.axvline(0, color="grey", lw=1)
        ax.set_yticks(y, [x["rule"] + (" (not testable)" if x["note"] else "") for x in t], fontsize=13)
        ax.set_xlabel("targeting delta: fired minus non-fired users, mean sort-position gain vs store default (95% CI)",
                      fontsize=13)
        ax.set_title(f"Sort targeting test, final cutoff ({evaluate.RULES_LABEL})", fontsize=16)
        ax.grid(alpha=0.3)
        fig.savefig(p.figures / "sort_targeting.png")
        plt.close(fig)


# ---------- data card (11.4) ----------

RESERVED_CUTOFF = "2019-08-26"


def _f(x, nd=4):
    return "n/a" if x is None else f"{x:.{nd}f}"


def _ci(b):
    c = b.get("ci95") or [None, None]
    return f"[{_f(c[0])}, {_f(c[1])}]"


def data_card(cfg):
    p = cfg.paths
    R = p.reports
    s = read_json(R / "split_manifest.json")
    pf = read_json(R / "preflight.json")
    ch = pf["channels"]
    coh = cohort.load(cfg)
    per = cfg["cohort"]["per_stratum"]
    st = pf["strata"]
    lines = [
        "# ATELIER NINE Compact Shopper Profile Dataset, v1 (frozen 2026-10-04)", "",
        "## Source and license",
        "H&M Personalized Fashion Recommendations (Kaggle). Non-commercial academic use; no redistribution of",
        "competition data. This build releases only aggregate reports; row-level files are private.", "",
        "## Scope of this release",
        "Data preparation only: profiles, splits, cohort, held-out targets, references, catalog, compressed",
        "representations and an exposure audit, plus a scoring harness (targets, metrics, baselines). Layout rules",
        f"are shipped only as **{evaluate.RULES_LABEL}**; choosing a canonical representation size is left to the",
        "model stage. Pipeline reference: `docs/PIPELINE.md`.", "",
        "## Cohort",
        f"{len(coh):,} customers, {per:,} per history stratum (light 1–2, lower-mid 3–5, upper-mid 6–10, heavy 11+ units",
        f"before {s['dev']['cutoff']}); selected by salted hash; inclusion weights stored. Eligible customers per stratum:",
        ", ".join(f"{k} {v:,}" for k, v in st["eligible"].items()) + ".", "",
        "## Time splits",
        f"Profiles before {s['dev']['cutoff']} (development) and {s['final']['cutoff']} (final). Development target "
        f"[{s['dev']['target'][0]}, {s['dev']['target'][1]}); final target [{s['final']['target'][0]}, {s['final']['target'][1]}).",
        f"**Reserved:** cutoff {RESERVED_CUTOFF} (target window [{RESERVED_CUTOFF}, 2019-09-23)) is reserved, untouched, for",
        "the model's final test. No cohort, reference, profile, target or score has been built for it.", "",
        "## Profile",
        "25 values (listed with formulas in `docs/PIPELINE.md`). Channel 2 means "
        + (f"online (store channel {ch['store_channel_id']} collapsed in April 2020: ratio "
           f"{ch['ratios'][str(ch['store_channel_id'])]:.2f} vs {ch['ratios'][str(ch['online_channel_id'])]:.2f})."
           if ch["channel_status"] == "verified_by_2020_closure_pattern" else "unverified."),
        f"Unmapped colors: {', '.join(pf['colors']['unmapped']) or 'none'}. Markdown = unit price ≤ "
        f"{cfg['features']['markdown_ratio']:.2f} × the article's {cfg['features']['anchor_quantile']:.2f}-quantile anchor "
        "(threshold chosen outcome-blind from the seasonal markdown scan; see DATA_LOG.md).",
    ]
    rel = R / "reliability.json"
    if rel.exists():
        r = read_json(rel)
        lines += ["", f"Reliability (Spearman, early vs late half of each history, dev cutoff, {r['customers']:,} customers):",
                  "blocks " + ", ".join(f"{k} {v:.2f}" for k, v in r["blocks"].items()) + "; lowest features "
                  + ", ".join(f"{k} {v:.2f}" for k, v in sorted(r["features"].items(), key=lambda kv: kv[1])[:5]) + ".",
                  f"Decisions whose owning features fall below {r['min_spearman']}: {', '.join(r['decisions_below_threshold']) or 'none'}"
                  " (reported only; the rules v1 baseline was not re-run with them disabled)."]
    mdp = R / "markdown_proxy.json"
    if mdp.exists():
        m = read_json(mdp)
        sp = m["spearman"]["anchor_q0.90"]
        lines += [f"Markdown proxy (final cutoff): monthly markdown share peak-to-trough {m['peak_to_trough']:.2f} "
                  f"(peak {m['season']['peak']}, trough {m['season']['trough']}); Spearman of markdown_affinity vs the "
                  "0.90 anchor: " + ", ".join(f"{k.replace('anchor_', '')} {v:.2f}" for k, v in sp.items() if k != "anchor_q0.90") + "."]
    comp = R / "compression_final.json"
    if comp.exists():
        rows = [x for x in read_json(comp)["summary"] if str(x["E"]) == "all"]
        lines += ["", "## Representations",
                  "Every (history E ∈ {1, 3, 10, all}) × (size D ∈ {4, 8, 25}) × (precision float32/int8) for PCA, "
                  "mutual-information selection and random subsets (identity at D = 25), with codes and reconstructions "
                  "saved per configuration. Held-out reconstruction error, final cutoff, E = all:", "",
                  "| Configuration | Bytes | Held-out RMSE | Held-out MAE |", "| --- | --- | --- | --- |"]
        lines += [f"| {x['config']} | {x['bytes']} | {x['rmse_heldout']:.4f} | {x['mae_heldout']:.4f} |"
                  for x in sorted(rows, key=lambda x: (x["bytes"], x["config"]))]
    ev = R / "eval_final.json"
    if ev.exists():
        e = read_json(ev)
        o = e["overall"]
        lines += ["", f"## Scoring harness results ({evaluate.RULES_LABEL}, final window)",
                  f"{e['eval_users']['overall']:,} eval users; {e['sort_eval_users']:,} sort-eval users. Gains are paired per-user "
                  "differences with 95% bootstrap CIs. 'Validated' = users whose layout the decision changed did better "
                  "than the store default (CI above 0).", "",
                  "| Decision | Metric | Adapted | Store default | Gain (95% CI) | vs recent popularity | Changed users | Validated |",
                  "| --- | --- | --- | --- | --- | --- | --- | --- |"]
        for d, b in o.items():
            vr = b.get("vs_recent_popularity")
            vr_txt = f"{_f(vr['gain'])} {_ci(vr)}" if vr else "—"
            c = b["changed_users"]
            lines.append(f"| {d} | {b['metric']} | {_f(b['adapted'])} | {_f(b['baseline'])} | {_f(b['gain'])} {_ci(b)} | "
                         f"{vr_txt} | {c['users']:,} | {'yes' if c['validated'] else 'no'} |")
        bl = e["baselines"]
        lines += ["", f"Baselines alone: all-time popularity cat_ndcg {bl['popularity_all_time']['cat_ndcg']:.4f}, "
                  f"recent ({bl['popularity_recent']['window_days']}-day) popularity {bl['popularity_recent']['cat_ndcg']:.4f}."]
    expo = R / "exposure_report.json"
    if expo.exists():
        x = read_json(expo)
        rows = [r for r in x["summary"] if str(r["E"]) == "all"]
        lines += ["", "## Exposure",
                  f"Attacker trains on split A ({x['train_users_A']:,}) and tests on split B ({x['test_users_B']:,}); "
                  f"age bands {', '.join(x['age_bands'])}. Chance AUC 0.5; linkability over {x['linkability_users']:,} "
                  "early/late half pairs (chance top-1 = 1/n). Representations as shipped (float32 codes rounded to 2 "
                  "decimals for uniqueness; uint8 codes as is). No utility axis in this build.", "",
                  "| Configuration | Bytes | Unique share | Age AUC (attacker) | Majority macro-F1 / attacker macro-F1 | Link top-1 (chance) |",
                  "| --- | --- | --- | --- | --- | --- |"]
        full = x["results_json"]["full"]  # same labels, test split and link sample for every configuration
        for r in sorted(rows, key=lambda r: (r["bytes"], r["config"])):
            r = {**r, "majority_f1": r.get("majority_f1", full["majority_f1"]),
                 "chance_top1": r.get("chance_top1", full["chance_top1"])}
            lines.append(f"| {r['config']} | {r['bytes']} | {_f(r.get('unique_share'), 3)} | {_f(r.get('age_auc'))} "
                         f"({r.get('age_auc_attacker', 'mean of draws')}) | {_f(r.get('majority_f1'), 3)} / {_f(r.get('age_macro_f1'), 3)} | "
                         f"{_f(r.get('link_top1'))} ({_f(r.get('chance_top1'), 5)}) |")
        ab = x["ablation"]
        lines += ["", f"Ablation (HGB, full profile AUC {ab['full_auc']:.4f}): dropping "
                  + ", ".join(f"{k} −{v:.4f}" for k, v in sorted(ab['family_auc_drop'].items(), key=lambda kv: -kv[1])[:4])
                  + f"; 'ablated' (no {' + '.join(ab['dropped'])}) AUC {ab['ablated']['age_auc']:.4f}, "
                  f"link top-1 {ab['ablated']['link_top1']:.4f}."]
    lk = R / "leakage_check.json"
    if lk.exists():
        l = read_json(lk)
        lines += ["", f"Leakage check (dev cutoff, {l['customers']:,} customers rebuilt from a source physically limited "
                  f"to t_dat < {l['cutoff']}): {'passed' if l['passed'] else 'FAILED'}."]
    lines += ["", "## Intended use", "Hackathon demo and research on compact layout personalization; input data for the model stage.", "",
              "## Not supported / never claim",
              "Browsing style (deferred). Causal effect of layouts on behavior. Privacy, anonymity or differential privacy.",
              "Lower exposure for a compact representation is not claimed: that needs matched utility, measured by the model stage.", "",
              "## Known limitations",
              "Purchases are not browsing; markdown is a proxy; same-day rows approximate baskets; single retailer;",
              "pandemic-period data; hero, grid and filter rules are assumptions; the rules v1 layouts lose to fixed",
              "baselines on most tested decisions; several features have low early/late reliability; the MI selection",
              "uses development-window labels (top target category), so MI codes are not label-free."]
    (R / "data_card.md").write_text("\n".join(lines) + "\n")
