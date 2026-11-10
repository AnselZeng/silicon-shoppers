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


INTEREST_FEATURES = ["n_events", "view_share", "cart_share", "women_share", "men_share",
                     "sale_share", "price_mean", "span_hours"]
MIN_EVENTS = 10          # a shopper needs this many events to be a training row
MIN_SHOPPERS = 4         # and the model needs this many rows, with both departments present


def interest_rows(ev, cat):
    """One training row per shopper: features from their first 70% of events, label = the
    department they shopped most in the last 30%. Shoppers with too little history are left out."""
    import pandas as pd

    a = cat.set_index(cat["product_id"].astype(str))
    ev = ev.merge(a[["department", "price", "sale_price"]],
                  left_on=ev["product_id"].astype(str), right_index=True, how="left")
    rows = []
    for u, g in ev.groupby("user_id"):
        g = g.sort_values("ts")
        n = len(g)
        if n < MIN_EVENTS:
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
    cols = ["user_id", *INTEREST_FEATURES, "label"]
    return pd.DataFrame(rows, columns=cols).dropna(subset=["label"])


def train_interest(db, save_model=None, now=None) -> dict:
    """Train the next-department model on every shopper's events and write its predictions.

    db is any object with query/replace/insert (snowpark_db.DB in Snowflake, the same shim over
    DuckDB in tests). save_model(blob, run_id) stores the trained model and returns where.
    train_accuracy is measured on the rows the model was fitted on, so it says the fit ran,
    not how well the model predicts a shopper it has not seen."""
    import datetime as dt
    import pandas as pd

    now = now or dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    run_id = f"interest_{now:%Y%m%d_%H%M%S}"
    info = {"run_id": run_id, "status": "ok", "n_shoppers": 0, "train_accuracy": None, "version": None}
    try:
        ev = db.query("SELECT USER_ID, TYPE, TS, PRODUCT_ID FROM EVENTS ORDER BY USER_ID, TS")
        cat = db.query("SELECT PRODUCT_ID, DEPARTMENT, CATEGORY, PRICE, SALE_PRICE FROM CATALOG")
        df = interest_rows(ev, cat)
        info["n_shoppers"] = int(len(df))
        if len(df) >= MIN_SHOPPERS and df["label"].nunique() >= 2:
            from sklearn.ensemble import GradientBoostingClassifier
            X, y = df[INTEREST_FEATURES].fillna(0.0), df["label"]
            model = GradientBoostingClassifier(n_estimators=120, max_depth=3)
            model.fit(X, y)
            info["train_accuracy"] = float(model.score(X, y))
            if save_model is not None:
                # versioned artifact: the trained model itself goes back into the stage
                info["artifact"] = save_model({"model": model, "features": INTEREST_FEATURES, "n_shoppers": len(df),
                                               "train_accuracy": info["train_accuracy"]}, run_id)
            info["version"] = run_id
            preds = df[["user_id"]].copy()
            preds["pred_department"] = model.predict(X)
            probs = model.predict_proba(X)
            preds["confidence"] = [round(float(p.max()), 4) for p in probs]
            preds["trained_on"] = run_id
            preds["updated_at"] = pd.Timestamp(now)
            db.replace("INTEREST_PREDICTIONS", preds)
        else:
            info["status"] = "skipped: not enough labeled shoppers yet"
    except Exception as e:
        info["status"] = "error"
        info["error"] = repr(e)[:1000]
    _record(db, run_id, info)
    return info


def retrain_interest(session) -> str:
    """Nightly task: learn each shopper's likely department from live store events.

    Store-native signal, retrained from scratch on everything in EVENTS. Each trained model is
    kept in the stage under models/, and the store reads INTEREST_PREDICTIONS through /api/layout.
    """
    B, sm, db, dt = _bootstrap(session)

    def save_model(blob: dict, run_id: str) -> str:
        path = f"{ART_DIR}/{run_id}.pkl"
        with open(path, "wb") as fh:
            pickle.dump(blob, fh)
        session.file.put(path, f"{STAGE}/models", auto_compress=False, overwrite=True)
        return f"{STAGE}/models/{run_id}.pkl"

    return json.dumps(train_interest(db, save_model), default=str)


def _record(db, run_id: str, info: dict):
    import pandas as pd
    db.insert("MODEL_RUNS", pd.DataFrame([{
        "run_id": run_id, "kind": "interest_retrain",
        "started_at": pd.Timestamp.utcnow().tz_localize(None),
        "finished_at": pd.Timestamp.utcnow().tz_localize(None),
        "status": info["status"], "model_version": info.get("version") or "none",
        "details": info}]), variant=("details",))
