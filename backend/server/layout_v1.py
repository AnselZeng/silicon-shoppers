"""atelier.store_layout.v1 documents — what the UI reads.

score.py and publish_hm build the internal HomepageDoc ({value, class, validated, reason} plus
model internals), then to_v1() turns it into the stored document:

    format/source/shopper/layout/products   - the v1 contract the UI team renders
    model_meta                              - everything the internals still need (predicted_mix,
                                              session, preferences, evidence, store_products);
                                              the v1 spec says ignore unknown fields

This is the Python twin of the reference frontend/lib/model/storeLayout.ts — keep them in step.
"""

from __future__ import annotations

import pandas as pd

# same vocabulary as storeLayout.ts LABELS
DEPT_LABELS = {"dept_ladieswear": "Women", "dept_menswear": "Men", "dept_divided": "Divided (teen & young)",
               "dept_sport": "Sport", "dept_baby_children": "Baby & Kids"}
CAT_LABELS = {"cat_garment_upper_body": "Tops", "cat_garment_lower_body": "Bottoms",
              "cat_garment_full_body": "Dresses & jumpsuits", "cat_swimwear": "Swimwear",
              "cat_underwear": "Underwear", "cat_accessories": "Accessories", "cat_shoes": "Shoes",
              "cat_other": "Other"}

DEFAULT_DEPARTMENT_ORDER = ["dept_ladieswear", "dept_divided", "dept_menswear", "dept_baby_children",
                            "dept_sport"]
DEFAULT_CATEGORY_ORDER = ["cat_garment_upper_body", "cat_garment_lower_body", "cat_garment_full_body",
                          "cat_swimwear", "cat_underwear", "cat_accessories", "cat_other", "cat_shoes"]
DEFAULT_SECTIONS = ["new_in", "bestsellers", "sale_picks", "collections"]
DEFAULT_FILTERS = ["category", "size", "color", "price", "collection", "sale"]

# HomepageDoc vocabulary -> v1 vocabulary
HM_SECTION = {"new_in": "new_in", "sale": "sale_picks", "bestsellers": "bestsellers"}   # buy_again drops, collections appended
HERO = {"discount": "discount_banner", "new_drop": "new_drop_banner", "category": "collection_banner",
        "editorial": "editorial"}
CLASS_TO_SOURCE = {"Tested": "H&M model", "Assumed": "H&M model", "Estimated": "Live session",
                   "Based on your settings": "You said"}

PERSONA_CHECKOUT = {"price_hunter": "guest_express", "mission_shopper": "guest_express",
                    "brand_loyalist": "loyalty_pay"}


def _d(value, reason="Store default", extra=None):
    return {"value": value, "changed": False, "reason": reason, "source": "Store default", **(extra or {})}


def default_layout() -> dict:
    """The normal store — every v1 field present, nothing changed."""
    return {
        "landing_department": _d("dept_ladieswear", "Women (store default)"),
        "department_order": _d(list(DEFAULT_DEPARTMENT_ORDER), "The store's usual order",
                               {"labels": [DEPT_LABELS[k] for k in DEFAULT_DEPARTMENT_ORDER]}),
        "category_order": _d(list(DEFAULT_CATEGORY_ORDER), "Store's popular order"),
        "homepage_sections": _d(list(DEFAULT_SECTIONS), "Store default order"),
        "quick_access": _d([], "No shortcuts yet", {"tiles": []}),
        "hero": _d("editorial", extra={"minimized": False}),
        "default_sort": _d("relevance"),
        "filter_order": _d(list(DEFAULT_FILTERS), "Standard filters", {"expanded": ["category"]}),
        "price_mode": _d(False, "Standard filters", {"budget_rail": False}),
        "budget": _d(None, "No budget set"),
        "color_highlight": _d([], "No color highlight"),
        "sale_badges": _d("default"),
        "search": _d("default"),
        "popups": _d("newsletter"),
        "grid_columns": _d(3),
        "quick_view": _d("default"),
        "quick_add": _d("off"),
        "compare_panel": _d("off"),
        "recently_viewed": _d("default"),
        "cart_reminder": _d("off"),
        "product_page": _d("standard"),
        "checkout": _d("standard"),
    }


def _set(layout: dict, key: str, value, reason: str, source: str, extra: dict | None = None):
    """storeLayout.ts set(): mark changed only when the value actually differs from the default."""
    before = default_layout()[key]
    changed = value != before["value"] or any(extra.get(k) != before.get(k) for k in (extra or {}))
    layout[key] = {**before, **(extra or {}), "value": value, "changed": changed,
                   "reason": reason if changed else before["reason"],
                   "source": source if changed else "Store default"}


def to_v1(doc: dict, source: str = "merged", products: dict | None = None) -> dict:
    """HomepageDoc -> atelier.store_layout.v1. Internals move to model_meta, the UI ignores them.

    source: "hm_shopper" for the 100k H&M documents, "merged" for live store shoppers
    (H&M-mapped purchases + live session + stated preferences all in one doc).
    """
    L = doc.get("layout", {})
    src = lambda k: CLASS_TO_SOURCE.get((L.get(k) or {}).get("class") or "", "H&M model")
    lay = default_layout()

    def take(key):  # the decision dict or None
        v = L.get(key)
        return v if isinstance(v, dict) and "value" in v else None

    d = take("landing_department")
    if d:
        _set(lay, "landing_department", d["value"], d["reason"], src("landing_department"))
    mix = doc.get("predicted_mix") or {}
    dept_mix = mix.get("department") or {}
    if dept_mix:
        order = sorted(dept_mix, key=dept_mix.get, reverse=True)
        _set(lay, "department_order", order, "Ordered by your predicted department mix", "H&M model",
             {"labels": [DEPT_LABELS.get(k, k) for k in order]})
    d = take("category_order")
    if d:
        _set(lay, "category_order", d["value"], d["reason"], src("category_order"))
    d = take("section_order")
    if d:
        secs = [HM_SECTION[s] for s in d["value"] if s in HM_SECTION]
        _set(lay, "homepage_sections", secs + ["collections"], d["reason"], src("section_order"))
    cat_mix = mix.get("category") or {}
    if cat_mix:
        top = sorted(cat_mix, key=cat_mix.get, reverse=True)[:3]
        _set(lay, "quick_access", top, "Your most likely product groups", "H&M model",
             {"tiles": [{"key": k, "label": CAT_LABELS.get(k, k), "kind": "category",
                         "reason": "Your most likely product groups"} for k in top]})
    d = take("hero")
    if d:
        _set(lay, "hero", HERO.get(d["value"], "editorial"), d["reason"], src("hero"), {"minimized": False})
    d = take("default_sort")
    if d:
        _set(lay, "default_sort", d["value"], d["reason"], src("default_sort"))
    price_first = bool((take("price_filter_first") or {}).get("value"))
    d = take("filter_order")
    if d:
        fo = list(d["value"]) + [f for f in DEFAULT_FILTERS if f not in d["value"]]
        _set(lay, "filter_order", fo, d["reason"], src("filter_order"),
             {"expanded": ["price", "sale"] if price_first else ["category"]})
    if price_first:
        p = take("price_filter_first")
        _set(lay, "price_mode", True, p["reason"], src("price_filter_first"), {"budget_rail": True})
        _set(lay, "sale_badges", "prominent", "Sale items matter to this shopper", "H&M model")
    d = take("color_highlight")
    if d and d["value"]:
        _set(lay, "color_highlight", d["value"], d["reason"], src("color_highlight"))
    d = take("popups")
    if d:
        _set(lay, "popups", d["value"], d["reason"], src("popups"))

    # live-session decisions (session.decisions: {key: {active, value, reason}})
    ses = (doc.get("session") or {}).get("decisions") or {}
    for key in ("grid_columns", "quick_add", "compare_panel", "recently_viewed", "cart_reminder",
                "product_page"):
        s = ses.get(key) or {}
        if s.get("active"):
            _set(lay, key, s["value"], s.get("reason", "Live session"), "Live session")
    # non-session copies kept in the HomepageDoc (grid_columns/recently_viewed placeholders)
    for key in ("grid_columns", "recently_viewed"):
        d = take(key)
        if d and not lay[key]["changed"] and d.get("class") == "Estimated" and d["value"] != default_layout()[key]["value"]:
            _set(lay, key, d["value"], d["reason"], "Live session")

    pref = doc.get("preferences") or {}
    if pref.get("recent_searches"):
        _set(lay, "search", "emphasized",
             f"You've searched {len(pref['recent_searches'])} time{'s' if len(pref['recent_searches']) != 1 else ''}",
             "You said")
    if pref.get("sort"):  # explicit repeats already set default_sort above with "You said"
        pass

    shopper = doc.get("shopper") or {"id": str(doc.get("user_id", "?")), "label": "New shopper",
                                   "persona": None, "confidence": "low"}
    pid = shopper.get("persona_id")
    if pid in PERSONA_CHECKOUT and shopper.get("confidence") in ("medium", "high"):
        _set(lay, "checkout", PERSONA_CHECKOUT[pid],
             f"Usual checkout for {shopper['persona']['name']}s", "H&M model")

    out = {"format": "atelier.store_layout.v1", "source": source, "shopper": shopper,
           "layout": lay, "products": products}
    if doc.get("updated_at"):
        out["updated_at"] = doc["updated_at"]
    meta = {k: doc[k] for k in ("predicted_mix", "session", "preferences", "evidence", "store_products",
                                "browsing", "model", "run_id", "user_id", "customer_key", "stratum",
                                "cutoff", "products") if k in doc and k != "products"}
    if doc.get("products") is not None:
        meta["hm_products"] = doc["products"]
    if meta:
        out["model_meta"] = meta
    return out


def products_by_department(store_products: list[dict], attrs, department_order: list[str],
                           per_dept: int = 8) -> dict | None:
    """v1 products block from rank_store output: top items grouped along department_order."""
    if not store_products:
        return None
    a = attrs.set_index("product_id")
    dept_of = a["department"].to_dict()
    dept_key = {"women": "dept_ladieswear", "men": "dept_menswear", "kids": "dept_baby_children",
                "sport": "dept_sport"}
    by_dept = []
    for dk in department_order[:4]:
        store_dept = {k for k, v in dept_key.items() if v == dk}
        items = [p["product_id"] for p in store_products if dept_of.get(p["product_id"]) in store_dept][:per_dept]
        if items:
            by_dept.append({"department": dk, "label": DEPT_LABELS.get(dk, dk), "items": items})
    cheap = [p["product_id"] for p in store_products
             if p["product_id"] in a.index and pd.notna(a.at[p["product_id"], "sale_price"])][:6]
    return {"by_department": by_dept, "budget_picks": cheap}
