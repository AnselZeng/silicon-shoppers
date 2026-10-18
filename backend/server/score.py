"""Score demo shoppers: their events -> one homepage document each (lib/model/homepage.ts HomepageDoc).

Three sources, each labelled in the document:
  H&M model      the frozen purchase models, run on features built from the shopper's add-to-bag history
                 (hm_features + catalog mapping). Same decisions and wording as `python -m model export`.
  Live session   the OTTO-trained session model on the shopper's last 40 clicks/carts across visits, so a
                 returning shopper starts where they left off (multi-visit features become real).
  Your settings  what the shopper chose explicitly: sorts and filters they keep using.
plus a ranking of the demo catalog (store_products) and store-wide trending.
"""
from __future__ import annotations

import datetime as dt
import json
from types import SimpleNamespace

import numpy as np
import pandas as pd

from . import catalog as K
from . import hm_features as H
from . import personas as PERSONA
from .config import REPO, SESSION_LAST_EVENTS

SECTION_LABELS = {"new_in": "New In", "sale": "Sale", "bestsellers": "Bestsellers", "buy_again": "Buy Again"}
SORT_LABELS = {"price_asc": "price, low to high", "price_desc": "price, high to low", "newest": "newest first",
               "bestsellers": "bestsellers first", "relevance": "relevance"}
CLICKS = ("product_viewed", "quickview_opened")
CARTS = ("add_to_bag", "purchase", "checkout")    # payment_completed carries no product ids
ORDERS = ("purchase", "checkout")
STORE_FILTERS = ("category", "size", "color", "price", "sale", "collection")


def _pct(x):
    return f"{100 * x:.0f}%"


def hash_id(s: str) -> int:
    """Same as adapter.ts hashId (FNV-1a mod 2^31-1), so Python and the browser give a product the same aid."""
    h = 2166136261
    for ch in s:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h % 2147483647


# ---------------------------------------------------------------- H&M model

def hm_scores(B: dict, users: pd.DataFrame) -> dict:
    """Frozen models -> per-decision probabilities and decisions, exactly as model.export / test2019 serve them."""
    from model import common as C
    from model import mw
    w = SimpleNamespace(users=users, priors=B["priors"], defaults=B["defaults"])
    S = mw.predict_scores(B["models"], w, B["cols"], B["vocab"], B["frozen"], C.load_cfg())
    combo = B["combo"]
    picks = {"cat": S[f"cat:{combo['cat']}"], "dept": S[f"dept:{combo['dept']}"], "sec": S[f"sec:{combo['sec']}"],
             "sort": S["sort:regress"], "mc": S["mc:offset"]}
    L = mw.layout(picks, w, B["vocab"], C.load_cfg(), B["policy"])
    norm = lambda m: np.clip(m, 1e-9, None) / np.clip(m, 1e-9, None).sum(axis=1, keepdims=True)
    P = {"cat": norm(picks["cat"]), "dept": norm(picks["dept"]), "sec": np.clip(S[B["sec_share_key"]], 0, 1),
         "mc": norm(picks["mc"])}
    return {"L": L, "P": P}


def _hm_layout(B, i, L, P, n_carts: int) -> dict:
    v, val = B["vocab"], B["validated"]
    cat_keys, cat_names = v["category_keys"], v["category_names"]
    dept_keys, dept_names = v["department_keys"], v["department_names"]
    secs, d = B["sections"], B["defaults"]
    prior_c, prior_mc = np.array(B["priors"]["category"]), np.array(B["priors"]["master_color"])
    pop2 = np.argsort(-prior_mc, kind="stable")[:2]
    cp, dp, sp, mp = P["cat"][i], P["dept"][i], P["sec"][i], P["mc"][i]
    cat_order = [cat_keys[j] for j in L["cat_order"][i]]
    top_c = L["cat_order"][i][0]
    lift = cp[top_c] / prior_c[top_c]
    land = int(L["landing"][i])
    sec_order = [secs[j] for j in L["sec_order"][i]]
    s0 = secs.index(sec_order[0])
    from atelier_data.rules import SORTS
    sort = SORTS[int(L["sort"][i])]
    colors = L["colors"][i]
    evidence = (f"from your {n_carts} add-to-bag{'s' if n_carts != 1 else ''}" if n_carts
                else "for a new shopper (nothing in your bag yet)")
    price_first = bool(sp[secs.index("sale")] >= B["sale_hi"])
    filters = ["category", "size", "color", "price", "sale"]
    if price_first:
        filters = ["price", "sale"] + [x for x in filters if x not in ("price", "sale")]
    if colors:
        filters = ["color"] + [x for x in filters if x != "color"]
    hero = ("discount" if sec_order[0] == "sale" else "new_drop" if sec_order[0] == "new_in"
            else ("category" if cp[top_c] >= B["rules"]["hero_category_min_share"] else "editorial"))
    T = lambda value, key, reason: {"value": value, "class": "Tested", "validated": bool(val.get(key, False)),
                                    "reason": reason}
    A = lambda value, reason: {"value": value, "class": "Assumed", "validated": None, "reason": reason}
    layout = {
        "landing_department": T(dept_keys[land], "landing_department",
                                f"{dept_names[land]}: about {_pct(dp[land])} of your next picks (predicted {evidence})"),
        "category_order": T(cat_order, "category_order",
                            f"{cat_names[top_c]} first: about {_pct(cp[top_c])} of your next picks "
                            + (f"({lift:.1f}x the store average)" if lift >= 1.2 else "(your most likely category)")),
        "section_order": T(sec_order, "section_order",
                           f"{SECTION_LABELS[sec_order[0]]} first: about {_pct(sp[s0])} of your next picks are likely "
                           f"to come from it"),
        "default_sort": T(sort, "default_sort", f"Sorted {SORT_LABELS.get(sort, sort)}"
                          + (": store default, no shopper beat it on held-out data" if sort == d["default_sort"] else "")),
        "color_highlight": T(colors, "color_highlight",
                             (f"You're likely to pick {' and '.join(c.lower() for c in colors)} (about "
                              f"{_pct(sum(mp[v['master_colors'].index(c)] for c in colors))} of next picks vs "
                              f"{_pct(mp[pop2].sum())} for the store's top colors)") if colors
                             else "No color highlight: your predicted colors match the store's"),
        "price_filter_first": A(price_first, "Price filter first: sale items predicted to matter" if price_first
                                else "Default filters"),
        "filter_order": A(filters, "Filters reordered to match your predicted shopping"
                          if filters != ["category", "size", "color", "price", "sale"] else "Store default filters"),
        "hero": A(hero, {"discount": "Sale banner: Sale is your top section",
                         "new_drop": "New-drop banner: New In is your top section",
                         "category": f"Banner for {cat_names[top_c]}, your top predicted category",
                         "editorial": "Editorial banner (store default)"}[hero]),
        "popups": {"value": "off", "class": "Based on your settings", "validated": None,
                   "reason": "No newsletter sign-up on record"},
    }
    mix = {"category": dict(zip(cat_keys, np.round(cp, 4).tolist())),
           "department": dict(zip(dept_keys, np.round(dp, 4).tolist())),
           "section": dict(zip(secs, np.round(sp, 4).tolist()))}
    return layout, mix, colors


# ---------------------------------------------------------------- live session model

def session_events(ev: pd.DataFrame) -> list[tuple]:
    """(ts seconds, aid, type) for the session model: clicks 0, carts 1, orders 2; last 40."""
    e = ev[ev["type"].isin(CLICKS + CARTS) & ev["product_id"].notna()].sort_values("ts")
    t = np.where(e["type"].isin(ORDERS), 2, np.where(e["type"].isin(CARTS), 1, 0))
    ts = (pd.to_datetime(e["ts"]).astype("int64") // 10 ** 9).to_numpy()
    out = [(int(a), hash_id(str(p)), int(b)) for a, p, b in zip(ts, e["product_id"], t)]
    return out[-SESSION_LAST_EVENTS:]


def session_part(model: dict | None, events: list[tuple]) -> dict | None:
    if model is None:
        return None
    from session_model.export import decide, predict
    from session_model.features import FEATURES, session_features
    x = session_features(events)
    style = predict(model, x) if events else {}
    dec = decide(model, style, len(events)) if events else {}
    visits = x[FEATURES.index("n_visits")] if events else 0
    return {"n_events": len(events), "visits": None if visits != visits else int(visits),
            "style": {k: round(v, 3) for k, v in style.items()}, "decisions": dec,
            "source": "Live session model (OTTO), on your last visits"}


# ---------------------------------------------------------------- explicit settings

def preferences(ev: pd.DataFrame) -> dict:
    """Sorts and filters the shopper keeps choosing (counted over all their visits)."""
    props = ev["properties"].apply(lambda p: p if isinstance(p, dict) else (json.loads(p) if isinstance(p, str) and p else {}))
    # store versions differ: sort in "value" or "sort"; filter name in "type", "filter" or "section"
    sorts = [p.get("value") or p.get("sort") for t, p in zip(ev["type"], props)
             if t == "sort_changed" and (p.get("value") or p.get("sort"))]
    filt = [(p.get("type") or p.get("filter") or p.get("section"), p.get("value")) for t, p in zip(ev["type"], props)
            if t == "filter_applied" and (p.get("type") or p.get("filter") or p.get("section"))]
    searches = [p.get("q") for t, p in zip(ev["type"], props) if t == "search_performed" and p.get("q")]
    out = {"sort_counts": pd.Series(sorts, dtype=object).value_counts().to_dict() if sorts else {},
           "filter_counts": pd.Series([f for f, _ in filt], dtype=object).value_counts().to_dict() if filt else {},
           "color_filters": [c for c, _ in pd.Series([v for f, v in filt if f == "color" and v], dtype=object)
                             .value_counts().items()][:3] if filt else [],
           "recent_searches": list(dict.fromkeys(reversed(searches)))[:5]}
    # a sort becomes the default once chosen twice and it is the latest choice
    if sorts and out["sort_counts"].get(sorts[-1], 0) >= 2:
        out["sort"] = sorts[-1]
    out["filters_first"] = [f for f, n in sorted(out["filter_counts"].items(), key=lambda kv: -kv[1])
                            if n >= 2 and f in STORE_FILTERS]
    return out


# ---------------------------------------------------------------- demo catalog ranking

def rank_store(attrs: pd.DataFrame, mix: dict, colors_hm: list[str], ev: pd.DataFrame, trending: dict,
               n: int = 24) -> list[dict]:
    """Python twin of adapter.ts rankCatalog, plus what the shopper viewed and what's trending.
    Products already in the bag are left out."""
    cat, dept = mix["category"], mix["department"]
    women = dept.get("dept_ladieswear", 0) + dept.get("dept_divided", 0)
    men = dept.get("dept_menswear", 0)
    hl = {K.HM_TO_APP_COLOR[c] for c in colors_hm if c in K.HM_TO_APP_COLOR}
    group_size = attrs.groupby("hm_category").size().to_dict()
    viewed = ev[ev["type"].isin(CLICKS)]["product_id"].dropna()
    bagged = set(ev[ev["type"].isin(CARTS)]["product_id"].dropna())
    a = attrs.set_index("product_id")
    vcat = a.loc[[p for p in viewed if p in a.index], "category"].value_counts(normalize=True).to_dict() if len(viewed) else {}
    vdep = a.loc[[p for p in viewed if p in a.index], "department"].value_counts(normalize=True).to_dict() if len(viewed) else {}
    vcol = pd.Series([c for p in viewed if p in a.index for c in a.at[p, "colors"]], dtype=object).value_counts(normalize=True).to_dict() if len(viewed) else {}
    tmax = max(trending.values()) if trending else 0
    rows = []
    for _, p in attrs.iterrows():
        if p["product_id"] in bagged:
            continue
        share = cat.get(p["hm_category"], 0) / max(group_size.get(p["hm_category"], 1), 1)
        fit = men if p["department"] == "men" else women
        base = share * (0.2 + fit) * (1.5 if any(c in hl for c in p["colors"]) else 1) + 1e-4 * p["popularity"]
        live = (1 + 0.8 * vcat.get(p["category"], 0) + 1.0 * vdep.get(p["department"], 0) + 0.4 * max([vcol.get(c, 0) for c in p["colors"]] or [0]))
        tr = trending.get(p["product_id"], 0) / tmax if tmax else 0
        score = base * live * (1 + 0.3 * tr)
        why = ("trending in the store right now" if tr >= 0.6 else
               "like what you've been viewing" if vcat.get(p["category"], 0) >= 0.3 else
               "in a color you're likely to pick" if any(c in hl for c in p["colors"]) else
               "fits your predicted mix")
        rows.append((score, p["product_id"], why))
    rows.sort(key=lambda r: -r[0])
    return [{"product_id": pid, "score": round(float(s), 5), "why": w} for s, pid, w in rows[:n]]


# ---------------------------------------------------------------- one document per shopper

def build_docs(B: dict, session_model: dict | None, events: pd.DataFrame, attrs: pd.DataFrame, users: list[str],
               trending: dict, run_id: str, now: dt.datetime | None = None) -> pd.DataFrame:
    now = now or dt.datetime.utcnow()
    cutoff = now.date() + dt.timedelta(days=1)       # H&M cutoffs are exclusive: today's events are 1 day old
    units = K.units_from_events(events, attrs)
    feats = H.build_users(units, users, cutoff, B)
    R = hm_scores(B, feats)
    by_user = {u: g for u, g in events.groupby("user_id", sort=False)}
    out = []
    for i, u in enumerate(users):
        ev = by_user.get(u, events.iloc[:0])
        n_carts = int(ev["type"].isin(CARTS).sum())
        layout, mix, colors = _hm_layout(B, i, R["L"], R["P"], n_carts)
        ses = session_part(session_model, session_events(ev))
        pref = preferences(ev)
        dec = (ses or {}).get("decisions", {})
        g = dec.get("grid_columns", {})
        rv = dec.get("recently_viewed", {})
        layout["grid_columns"] = {"value": g.get("value", 3) if g.get("active") else 3, "class": "Estimated",
                                  "validated": None,
                                  "reason": g.get("reason") if g.get("active") else "Store default until the live model has enough clicks"}
        layout["recently_viewed"] = {"value": rv.get("value", "default") if rv.get("active") else "default",
                                     "class": "Estimated", "validated": None,
                                     "reason": rv.get("reason") if rv.get("active") else "Store default until the live model has enough clicks"}
        layout["compare_panel"] = {"value": "default", "class": "Estimated", "validated": None,
                                   "reason": "Set by the live session model (see session.decisions)"}
        layout["cart_reminder"] = {"value": "default", "class": "Estimated", "validated": None,
                                   "reason": "Set by the live session model (see session.decisions)"}
        # explicit choices beat predictions
        if pref.get("sort"):
            layout["default_sort"] = {"value": pref["sort"], "class": "Based on your settings", "validated": None,
                                      "reason": f"You keep sorting by {SORT_LABELS.get(pref['sort'], pref['sort'])} "
                                                f"({pref['sort_counts'][pref['sort']]} times)"}
        if pref["filters_first"]:
            fo = pref["filters_first"] + [f for f in layout["filter_order"]["value"] if f not in pref["filters_first"]]
            layout["filter_order"] = {"value": fo, "class": "Based on your settings", "validated": None,
                                      "reason": f"Filters you use most first ({', '.join(pref['filters_first'])})"}
        doc = {
            "user_id": u, "stratum": "light", "cutoff": cutoff.isoformat(), "updated_at": now.isoformat(timespec="seconds") + "Z",
            "run_id": run_id,
            "shopper": PERSONA.shopper_block(u, PERSONA.assign_live(PERSONA.live_stats(ev, attrs))),
            "model": {"name": f"atelier-shopper-model v2 (frozen {B['frozen_manifest'].get('frozen_at', '?')})",
                      "inputs": f"{len(B['cols'])} purchase features from your add-to-bags, mapped to H&M groups and colors"},
            "evidence": {"events": int(len(ev)), "add_to_bags": n_carts,
                         "validated_on": B["validated_source"],
                         "note": "Tested = beat the store default on held-out H&M purchases. Your store purchases are "
                                 "mapped to H&M product groups and colors; that mapping itself is not tested."},
            "layout": layout, "predicted_mix": mix,
            "browsing": {"source": "Live session model", "match_confidence": 1.0,
                         "exploration": (ses or {}).get("style", {}).get("exploration", 0.5),
                         "multi_visit_research": (ses or {}).get("style", {}).get("multi_visit_research", 0.5)},
            "products": {"for_you": [], "rows": {}},
            "store_products": rank_store(attrs, mix, colors, ev, trending),
            "session": ses, "preferences": pref,
        }
        out.append({"user_id": u, "n_events": int(len(ev)), "n_carts": n_carts, "homepage": doc})
    return pd.DataFrame(out)


def load_session_model() -> dict | None:
    p = REPO / "session_model" / "web" / "session_model.json"
    return json.loads(p.read_text()) if p.exists() else None
