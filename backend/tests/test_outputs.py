"""Integration tests against built outputs: `pytest -m integration` (smoke) or ATELIER_RUN_ROOT=. (full)."""
import json
import os
import re
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from atelier_data import compress, config, db, evaluate, features, references, rules
from atelier_data.config import read_json
from atelier_data.log import parse_row_accounting

pytestmark = pytest.mark.integration

ROOT = Path(__file__).parents[1]
RUN_ROOT = Path(os.environ.get("ATELIER_RUN_ROOT", ROOT / "runs" / "smoke")).resolve()
SMOKE = RUN_ROOT != ROOT.resolve()
HEX64 = re.compile(r"\b[0-9a-f]{64}\b")
HASH_FILES = {"checksums.sha256", "build_manifest.json"}  # file checksums, not identifiers


@pytest.fixture(scope="module")
def cfg():
    return config.load(smoke=SMOKE, run_root=RUN_ROOT)


@pytest.fixture(scope="module")
def vocab(cfg):
    return read_json(cfg.paths.processed / "vocabularies.json")


def test_profiles_valid(cfg, vocab):
    fo = features.feature_order(vocab)
    assert len(fo) == 25
    for cut in ("dev", "final"):
        for E in cfg["compression"]["history_budgets"]:
            p = pd.read_parquet(cfg.paths.processed / f"profiles_{cut}_E{E}.parquet")
            x = p[fo].to_numpy()
            assert np.isfinite(x).all() and x.min() >= 0 and x.max() <= 1
            for blk in (vocab["category_keys"], vocab["department_keys"], features.COLOR_KEYS):
                assert np.abs(p[blk].sum(axis=1) - 1).max() <= 1e-6, (cut, E, blk)


def test_cohort_counts(cfg):
    c = pd.read_parquet(cfg.paths.processed / "cohort.parquet")
    per = cfg["cohort"]["per_stratum"]
    assert len(c) == 4 * per
    pf = read_json(cfg.paths.reports / "preflight.json")
    assert c["stratum"].value_counts().to_dict() == pf["strata"]["selected"]


def test_shoppers_json(cfg):
    s = read_json(cfg.paths.frontend / "shoppers.json")
    want = 4 * cfg["showcase"]["per_stratum"]
    assert len(s["shoppers"]) == want == (200 if SMOKE else 1000)
    for k in ("dataset_version", "schema_version", "cutoff", "feature_order", "feature_labels", "store_defaults",
              "canonical_config", "rules_label", "browsing_note", "shoppers"):
        assert k in s
    assert s["rules_label"] == evaluate.RULES_LABEL and s["canonical_config"] is None
    decisions = {"landing_department", "category_order", "section_order", "default_sort", "color_highlight",
                 "price_filter_first", "filter_order", "hero", "popups", "grid_columns", "compare_panel",
                 "reviews_first", "cart_reminder"}
    ids = [r["id"] for r in s["shoppers"]]
    assert ids == [f"shopper_{i:04d}" for i in range(1, want + 1)]
    for r in s["shoppers"]:
        assert set(r) >= {"id", "stratum", "profile", "evidence", "consent", "browsing", "adapted", "layout", "variants"}
        assert list(r["profile"]) == s["feature_order"]
        assert set(r["layout"]) == decisions
        for name, d in r["layout"].items():
            assert set(d) == {"value", "class", "validated", "reason"}
            if name in s["store_defaults"] and d["value"] == s["store_defaults"][name]:
                assert d["validated"] is None  # nothing adapted, nothing to validate
            assert "100th" not in d["reason"] and " is in the" not in d["reason"].replace("price level is in the", "")
        assert r["browsing"]["source"] == "deferred"
        assert (r["layout"]["popups"]["value"] == "on") == (r["consent"]["newsletter"] == "subscribed")


def test_variants_not_shipped(cfg):
    """Data-only scope: compressed-layout variants need a canonical size, which the model stage chooses."""
    s = read_json(cfg.paths.frontend / "shoppers.json")
    assert all(r["variants"] == {} for r in s["shoppers"])


def test_catalog_json(cfg):
    c = read_json(cfg.paths.frontend / "catalog.json")
    assert len(c["articles"]) == cfg["catalog"]["n_articles"]
    fields = {"id", "name", "department", "group", "product_type", "garment", "color", "color_family", "solid",
              "price_pct", "markdown", "is_new", "popularity_pct", "first_seen_days_ago"}
    for a in c["articles"]:
        assert set(a) == fields


def test_results_json(cfg):
    r = read_json(cfg.paths.frontend / "results.json")
    for k in ("dataset_version", "cutoffs", "cohort_size", "eval_users", "sort_eval_users", "excluded_sort_pairs",
              "canonical_config", "compression_declared_successful", "store_defaults", "headline", "canonical",
              "rules_label", "baselines",
              "per_stratum", "population_weighted", "compression_curve", "exposure", "validity", "claims"):
        assert k in r, k
    for k in ("category_order", "landing_department", "section_order", "default_sort", "color_highlight",
              "targeting", "shuffle_control"):
        assert k in r["headline"], k
    assert r["headline"]["label"] == evaluate.RULES_LABEL
    for d in ("category_order", "landing_department", "section_order", "default_sort", "color_highlight"):
        assert set(r["headline"][d]["changed_users"]) >= {"users", "gain", "ci95", "validated"}
    for d in ("category_order", "landing_department"):
        assert "vs_recent_popularity" in r["headline"][d]
    assert r["compression_curve"] and r["exposure"]["full"]


def test_representations(cfg, vocab):
    fo = features.feature_order(vocab)
    ks = compress.configurations(cfg)
    for cut in ("dev", "final"):
        rep = read_json(cfg.paths.reports / f"compression_{cut}.json")
        assert len(rep["configurations"]) == len(ks)
        for k in ks:
            cid = compress.config_id(k)
            assert (cfg.paths.processed / "compressors" / cut / f"{cid}.json").exists()
        for cid in ("Eall_D8_pca_int8", "E3_D4_mi_float32", "Eall_D25_identity_float32"):
            r = pd.read_parquet(cfg.paths.processed / "representations" / cut / f"{cid}.parquet")
            codes = [c for c in r.columns if c != "customer_key"]
            assert codes == [f"c{i}" for i in range(int(cid.split("_D")[1].split("_")[0]))]  # codes only
            assert all(str(r[c].dtype) == ("uint8" if cid.endswith("int8") else "float32") for c in codes)
            r = pd.read_parquet(cfg.paths.processed / "reconstructions" / cut / f"{cid}.parquet")
            R = r[[f"r_{f}" for f in fo]].to_numpy(dtype=float)
            assert R.min() >= 0 and R.max() <= 1
            for blk in (vocab["category_keys"], vocab["department_keys"], features.COLOR_KEYS):
                assert np.allclose(r[[f"r_{f}" for f in blk]].sum(axis=1), 1, atol=1e-5)


def test_score_reproduces_v1(cfg, tmp_path):
    """Scoring the shipped v1 layouts with `score` reproduces eval_final.json exactly."""
    lay = pd.read_parquet(cfg.paths.processed / "layouts_final.parquet")
    vals = [json.loads(x) for x in lay["layout"]]
    df = pd.DataFrame({"customer_key": lay["customer_key"],
                       **{c: [v[c] for v in vals] for c in evaluate.SCORE_COLUMNS[1:]}})
    path = tmp_path / "v1_layouts.parquet"
    df.to_parquet(path, index=False)
    got = evaluate.score_layouts(cfg, db.connect(cfg), path, "final")
    want = read_json(cfg.paths.reports / "eval_final.json")
    norm = lambda o: json.loads(json.dumps(config._finite(json.loads(json.dumps(o, default=config._json_default)))))
    for k in ("overall", "per_stratum", "population_weighted", "baselines", "eval_users", "sort_eval_users",
              "excluded_sort_pairs", "shuffle_control", "store_defaults", "recent_popularity"):
        assert norm(got[k]) == norm(want[k]), k


def test_reconstruct_rebuilds_identically(cfg, vocab, tmp_path):
    from atelier_data import compress as c
    fo = features.feature_order(vocab)
    for cut, cid in (("final", "Eall_D8_pca_int8"), ("dev", "E3_D4_mi_float32"), ("final", "E1_D8_random_int8_r1")):
        codes = pd.read_parquet(cfg.paths.processed / "representations" / cut / f"{cid}.parquet")
        params = read_json(cfg.paths.processed / "compressors" / cut / f"{cid}.json")
        R = c.decode(params, codes.drop(columns="customer_key").to_numpy(), fo, vocab)
        got = c.reconstruction_frame(codes["customer_key"].to_numpy(), R, fo, vocab)
        want = pd.read_parquet(cfg.paths.processed / "reconstructions" / cut / f"{cid}.parquet")
        pd.testing.assert_frame_equal(got, want, check_exact=True)


def test_exposure_report(cfg):
    x = read_json(cfg.paths.reports / "exposure_report.json")
    assert len(x["configurations"]) == len(compress.configurations(cfg))
    assert x["age_bands"] == [b[0] for b in cfg["exposure"]["age_bands"]]
    for r in x["configurations"]:
        assert 0 <= r["unique_share"] <= 1 and 0 <= r["age_auc"] <= 1
        assert ("link_top1" in r) == (r["E"] == "all")
    assert len(x["ablation"]["dropped"]) == 2


def test_reports_present(cfg):
    R = cfg.paths.reports
    # selection.json is not produced: utility-based selection is out of the data-only scope
    for f in ("preflight.json", "split_manifest.json", "vocabularies.json", "reliability.json", "markdown_proxy.json",
              "rules_frozen.json", "eval_dev.json", "eval_final.json", "compression_dev.json", "compression_final.json",
              "exposure_report.json", "leakage_check.json", "DATA_LOG.md", "data_card.md", "checksums.sha256",
              "build_manifest.json", "figures/compression_curve.png", "figures/exposure_frontier.png",
              "figures/sort_targeting.png"):
        assert (R / f).exists(), f
    m = read_json(R / "build_manifest.json")
    assert {"A", "dataset-v1", "C"} <= {f["name"] for f in m["freeze_points"]}
    assert "2019-08-26" in (R / "data_card.md").read_text()


def test_reserved_window_untouched(cfg):
    assert set(read_json(cfg.paths.reports / "split_manifest.json")) == {"data_start", "D_max", "dev", "final"}
    names = [f.name for d in (cfg.paths.processed, cfg.paths.interim) for f in d.rglob("*")]
    assert not [n for n in names if "confirm" in n or "2019" in n]


def _keys(o):
    if isinstance(o, dict):
        for k, v in o.items():
            yield k
            yield from _keys(v)
    elif isinstance(o, list):
        for v in o:
            yield from _keys(v)


def test_privacy_hygiene(cfg):
    banned = {"age", "postal_code", "customer_id"}
    files = [f for d in (cfg.paths.frontend, cfg.paths.reports) for f in d.rglob("*") if f.is_file()
             and f.suffix in {".json", ".md", ".yaml", ".sha256", ".txt", ".csv"}]
    assert files
    for f in files:
        text = f.read_text()
        if f.suffix == ".json":
            bad = banned & set(_keys(json.loads(text)))
            assert not bad, (f, bad)
        if f.name not in HASH_FILES:
            assert not HEX64.search(text), f


def test_determinism(cfg, vocab):
    """Rebuilding the dev E=all profiles twice gives the same values and identical layouts."""
    con = db.connect(cfg)
    coh = pd.read_parquet(cfg.paths.processed / "cohort.parquet", columns=["customer_key"])
    con.register("det_df", coh)
    con.execute("CREATE OR REPLACE TEMP TABLE det_keys AS SELECT * FROM det_df")
    s = read_json(cfg.paths.reports / "split_manifest.json")
    refs = references.load(cfg, "dev")
    rel = features.keyed_units(cfg.paths.interim / "units_dev.parquet", "det_keys")
    a = features.build_profiles(con, cfg, refs, rel, s["dev"]["cutoff"], s["data_start"])
    b = features.build_profiles(con, cfg, refs, rel, s["dev"]["cutoff"], s["data_start"])
    stored = pd.read_parquet(cfg.paths.processed / "profiles_dev_Eall.parquet")
    fo = features.feature_order(vocab)
    assert np.allclose(a[fo], b[fo], atol=1e-9) and np.allclose(a[fo], stored[fo], atol=1e-9)
    frozen = evaluate.load_frozen(cfg)
    defaults = evaluate.defaults_for(cfg, "dev", frozen)
    L1 = evaluate.layout_for(cfg, stored, vocab, defaults, frozen.get("disabled_decisions", []))
    L2 = evaluate.layout_for(cfg, stored, vocab, defaults, frozen.get("disabled_decisions", []))
    assert all(rules.values(L1, i, vocab, cfg) == rules.values(L2, i, vocab, cfg) for i in range(len(stored)))


def test_row_accounting(cfg):
    entries = list(parse_row_accounting(cfg.paths.reports / "DATA_LOG.md"))
    assert entries
    for stage, a in entries:
        assert a["in"] - sum(a["drops"].values()) == a["out"], stage
