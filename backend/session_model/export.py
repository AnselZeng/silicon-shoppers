"""Trained LightGBM models -> web/session_model.json for the browser, plus a pure-Python reference predictor
(mirrored in web/sessionStyle.js) and fixtures the JavaScript check compares against.

The UI policy is data in the same JSON: each decision lists the targets it reads, the cases that switch it, and
a reliability gate (the target's held-out R² at the number of events seen so far must reach MIN_R2), so a
browsing value only changes the page once the model has shown it can predict that value from that many clicks.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import lightgbm as lgb
import numpy as np

from . import config as K
from .features import FEATURES, session_features

MIN_R2 = 0.10
ZERO = 1e-35  # LightGBM kZeroThreshold

POLICY = [
    {"decision": "grid_columns", "targets": ["exploration"], "default": 3,
     "cases": [{"when": {"exploration": [0.67, 1.01]}, "value": 4, "reason": "You browse widely: more products per row"},
               {"when": {"exploration": [-0.01, 0.33]}, "value": 2, "reason": "You look closely at a few items: bigger tiles"}]},
    {"decision": "compare_panel", "targets": ["comparison"], "default": "off",
     "cases": [{"when": {"comparison": [0.67, 1.01]}, "value": "on", "reason": "You come back to items you've seen: compare panel on"}]},
    {"decision": "recently_viewed", "targets": ["multi_visit_research"], "default": "default",
     "cases": [{"when": {"multi_visit_research": [0.67, 1.01]}, "value": "prominent",
                "reason": "You research across visits: Recently Viewed moved up"}]},
    {"decision": "quick_add", "targets": ["decision_speed"], "default": "off",
     "cases": [{"when": {"decision_speed": [0.67, 1.01]}, "value": "on", "reason": "You decide fast: one-tap add to bag on tiles"}]},
    {"decision": "cart_reminder", "targets": ["click_to_cart", "cart_to_order"], "default": "off",
     "cases": [{"when": {"click_to_cart": [0.6, 1.01], "cart_to_order": [-0.01, 0.4]}, "value": "on",
                "reason": "You add to bag often but check out less: saved-bag reminder on"}]},
    {"decision": "product_page", "targets": ["browsing_pace"], "default": "standard",
     "cases": [{"when": {"browsing_pace": [0.67, 1.01]}, "value": "compact", "reason": "You move fast: compact product pages"},
               {"when": {"browsing_pace": [-0.01, 0.33]}, "value": "detailed", "reason": "You take your time: detailed product pages"}]},
]


# ---------- trees ----------

def flatten(tree: dict) -> dict:
    """LightGBM nested tree -> parallel arrays. Children >= 0 are node ids, < 0 are ~leaf ids."""
    f, thr, dl, mt, left, right, leaf = [], [], [], [], [], [], []

    def visit(node) -> int:
        if "leaf_value" in node:
            leaf.append(round(float(node["leaf_value"]), 10))
            return ~(len(leaf) - 1)
        i = len(f)
        f.append(int(node["split_feature"])); thr.append(float(node["threshold"]))
        dl.append(1 if node["default_left"] else 0)
        mt.append({"None": 0, "Zero": 1, "NaN": 2}[node["missing_type"]])
        if node["decision_type"] != "<=":
            raise ValueError("only numerical splits are supported")
        left.append(0); right.append(0)
        left[i] = visit(node["left_child"])
        right[i] = visit(node["right_child"])
        return i

    root = visit(tree["tree_structure"])
    return {"root": root, "f": f, "t": thr, "dl": dl, "mt": mt, "l": left, "r": right, "v": leaf}


def go_left(x: float, t: float, dl: int, mt: int) -> bool:
    """LightGBM NumericalDecision."""
    if math.isnan(x) and mt != 2:
        x = 0.0
    if (mt == 1 and -ZERO <= x <= ZERO) or (mt == 2 and math.isnan(x)):
        return bool(dl)
    return x <= t


def tree_value(tr: dict, x: list[float]) -> float:
    node = tr["root"]
    if node < 0:
        return tr["v"][~node]
    while node >= 0:
        node = tr["l"][node] if go_left(x[tr["f"][node]], tr["t"][node], tr["dl"][node], tr["mt"][node]) else tr["r"][node]
    return tr["v"][~node]


def predict(model: dict, x: list[float]) -> dict:
    """Target -> predicted percentile in [0, 1]."""
    return {tgt: min(1.0, max(0.0, sum(tree_value(tr, x) for tr in m["trees"]))) for tgt, m in model["targets"].items()}


# ---------- policy ----------

def reliable_r2(model: dict, target: str, n_events: int) -> float:
    """Held-out R² at the largest trained prefix length <= n_events (0 before the first)."""
    by_n = model["targets"][target]["r2_by_events"]
    ok = [int(k) for k in by_n if int(k) <= n_events]
    return by_n[str(max(ok))] if ok else 0.0


def decide(model: dict, style: dict, n_events: int) -> dict:
    out = {}
    for rule in model["policy"]:
        weak = [t for t in rule["targets"] if reliable_r2(model, t, n_events) < model["min_r2"]]
        if weak:
            out[rule["decision"]] = {"value": rule["default"], "active": False,
                                     "reason": f"Not enough signal yet from {n_events} events"}
            continue
        hit = next((c for c in rule["cases"]
                    if all(lo <= style[t] < hi for t, (lo, hi) in c["when"].items())), None)
        out[rule["decision"]] = {"value": hit["value"] if hit else rule["default"], "active": hit is not None,
                                 "reason": hit["reason"] if hit else "Store default"}
    return out


# ---------- export ----------

def export(work: Path = K.WORK, web: Path = K.WEB) -> Path:
    report = json.loads((work / "report.json").read_text())
    model = {"version": 1, "features": FEATURES, "visit_gap_s": K.VISIT_GAP_S, "min_r2": MIN_R2,
             "policy": POLICY, "targets": {}}
    for tgt in K.TARGETS:
        b = lgb.Booster(model_file=str(work / "models" / f"{tgt}.txt"))
        trees = [flatten(t) for t in b.dump_model()["tree_info"]]
        rt = report["targets"][tgt]
        # gate on single-visit R² when measured (the demo is one short visit); fall back to all prefixes
        gate = rt.get("r2_single_visit") or rt["r2_by_events"]
        model["targets"][tgt] = {"trees": trees,
                                 # unmeasured lengths are left out: the gate then uses the largest measured one
                                 "r2_by_events": {str(k): v for k, v in gate.items() if v is not None},
                                 "r2_all_prefixes": {str(k): v for k, v in rt["r2_by_events"].items()}}
    web.mkdir(parents=True, exist_ok=True)
    out = web / "session_model.json"
    out.write_text(json.dumps(model, separators=(",", ":")))
    _fixtures(model, work, web)
    print(f"export: {out} ({out.stat().st_size / 1e6:.2f} MB)", flush=True)
    return out


def _fixtures(model: dict, work: Path, web: Path, n: int = 40):
    """Real prefixes + the Python predictions/decisions, so web/check.mjs can prove the JS runtime matches,
    and LightGBM's own predictions to prove the flattened trees match the trained models."""
    import pandas as pd
    pe = pd.read_parquet(work / "prefix_events.parquet").sort_values(["session", "rn"])
    cases = []
    for sess, g in list(pe.groupby("session", sort=True))[:n]:
        ev = list(zip(g["ts"].tolist(), g["aid"].tolist(), g["type"].tolist()))
        for k in (3, 10, len(ev)):
            x = session_features(ev[:k])
            style = predict(model, x)
            cases.append({"events": [list(e) for e in ev[:k]], "features": [None if math.isnan(v) else v for v in x],
                          "style": style, "decisions": decide(model, style, k)})
    xs = np.array([[np.nan if v is None else v for v in c["features"]] for c in cases], dtype=np.float64)
    for tgt in K.TARGETS:
        lgbp = np.clip(lgb.Booster(model_file=str(work / "models" / f"{tgt}.txt")).predict(xs), 0, 1)
        ours = np.array([c["style"][tgt] for c in cases])
        if not np.allclose(lgbp, ours, atol=1e-9):
            raise AssertionError(f"flattened trees disagree with LightGBM for {tgt}: max diff {np.abs(lgbp - ours).max()}")
    (web / "fixtures.json").write_text(json.dumps(cases))
