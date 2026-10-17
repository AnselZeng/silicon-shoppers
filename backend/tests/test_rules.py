import numpy as np
import pandas as pd
import pytest
from fixtures import OVERRIDES

from atelier_data import config, evaluate, rules
from atelier_data.config import read_json

VOCAB = {"category_keys": ["cat_a", "cat_b", "cat_other"], "category_names": ["A", "B", "Other"],
         "department_keys": ["dept_ladieswear", "dept_menswear"], "department_names": ["Ladieswear", "Menswear"],
         "master_colors": ["Black", "Red", "White"]}
DEFAULTS = {"landing_department": "dept_ladieswear", "category_order": ["cat_a", "cat_b", "cat_other"],
            "section_order": ["new_in", "bestsellers", "sale", "buy_again"], "default_sort": "newest",
            "hero": "editorial", "grid_columns": 3, "filter_order": ["category", "size", "color", "price", "sale"],
            "popups": "off", "price_filter_first": False, "color_highlight": []}


def frame():
    f = pd.DataFrame({
        "cat_a": [0.3, 0.3, 0.6, 0.2, 0.3, 0.3], "cat_b": [0.35, 0.35, 0.3, 0.2, 0.35, 0.35],
        "cat_other": [0.35, 0.35, 0.1, 0.6, 0.35, 0.35],
        "dept_ladieswear": [0.8, 0.3, 0.8, 0.8, 0.8, 0.8], "dept_menswear": [0.2, 0.7, 0.2, 0.2, 0.2, 0.2],
        "color_neutral": 0.5, "color_warm": 0.25, "color_cool": 0.25,
        "color_concentration": [0.1, 0.2, 0.9, 0.3, 0.4, 0.5], "solid_share": 0.5,
        "price_level": [0.5, 0.6, 0.7, 0.8, 0.9, 0.05],
        "markdown_affinity": [0.9, 0.1, 0.2, 0.3, 0.4, 0.5], "novelty_affinity": [0.1, 0.9, 0.2, 0.3, 0.4, 0.5],
        "rebuy_share": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], "channel_2_share": 0.5, "purchase_frequency": 0.5,
        "mainstream_score": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    })
    meta = pd.DataFrame({"confidence": ["medium", "low", "high", "medium", "medium", "medium"],
                         "newsletter": ["not_subscribed", "subscribed"] + ["not_subscribed"] * 4,
                         "top_colors": [["Red"], ["Black"], ["Black", "White"], [], [], []],
                         "known_color_units": [0, 0, 5, 0, 0, 0]})
    return f, meta


@pytest.fixture(scope="module")
def cfg():
    return config.load(overrides=OVERRIDES)


def test_rules(cfg):
    f, meta = frame()
    L = rules.run(cfg, f, meta, VOCAB, DEFAULTS)
    v = [rules.values(L, i, VOCAB, cfg) for i in range(6)]
    # row 0: top markdown (pct 0.917) -> price sort, price filter first, discount hero
    assert v[0]["default_sort"] == "price_asc" and v[0]["price_filter_first"]
    assert v[0]["filter_order"] == ["price", "sale", "category", "size", "color"]
    assert v[0]["hero"] == "discount" and v[0]["landing_department"] == "dept_ladieswear"
    # row 1: low confidence -> defaults except landing department and consent pop-ups
    assert v[1]["landing_department"] == "dept_menswear" and v[1]["popups"] == "on"
    assert v[1]["default_sort"] == "newest" and v[1]["hero"] == "editorial" and v[1]["grid_columns"] == 3
    assert v[1]["section_order"] == DEFAULTS["section_order"] and v[1]["filter_order"] == DEFAULTS["filter_order"]
    # row 2: color concentration on top with enough known units; top category 60% -> category hero
    assert v[2]["color_highlight"] == ["Black", "White"]
    assert v[2]["filter_order"] == ["color", "category", "size", "price", "sale"]
    assert v[2]["hero"] == "category:cat_a" and v[2]["default_sort"] == "newest"
    # row 3: top category is cat_other -> no category hero
    assert v[3]["hero"] == "editorial"
    # row 5: mainstream wins the sort; lowest price level -> price filter first
    assert v[5]["default_sort"] == "bestsellers" and v[5]["price_filter_first"]
    assert L["pff_feature"][5] == "price_level"
    # disabled decisions fall back to store defaults
    Ld = rules.run(cfg, f, meta, VOCAB, DEFAULTS, disabled=["default_sort", "landing_department"])
    assert rules.SORTS[Ld["sort"][0]] == "newest" and VOCAB["department_keys"][Ld["landing"][1]] == "dept_ladieswear"
    # reasons
    r = rules.render(L, 0, f.iloc[0], VOCAB, cfg, DEFAULTS, {"default_sort": True, "landing_department": True})
    assert r["default_sort"]["reason"] == "Sorted price, low to high: your markdown purchases are in the 92nd percentile"
    assert r["default_sort"]["validated"] is True and r["landing_department"]["reason"] == "Ladieswear: about 80% of your purchases"
    assert r["landing_department"]["validated"] is None  # value equals the store default: nothing adapted to validate
    assert r["price_filter_first"]["reason"] == "Price filter first: your markdown purchases are in the 92nd percentile"
    r5 = rules.render(L, 5, f.iloc[5], VOCAB, cfg, DEFAULTS, {})
    assert r5["price_filter_first"]["reason"] == "Price filter first: your price level is in the 8th percentile"
    r1 = rules.render(L, 1, f.iloc[1], VOCAB, cfg, DEFAULTS, {})
    assert r1["popups"]["reason"] == "You subscribed to the newsletter" and r1["popups"]["class"] == "Based on your settings"
    assert r1["default_sort"]["reason"] == "Store default sort" and r1["default_sort"]["validated"] is None
    r2 = rules.render(L, 2, f.iloc[2], VOCAB, cfg, DEFAULTS, {})
    assert r2["color_highlight"]["reason"] == "You mostly buy black and white"
    assert r2["hero"]["reason"] == "Banner for A, your top category"


def test_pct_ordinal_clamped(cfg):
    assert [rules.pct_ordinal(cfg, x) for x in (0.0, 0.004, 0.5, 0.996, 1.0)] == ["1st", "1st", "50th", "99th", "99th"]


def test_ordinal():
    assert [rules.ordinal(n) for n in (1, 2, 3, 4, 11, 12, 13, 21, 92, 100)] == \
        ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "92nd", "100th"]


def test_rules_frozen_merge(built):
    """validity (disabled list) and evaluate (frozen defaults) both write rules_frozen.json; neither drops the other."""
    evaluate.save_frozen(built, {"disabled_decisions": ["grid_columns"]})
    evaluate.save_frozen(built, {"store_default_sort": "newest", "default_section_order": ["new_in"]})
    evaluate.save_frozen(built, {"disabled_decisions": []})
    got = read_json(built.paths.processed / "rules_frozen.json")
    assert got["disabled_decisions"] == [] and got["store_default_sort"] == "newest"
    assert got["default_section_order"] == ["new_in"]
    assert read_json(built.paths.reports / "rules_frozen.json") == got


def test_rules_frozen_merge_real_writer(built):
    evaluate.save_frozen(built, {"disabled_decisions": ["hero"]})
    from atelier_data import db
    evaluate.run(built, db.connect(built), force=True)
    got = read_json(built.paths.processed / "rules_frozen.json")
    assert got["disabled_decisions"] == ["hero"]
    assert got["store_default_sort"] in rules.SORTS and len(got["default_section_order"]) == 4
    assert np.isfinite(read_json(built.paths.reports / "eval_final.json")["eval_users"]["overall"])
