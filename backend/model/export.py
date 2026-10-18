"""Homepage export: one JSON document per cohort shopper, in the same per-decision format as
artifacts/frontend/shoppers.json ({value, class, validated, reason}), plus product tiles from the item ranker.

Decision classes:
  Tested     - predicted by the layout model and scored against held-out purchases (validated = dev CI > 0)
  Estimated  - driven by OTTO browsing values estimated from behaviorally similar shoppers (not purchase-testable)
  Assumed    - design defaults derived from tested predictions (filters, banner)
  Based on your settings - newsletter consent (pop-ups)
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from atelier_data import references, rules
from atelier_data.config import read_json
from atelier_data.rules import SORTS
from . import common as C
from . import layout

WORK = C.WORK
MODEL_SET = "f37_hist"
SECTION_LABELS = {"new_in": "New In", "sale": "Sale", "bestsellers": "Bestsellers", "buy_again": "Buy Again"}
SORT_LABELS = {"price_asc": "price, low to high", "newest": "newest first", "bestsellers": "bestsellers first"}


def _pct(x):
    return f"{100 * x:.0f}%"


def _tercile_cut(v: np.ndarray):
    return np.nanquantile(v, [1 / 3, 2 / 3])


WHY_CODES = {"bought before": "rebuy", "another color of something you bought": "variant",
             "often bought with your recent picks": "copurch", "top seller in your favorite section": "seg",
             "new arrival in your department": "new", "this week's bestseller": "pop", "": ""}


def build(cut: str = "final", model_set: str = MODEL_SET, n_tiles: int = 12, per_row: int = 4,
          compact: bool = False):
    """Homepage documents per shopper. compact=True keeps tiles as {article_id, why} references and also returns
    the article table they point to (fits Supabase's free tier: about 1.5 KB per shopper instead of 7.5 KB)."""
    cfg = C.load_cfg(); con = C.connect(cfg); vocab = C.vocab(cfg); co = C.cohort(cfg)
    keys = co["customer_key"].to_numpy()
    strata = co["stratum"].to_numpy()
    priors = references.load(cfg, cut).priors
    defaults = C.defaults(cfg, cut)
    tiles_path = WORK / f"item_scores_{cut}.parquet"
    if (WORK / "frozen" / "choice.json").exists() and cut == "final":
        # v2: frozen multi-window models (mw.py), scores for every cohort shopper at the final cutoff
        import pickle
        from types import SimpleNamespace
        from . import mw
        choice = read_json(WORK / "frozen" / "choice.json")
        combo = choice["combo"]
        policy = {k: (np.inf if v is None else v) for k, v in choice["policy"].items()}
        with open(mw.OUT / "valid_scores.pkl", "rb") as fh:
            Sv = pickle.load(fh)
        picks = {"cat": Sv[f"cat:{combo['cat']}"], "dept": Sv[f"dept:{combo['dept']}"],
                 "sec": Sv[f"sec:{combo['sec']}"], "sort": Sv["sort:regress"], "mc": Sv["mc:offset"]}
        L = mw.layout(picks, SimpleNamespace(users=co, defaults=defaults, priors=priors), vocab, cfg, policy)
        norm = lambda m: np.clip(m, 1e-9, None) / np.clip(m, 1e-9, None).sum(axis=1, keepdims=True)
        # rank models order sections but don't predict shares: the "% of next purchases" text uses the
        # cross-entropy section model trained on the same window
        sec_share = Sv[f"sec:regress_{combo['sec'].split('_', 1)[1]}"] if combo["sec"].startswith("rank_") \
            else picks["sec"]
        P = {"cat": norm(picks["cat"]), "dept": norm(picks["dept"]), "sec": np.clip(sec_share, 0, 1),
             "sort": picks["sort"], "mc": norm(picks["mc"])}
        # "validated" = confirmed on the clean 2019 test when it has run, else on August (validation)
        test = WORK / "frozen" / "test_2019.json"
        if test.exists():
            src = read_json(test)["layout"]
        else:
            src = next(r for r in read_json(mw.OUT / "results.json")["combos"] if r["combo"] == combo)["valid"]
        validated = {d: bool(v["validated"]) for d, v in src.items() if d != "_extra"}
        tiles_path = mw.OUT / f"item_scores_{cut}.parquet"
    else:
        res = read_json(WORK / "layout_results.json")[model_set]
        policy = {k: (np.inf if v is None else v) for k, v in res["policy"].items()}
        validated = {d: bool(v["validated"]) for d, v in res["dev"].items()}
        npz = np.load(WORK / f"pred_{model_set}.npz")
        raw = {k: npz[f"{cut}_{k}"] for k in ("cat", "dept", "sec", "sort", "mc")}
        P = layout.probabilities(raw, priors)
        L = layout.to_layout(raw, vocab, cfg, defaults, priors, policy)

    fused = C.fused(cfg, cut)
    prof = pd.read_parquet(cfg.paths.processed / f"profiles_{cut}_Eall.parquet",
                           columns=["customer_key", "newsletter", "confidence"]).sort_values("customer_key")
    assert (fused["customer_key"].to_numpy() == keys).all() and (prof["customer_key"].to_numpy() == keys).all()

    cat_keys, cat_names = vocab["category_keys"], vocab["category_names"]
    dept_keys, dept_names = vocab["department_keys"], vocab["department_names"]
    secs = rules.sections(cfg)
    prior_c, prior_mc = np.array(priors["category"]), np.array(priors["master_color"])
    default_rank = {cat_keys.index(c): r for r, c in enumerate(defaults["category_order"])}
    pop2 = np.argsort(-prior_mc, kind="stable")[:2]

    # browsing (estimated): only exploration and multi_visit_research carry real signal (FUSION.md)
    ex_lo, ex_hi = _tercile_cut(fused["exploration"].to_numpy())
    mv_hi = np.nanquantile(fused["multi_visit_research"].to_numpy(), 2 / 3)
    trig = cfg["rules"]
    sale_hi = np.nanquantile(P["sec"][:, rules.sections(cfg).index("sale")], trig["trigger_high"])

    # product tiles
    import pyarrow.parquet as pq
    want = ["customer_key", "article_key", "cat_idx", "score", "s_rebuy", "s_variant", "s_copurch", "s_seg", "s_new",
            "s_pop", "product_units"]
    have = set(pq.ParquetFile(tiles_path).schema_arrow.names)
    tiles = pd.read_parquet(tiles_path, columns=[c for c in want if c in have])
    if "product_units" not in tiles.columns:
        tiles["product_units"] = 0
    art = pd.read_parquet(cfg.paths.ingested / "articles.parquet",
                          columns=["article_key", "article_id", "product_type_name", "colour_group_name",
                                   "perceived_colour_master_name", "index_group_name", "product_group_name"])
    ref = pd.read_parquet(cfg.paths.refs(cut) / "article_ref.parquet", columns=["article_key", "last_price"])
    tiles = tiles.merge(art, on="article_key", how="left").merge(ref, on="article_key", how="left")
    tiles = tiles.sort_values(["customer_key", "score"], ascending=[True, False], kind="stable").reset_index(drop=True)
    src_cols = ["s_rebuy", "s_variant", "s_copurch", "s_seg", "s_new", "s_pop"]
    src_name = {"s_rebuy": "bought before", "s_variant": "another color of something you bought",
                "s_copurch": "often bought with your recent picks", "s_seg": "top seller in your favorite section",
                "s_new": "new arrival in your department", "s_pop": "this week's bestseller"}
    src = tiles[src_cols].to_numpy()
    first = np.where(src.any(1), src.argmax(1), -1)
    why = np.array([src_name[c] for c in src_cols] + [""], dtype=object)[first]
    cat_idx = tiles["cat_idx"].to_numpy()
    t_art, t_cg, t_pt = tiles["article_id"].to_numpy(), tiles["colour_group_name"].to_numpy(), tiles["product_type_name"].to_numpy()
    t_ig, t_pc = tiles["index_group_name"].to_numpy(), tiles["perceived_colour_master_name"].to_numpy()
    t_lp, t_sc = tiles["last_price"].to_numpy(), tiles["score"].to_numpy()
    t_bb = tiles["product_units"].to_numpy() > 0      # same product (any color) bought before

    used = set()

    def rec(j):
        if compact:
            used.add(j)
            return {"article_id": t_art[j], "why": WHY_CODES[why[j]], "bought_before": bool(t_bb[j])}
        ci = int(cat_idx[j])
        return {"article_id": t_art[j], "name": f"{t_cg[j]} {t_pt[j]}",
                "category": cat_keys[ci] if ci >= 0 else "cat_other", "department": t_ig[j], "color": t_pc[j],
                "price_scaled": None if np.isnan(t_lp[j]) else round(float(t_lp[j]), 6),
                "score": round(float(t_sc[j]), 4), "why": why[j], "bought_before": bool(t_bb[j])}

    # tiles are already sorted by (customer_key, score desc); split into per-shopper slices
    ck = tiles["customer_key"].to_numpy()
    starts = np.flatnonzero(np.r_[True, ck[1:] != ck[:-1]])
    ends = np.r_[starts[1:], len(ck)]
    by_user = {int(ck[s0]): (s0, e0) for s0, e0 in zip(starts, ends)}

    frow = fused[["price_level", "exploration", "multi_visit_research", "match_confidence"]].to_dict("records")
    news_v = prof["newsletter"].to_numpy()
    out = []
    for i, k in enumerate(keys):
        cp, dp, sp, so, mp = P["cat"][i], P["dept"][i], P["sec"][i], P["sort"][i], P["mc"][i]
        cat_order = [cat_keys[j] for j in L["cat_order"][i]]
        top_c = L["cat_order"][i][0]
        lift_c = cp[top_c] / prior_c[top_c]
        # biggest climb versus the store's default order, to explain personalization below the top slot
        climb = [(default_rank[j] - r, j, r) for r, j in enumerate(L["cat_order"][i])]
        best = max(climb)
        moved, moved_to = (best[1], best[2]) if best[0] >= 2 else (None, None)
        land = int(L["landing"][i])
        sec_order = [secs[j] for j in L["sec_order"][i]]
        s0 = secs.index(sec_order[0])
        sort = SORTS[int(L["sort"][i])]
        colors = L["colors"][i]
        f = frow[i]
        price_first = bool(sp[secs.index("sale")] >= sale_hi or f["price_level"] <= trig["trigger_low"])
        filters = ["category", "size", "color", "price", "sale"]
        if price_first:
            filters = ["price", "sale"] + [x for x in filters if x not in ("price", "sale")]
        if colors:
            filters = ["color"] + [x for x in filters if x != "color"]
        hero = ("discount" if sec_order[0] == "sale" else "new_drop" if sec_order[0] == "new_in"
                else ("category" if cp[top_c] >= trig["hero_category_min_share"] else "editorial"))
        ex, mv = float(f["exploration"]), float(f["multi_visit_research"])
        grid = 4 if ex >= ex_hi else 2 if ex <= ex_lo else 3
        news = news_v[i]
        span = by_user.get(int(k))
        for_you, rows = [], {}
        if span is not None:
            a0, b0 = span
            seen, pick = set(), []
            for j in range(a0, b0):  # one tile per display name, so the grid doesn't repeat itself
                nm = (t_cg[j], t_pt[j])
                if nm not in seen:
                    seen.add(nm); pick.append(j)
                if len(pick) == n_tiles:
                    break
            for_you = [rec(j) for j in pick]
            for c in cat_order[:3]:
                ci = cat_keys.index(c)
                rows[c] = [rec(j) for j in [j for j in range(a0, b0) if cat_idx[j] == ci][:per_row]]
        doc = {
            "customer_key": int(k), "stratum": strata[i], "cutoff": cut,
            "model": {"name": f"atelier-shopper-model ({model_set})", "inputs": "37 fused values + purchase history"},
            "layout": {
                "landing_department": {
                    "value": dept_keys[land], "class": "Tested", "validated": validated["landing_department"],
                    "reason": f"{dept_names[land]}: about {_pct(dp[land])} of your next purchases (predicted)"},
                "category_order": {
                    "value": cat_order, "class": "Tested", "validated": validated["category_order"],
                    "reason": (f"{cat_names[top_c]} first: about {_pct(cp[top_c])} of your next purchases "
                               + (f"({lift_c:.1f}x the store average)" if lift_c >= 1.2 else "(your most likely category)")
                               + (f"; {cat_names[moved]} moved up to #{moved_to + 1}" if moved is not None else ""))},
                "section_order": {
                    "value": sec_order, "class": "Tested", "validated": validated["section_order"],
                    "reason": f"{SECTION_LABELS[sec_order[0]]} first: about {_pct(sp[s0])} of your next purchases "
                              f"are likely to come from it"},
                "default_sort": {
                    "value": sort, "class": "Tested", "validated": validated["default_sort"],
                    "reason": (f"Sorted {SORT_LABELS[sort]}" + (": store default, no shopper beat it on held-out data"
                                                                if sort == defaults["default_sort"] else ""))},
                "color_highlight": {
                    "value": colors, "class": "Tested", "validated": validated["color_highlight"],
                    "reason": (f"You're likely to pick {' and '.join(c.lower() for c in colors)} "
                               f"(about {_pct(sum(mp[vocab['master_colors'].index(c)] for c in colors))} of next "
                               f"purchases vs {_pct(mp[pop2].sum())} for the store's top colors)") if colors
                              else "No color highlight: your predicted colors match the store's"},
                "price_filter_first": {"value": price_first, "class": "Assumed", "validated": None,
                                       "reason": "Price filter first: sale items or low prices predicted to matter"
                                       if price_first else "Default filters"},
                "filter_order": {"value": filters, "class": "Assumed", "validated": None,
                                 "reason": "Filters reordered to match your predicted shopping"
                                 if filters != ["category", "size", "color", "price", "sale"] else "Store default filters"},
                "hero": {"value": hero, "class": "Assumed", "validated": None,
                         "reason": {"discount": "Sale banner: Sale is your top section",
                                    "new_drop": "New-drop banner: New In is your top section",
                                    "category": f"Banner for {cat_names[top_c]}, your top predicted category",
                                    "editorial": "Editorial banner (store default)"}[hero]},
                "grid_columns": {"value": grid, "class": "Estimated", "validated": None,
                                 "reason": f"Grid density from browsing breadth (exploration {ex:.2f}, estimated "
                                           f"from similar OTTO shoppers)"},
                "recently_viewed": {"value": "prominent" if mv >= mv_hi else "default", "class": "Estimated",
                                    "validated": None,
                                    "reason": f"Multi-visit research {mv:.2f} (estimated from similar OTTO shoppers)"},
                "compare_panel": {"value": "default", "class": "Estimated", "validated": None,
                                  "reason": "Comparison behavior can't be estimated from purchases (R² 0.00)"},
                "cart_reminder": {"value": "default", "class": "Estimated", "validated": None,
                                  "reason": "Cart-to-order is near average for everyone (R² 0.07)"},
                "popups": {"value": "on" if news == "subscribed" else "off", "class": "Based on your settings",
                           "validated": None,
                           "reason": "You subscribed to the newsletter" if news == "subscribed"
                           else "You haven't subscribed to the newsletter"},
            },
            "predicted_mix": {
                "category": dict(zip(cat_keys, np.round(cp, 4).tolist())),
                "department": dict(zip(dept_keys, np.round(dp, 4).tolist())),
                "section": dict(zip(secs, np.round(sp, 4).tolist())),
            },
            "browsing": {"source": "OTTO (estimated)", "match_confidence": round(float(f["match_confidence"]), 3),
                         "exploration": round(ex, 3), "multi_visit_research": round(mv, 3)},
            "products": {"for_you": for_you, "rows": rows},
        }
        out.append(json.dumps(doc, separators=(",", ":")))
    pages = pd.DataFrame({"customer_key": keys, "stratum": co["stratum"].to_numpy(), "homepage": out})
    if not compact:
        return pages
    j = np.array(sorted(used))
    arts = pd.DataFrame({"article_id": t_art[j], "name": [f"{a} {b}" for a, b in zip(t_cg[j], t_pt[j])],
                         "category": [cat_keys[int(c)] if c >= 0 else "cat_other" for c in cat_idx[j]],
                         "department": t_ig[j], "color": t_pc[j],
                         "price_scaled": np.round(t_lp[j], 6)}).drop_duplicates("article_id").reset_index(drop=True)
    return pages, arts


def write_all():
    out = WORK / "export"
    out.mkdir(parents=True, exist_ok=True)
    build("final").to_parquet(out / "homepages_final.parquet")
    pages, arts = build("final", compact=True)
    pages.to_parquet(out / "homepages_final_compact.parquet")
    arts.to_parquet(out / "homepage_articles_final.parquet")
    print(f"homepages: {len(pages):,} shoppers, {len(arts):,} tile articles -> {out}")

