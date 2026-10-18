"""8.9 layout engine: vectorized decisions per configuration, store defaults, reason rendering."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .features import cat_breadth
from .percentiles import within_config_pct

SORTS = ["price_asc", "newest", "bestsellers"]
TRIGGER_FEATURES = ["markdown_affinity", "novelty_affinity", "mainstream_score", "rebuy_share",
                    "color_concentration", "price_level"]


def sections(cfg) -> list[str]:
    return list(cfg.rules["decisions"]["section_order"]["sections"])


def store_defaults(cfg, priors: dict, frozen: dict) -> dict:
    return {
        "landing_department": priors["department_order"][0],
        "category_order": list(priors["category_order"]),
        "section_order": list(frozen["default_section_order"]),
        "default_sort": frozen["store_default_sort"],
        "hero": cfg.rules["decisions"]["hero"]["default"],
        "grid_columns": cfg.rules["decisions"]["grid_columns"]["default"],
        "filter_order": list(cfg.rules["decisions"]["filter_order"]["default"]),
        "popups": "off",
        "price_filter_first": False,
        "color_highlight": [],
    }


def run(cfg, feats: pd.DataFrame, meta: pd.DataFrame, vocab: dict, defaults: dict, disabled=()) -> dict:
    """Decisions for every row of one configuration.

    feats: the 25 features (column names from the vocabulary); meta: confidence, newsletter,
    top_colors, known_color_units aligned to feats. Returns arrays (one entry per row).
    """
    rc, D = cfg["rules"], cfg.rules["decisions"]
    n = len(feats)
    conf = meta["confidence"].to_numpy()
    disabled = set(disabled)

    def adapts(dec):
        return np.isin(conf, D[dec]["adapts_at"]) & (dec not in disabled)

    cat_keys, dept_keys = vocab["category_keys"], vocab["department_keys"]
    cat = feats[cat_keys].to_numpy(dtype=float)
    dept = feats[dept_keys].to_numpy(dtype=float)
    pct = {f: within_config_pct(feats[f].to_numpy(dtype=float)) for f in TRIGGER_FEATURES}
    pct["cat_breadth"] = within_config_pct(cat_breadth(cat))
    hi, lo = rc["trigger_high"], rc["trigger_low"]
    out = {"pct": pct, "n": n}

    # landing department / category order (adapt at every confidence level)
    a = adapts("landing_department")
    out["landing"] = np.where(a, dept.argmax(axis=1), dept_keys.index(defaults["landing_department"]))
    out["landing_adapted"] = a
    a = adapts("category_order")
    default_cat = np.array([cat_keys.index(k) for k in defaults["category_order"]])
    out["cat_order"] = np.where(a[:, None], np.argsort(-cat, axis=1, kind="stable"), default_cat)
    out["cat_adapted"] = a

    # section order
    secs = sections(cfg)
    sec_pct = np.column_stack([pct[D["section_order"]["sections"][s]] for s in secs])
    a = adapts("section_order")
    default_sec = np.array([secs.index(s) for s in defaults["section_order"]])
    out["sec_order"] = np.where(a[:, None], np.argsort(-sec_pct, axis=1, kind="stable"), default_sec)
    out["sec_adapted"] = a

    # default sort: best candidate by pct (listed order breaks ties); fires at >= trigger_high
    cands = D["default_sort"]["candidates"]
    cp = np.column_stack([pct[c["feature"]] for c in cands])
    best = cp.argmax(axis=1)
    fire = (cp[np.arange(n), best] >= hi) & adapts("default_sort")
    cand_sort = np.array([SORTS.index(c["sort"]) for c in cands])
    out["sort"] = np.where(fire, cand_sort[best], SORTS.index(defaults["default_sort"]))
    out["sort_rule"] = np.where(fire, best, -1)
    # each rule's own trigger, whether or not another rule won (targeting test)
    out["sort_fired"] = {c["feature"]: (pct[c["feature"]] >= hi) & (conf != "low") for c in cands}

    # color highlight
    on = (pct[D["color_highlight"]["feature"]] >= hi) & \
         (meta["known_color_units"].to_numpy() >= rc["color_min_known_units"]) & adapts("color_highlight")
    out["color_on"] = on
    out["colors"] = [list(c) if o else [] for c, o in zip(meta["top_colors"], on)]

    # price filter first
    md_fire = pct["markdown_affinity"] >= hi
    pl_fire = pct["price_level"] <= lo
    pff = (md_fire | pl_fire) & adapts("price_filter_first")
    out["pff"] = pff
    out["pff_feature"] = np.where(md_fire, "markdown_affinity", "price_level")

    # filter order: color first if highlighted, then price + sale if price filter first, then the rest
    F = list(D["filter_order"]["default"])
    out["filters"] = [[*(["color"] if c else []), *(["price", "sale"] if p else [])] for c, p in zip(on, pff)]
    out["filters"] = [lead + [f for f in F if f not in lead] for lead in out["filters"]]

    # hero
    hc = D["hero"]["candidates"]
    hp = np.column_stack([pct[c["feature"]] for c in hc])
    hb = hp.argmax(axis=1)
    hfire = hp[np.arange(n), hb] >= hi
    top_cat = cat.argmax(axis=1)
    cat_ok = (cat[np.arange(n), top_cat] >= rc["hero_category_min_share"]) & (top_cat != len(cat_keys) - 1) \
        & ("hero_category" not in disabled)
    a = adapts("hero")
    hero_names = np.array([c["hero"] for c in hc], dtype=object)
    cat_hero = np.array([f"category:{cat_keys[i]}" for i in top_cat], dtype=object)
    out["hero"] = np.where(a & hfire, hero_names[hb], np.where(a & cat_ok, cat_hero, D["hero"]["default"]))
    out["hero_src"] = np.where(a & hfire, "feature", np.where(a & cat_ok, "category", "default"))
    out["hero_feature"] = np.array([c["feature"] for c in hc], dtype=object)[hb]

    # pop-ups: observed consent only
    out["popups"] = np.where(meta["newsletter"].to_numpy() == "subscribed", "on", "off")

    # grid density
    pb = pct["cat_breadth"]
    g = np.where(pb >= rc["breadth_high"], 4, np.where(pb <= rc["breadth_low"], 2, D["grid_columns"]["default"]))
    out["grid"] = np.where(adapts("grid_columns"), g, D["grid_columns"]["default"])
    return out


def values(layout: dict, i: int, vocab: dict, cfg) -> dict:
    """Plain decision values for row i (frontend `variants` layout and layouts_final)."""
    secs = sections(cfg)
    return {
        "landing_department": vocab["department_keys"][layout["landing"][i]],
        "category_order": [vocab["category_keys"][j] for j in layout["cat_order"][i]],
        "section_order": [secs[j] for j in layout["sec_order"][i]],
        "default_sort": SORTS[layout["sort"][i]],
        "color_highlight": layout["colors"][i],
        "price_filter_first": bool(layout["pff"][i]),
        "filter_order": layout["filters"][i],
        "hero": str(layout["hero"][i]),
        "grid_columns": int(layout["grid"][i]),
        "popups": str(layout["popups"][i]),
    }


def differs(v: dict, defaults: dict, keys=None) -> bool:
    keys = keys or [k for k in v if k in defaults]
    return any(v[k] != defaults[k] for k in keys)


def ordinal(n: int) -> str:
    suf = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suf}"


def pct_ordinal(cfg, pct: float) -> str:
    lo, hi = cfg.rules["percentile_display"]
    return ordinal(int(min(hi, max(lo, round(pct * 100)))))


def render(layout: dict, i: int, feats: pd.Series, vocab: dict, cfg, defaults: dict, validated: dict) -> dict:
    """Full exported layout for row i: value, class, validated, reason (8.9 item 4).

    validated: decision -> flag from the changed-users test; shown only where this shopper's value differs
    from the store default (otherwise null: nothing was adapted).
    """
    R = cfg.rules
    D, cls = R["decisions"], R["classes"]
    flab, phrase, slab, seclab = R["feature_labels"], R["feature_phrases"], R["sort_labels"], R["section_labels"]
    v = values(layout, i, vocab, cfg)
    pct = {k: float(a[i]) for k, a in layout["pct"].items()}
    names = dict(zip(vocab["category_keys"], vocab["category_names"]))
    names.update(zip(vocab["department_keys"], vocab["department_names"]))
    store = "Store default"

    def share(key):
        return f"{round(float(feats[key]) * 100)}%"

    def entry(dec, value, reason, val=None):
        if D[dec]["class"] == "tested" and value == defaults.get(dec):
            val = None
        return {"value": value, "class": cls[D[dec]["class"]], "validated": val, "reason": reason}

    out = {}
    d = v["landing_department"]
    out["landing_department"] = entry("landing_department", d, D["landing_department"]["reason"].format(
        label=names[d], share_pct=share(d)) if layout["landing_adapted"][i] else store, validated.get("landing_department"))
    c0 = v["category_order"][0]
    out["category_order"] = entry("category_order", v["category_order"], D["category_order"]["reason"].format(
        label=names[c0], share_pct=share(c0)) if layout["cat_adapted"][i] else store, validated.get("category_order"))
    s0 = v["section_order"][0]
    f0 = D["section_order"]["sections"][s0]
    out["section_order"] = entry("section_order", v["section_order"], D["section_order"]["reason"].format(
        label=seclab[s0], feature_phrase=phrase[f0], pct_ordinal=pct_ordinal(cfg, pct[f0]))
        if layout["sec_adapted"][i] else store, validated.get("section_order"))
    r = int(layout["sort_rule"][i])
    if r >= 0:
        cf = D["default_sort"]["candidates"][r]["feature"]
        reason = D["default_sort"]["reason"].format(sort_label=slab[v["default_sort"]], feature_phrase=phrase[cf],
                                                    pct_ordinal=pct_ordinal(cfg, pct[cf]))
        val = validated.get("default_sort")
    else:
        reason, val = D["default_sort"]["default_reason"], None
    out["default_sort"] = entry("default_sort", v["default_sort"], reason, val)
    cols = v["color_highlight"]
    out["color_highlight"] = entry("color_highlight", cols, D["color_highlight"]["reason"].format(
        colors=" and ".join(c.lower() for c in cols)) if cols else store, validated.get("color_highlight"))
    if v["price_filter_first"]:
        pf = layout["pff_feature"][i]
        reason = D["price_filter_first"]["reason"].format(feature_phrase=phrase[pf], pct_ordinal=pct_ordinal(cfg, pct[pf]))
    else:
        reason = store
    out["price_filter_first"] = entry("price_filter_first", v["price_filter_first"], reason)
    out["filter_order"] = entry("filter_order", v["filter_order"],
                                D["filter_order"]["reason"] if v["filter_order"] != defaults["filter_order"] else store)
    src = layout["hero_src"][i]
    if src == "feature":
        reason = D["hero"]["reason"].format(feature_label=flab[layout["hero_feature"][i]])
    elif src == "category":
        reason = D["hero"]["category_reason"].format(label=names[v["hero"].split(":", 1)[1]])
    else:
        reason = store
    out["hero"] = entry("hero", v["hero"], reason)
    out["popups"] = entry("popups", v["popups"], D["popups"]["reason_on" if v["popups"] == "on" else "reason_off"])
    out["grid_columns"] = entry("grid_columns", v["grid_columns"],
                                D["grid_columns"]["reason"] if v["grid_columns"] != defaults["grid_columns"] else store)
    for dec in ("compare_panel", "reviews_first", "cart_reminder"):
        out[dec] = entry(dec, D[dec]["value"], D[dec]["reason"])
    return out
