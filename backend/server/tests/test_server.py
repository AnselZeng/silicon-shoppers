"""python -m pytest server/tests   (needs the serving bundle: python -m server bundle)

The first test needs the H&M pipeline outputs (model/work/runs); it is skipped where they don't exist."""
import datetime as dt
import json
import os

import numpy as np
import pandas as pd
import pytest

from server import catalog as K
from server import hm_features as H
from server import score
from server.config import REPO, WORK

BUNDLE = WORK / "bundle.pkl"
RUNS = REPO / "model" / "work" / "runs" / "data" / "processed" / "users_final.parquet"
CATALOG_TS = REPO.parent / "la-hacks-app" / "lib" / "store" / "catalog.ts"

need_bundle = pytest.mark.skipif(not BUNDLE.exists(), reason="no serving bundle (python -m server bundle)")


@pytest.fixture(scope="module")
def B():
    from server import bundle
    return bundle.load()


def _catalog():
    if CATALOG_TS.exists():
        return K.parse_catalog_ts(CATALOG_TS)
    return pd.DataFrame({"product_id": ["w-a", "w-b", "m-c"], "name": ["A", "B", "C"],
                         "department": ["women", "women", "men"], "category": ["dresses", "jeans", "jackets"],
                         "collection": ["Studio"] * 3, "price": [100.0, 80.0, 120.0], "sale_price": [np.nan, 60.0, np.nan],
                         "colors": [["black"], ["navy", "grey"], ["olive"]], "is_new": [True, False, False],
                         "popularity": [80.0, 60.0, 70.0]})


@need_bundle
@pytest.mark.skipif(not RUNS.exists(), reason="H&M pipeline outputs not on this machine")
def test_features_match_pipeline(B):
    """Fed real H&M rows, hm_features reproduces the training pipeline's 195 features."""
    from atelier_data import references
    from atelier_data.config import read_json
    from model import windows as W
    from server import bundle
    rc = W.run_cfg()
    con = W.db.connect(rc)
    references.register_cat_map(con, B["vocab"])
    off = pd.read_parquet(RUNS).sort_values("customer_key").sample(300, random_state=3).sort_values("customer_key")
    con.register("kk", off[["customer_key"]])
    con.execute("CREATE OR REPLACE TEMP TABLE kt AS SELECT * FROM kk")
    U = con.execute(bundle.hm_units_sql(rc, "final", len(B["vocab"]["category_keys"]), "kt")).df()
    U["t_dat"] = pd.to_datetime(U["t_dat"]).dt.date
    cutoff = dt.date.fromisoformat(read_json(rc.paths.reports / "split_manifest.json")["final"]["cutoff"])
    mine = H.build_users(U, off["customer_key"].tolist(), cutoff, B)
    for c in B["cols"]:
        a, b = off[c].to_numpy(float), mine[c].to_numpy(float)
        assert np.array_equal(np.isnan(a), np.isnan(b)), c
        ok = ~np.isnan(a)
        np.testing.assert_allclose(b[ok], a[ok], rtol=1e-5, atol=1e-6, err_msg=c)


def test_catalog_parse_and_mapping():
    cat = _catalog()
    assert len(cat) >= 3 and cat["product_id"].is_unique
    assert set(cat["category"]) <= set(K.APP_TO_HM_CATEGORY)
    vocab = {"category_keys": ["cat_garment_upper_body", "cat_garment_lower_body", "cat_garment_full_body",
                               "cat_swimwear", "cat_underwear", "cat_accessories", "cat_shoes", "cat_other"],
             "department_keys": ["dept_ladieswear", "dept_menswear", "dept_divided", "dept_sport", "dept_baby_children"],
             "master_colors": sorted(set(K.APP_TO_HM_COLOR.values()))}
    a = K.hm_attributes(cat, vocab, [0] * len(vocab["master_colors"]))
    assert a["price_pct"].between(0, 1).all() and a["art_pop_pct"].between(0, 1).all()
    assert all(m >= 0 for ms in a["master_codes"] for m in ms)


def _events(rows):
    ev = pd.DataFrame(rows, columns=["user_id", "type", "ts", "product_id", "color", "properties"])
    ev["ts"] = pd.to_datetime(ev["ts"])
    ev["session_id"] = "s"
    return ev


@need_bundle
def test_docs_cold_and_warm(B):
    cat = K.hm_attributes(_catalog(), B["vocab"], B["fam_of_master"])
    pids = cat["product_id"].tolist()
    now = dt.datetime(2026, 10, 17, 20, 0)
    rows = [("warm", "product_viewed", now - dt.timedelta(minutes=10 - i), pids[i % len(pids)], None, {}) for i in range(8)]
    rows += [("warm", "add_to_bag", now - dt.timedelta(minutes=2), pids[0], None, {}),
             ("warm", "sort_changed", now - dt.timedelta(minutes=5), None, None, {"value": "price_asc"}),
             ("warm", "sort_changed", now - dt.timedelta(minutes=1), None, None, {"value": "price_asc"}),
             ("cold", "page_view", now, None, None, {"path": "/store"})]
    docs = score.build_docs(B, score.load_session_model(), _events(rows), cat, ["warm", "cold"], {}, "test", now)
    d = {r.user_id: r.homepage for r in docs.itertuples()}
    for doc in d.values():
        json.dumps(doc)                                  # serializable as a VARIANT
        assert doc["format"] == "atelier.store_layout.v1" and doc["source"] == "merged"
        assert set(doc["layout"]) == {"landing_department", "department_order", "category_order",
                                      "homepage_sections", "quick_access", "hero", "default_sort",
                                      "filter_order", "price_mode", "budget", "color_highlight",
                                      "sale_badges", "search", "popups", "grid_columns", "quick_view",
                                      "quick_add", "compare_panel", "recently_viewed", "cart_reminder",
                                      "product_page", "checkout"}
        assert "persona" in doc["shopper"] and "confidence" in doc["shopper"]
        meta = doc["model_meta"]
        assert abs(sum(meta["predicted_mix"]["category"].values()) - 1) < 1e-3
    sort = d["warm"]["layout"]["default_sort"]
    assert sort["value"] == "price_asc" and sort["changed"] and sort["source"] == "You said"
    assert d["cold"]["model_meta"]["evidence"]["add_to_bags"] == 0
    warm_ids = [p["product_id"] for p in d["warm"]["model_meta"]["store_products"]]
    assert pids[0] not in warm_ids   # already in the bag


@need_bundle
def test_more_carts_move_the_prediction(B):
    """Adding dresses to the bag must raise the predicted full-body share (the model reacts to evidence)."""
    cat = K.hm_attributes(_catalog(), B["vocab"], B["fam_of_master"])
    dresses = cat[cat["category"] == "dresses"]["product_id"].tolist()
    now = dt.datetime(2026, 10, 17, 20, 0)
    rows = [("u", "add_to_bag", now - dt.timedelta(minutes=i), dresses[i % len(dresses)], None, {}) for i in range(6)]
    docs = score.build_docs(B, None, _events(rows), cat, ["u", "nobody"], {}, "t", now)
    full = [r.homepage["model_meta"]["predicted_mix"]["category"]["cat_garment_full_body"] for r in docs.itertuples()]
    assert full[0] > full[1] * 1.5


def test_hash_matches_adapter():
    # adapter.ts hashId("w-classic-tee") computed with the same FNV-1a loop
    h = 2166136261
    for ch in "w-classic-tee":
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    assert score.hash_id("w-classic-tee") == h % 2147483647


@need_bundle
def test_local_pipeline_end_to_end(B, tmp_path, monkeypatch):
    """setup -> catalog -> simulate -> refresh -> layouts, on the local DuckDB backend."""
    monkeypatch.setenv("ATELIER_DB", "local")
    import server.sf as sf
    monkeypatch.setattr(sf, "WORK", tmp_path)
    from server import refresh, simulate
    db = sf.DB()
    db.setup()
    db.replace("CATALOG", _catalog(), variant=("colors",))
    simulate.run(db, 5)
    info = refresh.refresh_once(db, B, score.load_session_model(), verbose=False)
    assert info["users"] == 5
    assert refresh.refresh_once(db, B, score.load_session_model(), verbose=False)["users"] == 0   # nothing new
    lay = db.query("SELECT USER_ID, HOMEPAGE FROM USER_LAYOUTS")
    assert len(lay) == 5
    simulate.clear(db)
    assert db.query("SELECT COUNT(*) AS N FROM EVENTS")["n"].iloc[0] == 0
    db.close()
