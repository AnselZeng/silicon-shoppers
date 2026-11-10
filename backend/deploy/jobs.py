"""Stored-procedure handlers. Bundled in pkg.zip; Snowflake calls these by name.

Each handler unpacks the code bundle to a real directory (config files inside a
zip cannot be read), fetches the model artifacts from the stage to /tmp, then
runs the same refresh tick / interest retrain the laptop runs.
"""
from __future__ import annotations

import json
import os
import pickle
import shutil
import sys
import zipfile

STAGE = "@ATELIER.LIVE.MODELS"
WORK_DIR = "/tmp/atelier"
ART_DIR = "/tmp/atelier-art"


def _bootstrap(session):
    """Extract pkg.zip to a real dir, fetch artifacts, patch loaders. Returns (B, session_model, db)."""
    import pandas as pd  # noqa: F401  (proc environment check)
    import datetime as dt

    shutil.rmtree(WORK_DIR, ignore_errors=True)
    os.makedirs(WORK_DIR, exist_ok=True)
    os.makedirs(ART_DIR, exist_ok=True)

    import_dir = sys._xoptions["snowflake_import_directory"]
    with zipfile.ZipFile(os.path.join(import_dir, "pkg.zip")) as z:
        z.extractall(WORK_DIR)
    for p in (WORK_DIR, os.path.join(WORK_DIR, "src")):
        if p not in sys.path:
            sys.path.insert(0, p)

    for name in ("bundle.pkl", "cfg.pkl", "session_model.json"):
        session.file.get(f"{STAGE}/artifacts/{name}", ART_DIR)

    import model.common as C
    import pathlib
    # artifacts were pickled on Windows; pathlib refuses WindowsPath on Linux
    pathlib.WindowsPath = pathlib.PosixPath
    cfg = pickle.load(open(os.path.join(ART_DIR, "cfg.pkl"), "rb"))
    C.load_cfg = lambda: cfg  # repo config files don't exist here; use the frozen one

    B = pickle.load(open(os.path.join(ART_DIR, "bundle.pkl"), "rb"))
    session_model = json.load(open(os.path.join(ART_DIR, "session_model.json")))

    from snowpark_db import DB
    return B, session_model, DB(session), dt


def refresh_shoppers(session) -> str:
    """Snowflake task REFRESH_LAYOUTS -> the refresh tick, inside Snowflake."""
    B, sm, db, dt = _bootstrap(session)
    from server import refresh

    # refresh_once's own clock helper is a module-level import; keep it simple and let it use UTC
    info = refresh.refresh_once(db=db, B=B, session_model=sm, verbose=False)
    return json.dumps({"tick": "refresh", **info}, default=str)


def retrain_interest(session) -> str:
    """Nightly task: learn each shopper's likely department from live store events.

    Store-native signal: features come from the shopper's first 70% of events,
    the label is their dominant department in the last 30%. Not used by the
    demo storefront; the registry keeps every version so the signal grows with data.
    """
    B, sm, db, dt = _bootstrap(session)
    import numpy as np
    import pandas as pd
    from snowpark_db import DB  # already bound

    run_id = f"interest_{dt.datetime.utcnow():%Y%m%d_%H%M%S}"
    ev = db.query("SELECT USER_ID, TYPE, TS, PRODUCT_ID FROM EVENTS ORDER BY USER_ID, TS")
    cat = db.query("SELECT PRODUCT_ID, DEPARTMENT, CATEGORY, PRICE, SALE_PRICE FROM CATALOG")
    info = {"run_id": run_id, "status": "ok", "n_shoppers": 0, "accuracy": None, "version": None}
    try:
        a = cat.set_index(cat["product_id"].astype(str))
        ev = ev.merge(a[["department", "price", "sale_price"]],
                      left_on=ev["product_id"].astype(str), right_index=True, how="left")
        rows = []
        for u, g in ev.groupby("user_id"):
            g = g.sort_values("ts")
            n = len(g)
            if n < 10:
                continue
            head, tail = g.iloc[: int(n * 0.7)], g.iloc[int(n * 0.7):]
            if len(tail) < 3:
                continue
            clicks = head["type"].isin(["product_viewed", "quickview_opened"])
            carts = head["type"].isin(["add_to_bag", "purchase", "checkout"])
            dept = head.loc[clicks | carts, "department"].value_counts(normalize=True)
            rows.append({
                "user_id": u,
                "n_events": len(head),
                "view_share": float(clicks.mean()),
                "cart_share": float(carts.mean()),
                "women_share": float(dept.get("women", 0.0)),
                "men_share": float(dept.get("men", 0.0)),
                "sale_share": float(head.loc[carts, "sale_price"].notna().mean()) if carts.any() else 0.0,
                "price_mean": float(head["price"].mean()) if head["price"].notna().any() else 0.0,
                "span_hours": float((pd.to_datetime(head["ts"].iloc[-1]) - pd.to_datetime(head["ts"].iloc[0])).total_seconds() / 3600),
                "label": tail.loc[tail["department"].notna(), "department"].value_counts().idxmax()
                       if tail["department"].notna().any() else None,
            })
        df = pd.DataFrame(rows).dropna(subset=["label"])
        info["n_shoppers"] = int(len(df))
        FEATS = ["n_events", "view_share", "cart_share", "women_share", "men_share",
                 "sale_share", "price_mean", "span_hours"]
        if len(df) >= 4 and df["label"].nunique() >= 2:
            from sklearn.ensemble import GradientBoostingClassifier
            X, y = df[FEATS].fillna(0.0), df["label"]
            model = GradientBoostingClassifier(n_estimators=120, max_depth=3)
            model.fit(X, y)
            info["accuracy"] = float(model.score(X, y))
            # versioned artifact: the trained model itself goes back into the stage
            mpath = f"{ART_DIR}/interest_{run_id}.pkl"
            pickle.dump({"model": model, "features": FEATS, "n_shoppers": len(df),
                         "accuracy": info["accuracy"]}, open(mpath, "wb"))
            session.file.put(mpath, f"{STAGE}/models", auto_compress=False, overwrite=True)
            info["version"] = run_id
            info["artifact"] = f"{STAGE}/models/interest_{run_id}.pkl"
            preds = df[["user_id"]].copy()
            preds["pred_department"] = model.predict(X)
            probs = model.predict_proba(X)
            preds["confidence"] = [round(float(p.max()), 4) for p in probs]
            preds["trained_on"] = run_id
            preds["updated_at"] = pd.Timestamp.utcnow().tz_localize(None)
            db.replace("INTEREST_PREDICTIONS", preds)
        else:
            info["status"] = "skipped: not enough labeled shoppers yet"
        _record(db, run_id, info)
        return json.dumps(info, default=str)
    except Exception as e:
        info["status"] = "error"
        info["error"] = repr(e)[:1000]
        _record(db, run_id, info)
        return json.dumps(info, default=str)


def _record(db, run_id: str, info: dict):
    import pandas as pd
    db.insert("MODEL_RUNS", pd.DataFrame([{
        "run_id": run_id, "kind": "interest_retrain",
        "started_at": pd.Timestamp.utcnow().tz_localize(None),
        "finished_at": pd.Timestamp.utcnow().tz_localize(None),
        "status": info["status"], "model_version": info.get("version") or "none",
        "details": info}]), variant=("details",))
