"""The laptop's refresh job: Snowflake events -> frozen models -> per-shopper layouts back in Snowflake.

    python -m server refresh            # once
    python -m server loop               # every REFRESH_EVERY_S seconds (default 120) until Ctrl+C

Each tick:
  1. find shoppers with events inserted since the last tick (2-minute overlap, so nothing is missed)
  2. pull each of those shoppers' full event history (capped at 330 days, like the H&M features)
  3. score them (score.build_docs): H&M purchase models + live session model + their own sort/filter choices
  4. upsert USER_LAYOUTS (what the store reads), append USER_LAYOUTS_HISTORY, rewrite TRENDING
  5. record the tick in MODEL_RUNS
The models are not retrained here: they stay as frozen and tested. What adapts is each shopper's own
evidence (more add-to-bags, more clicks, more visits) and store-wide trending.
"""
from __future__ import annotations

import datetime as dt
import json
import time
import traceback
import uuid

import pandas as pd

from . import bundle, catalog as K, score
from .config import REFRESH_EVERY_S, TRENDING_MINUTES
from .sf import DB

OVERLAP = dt.timedelta(minutes=2)
EPOCH = "1970-01-01 00:00:00"


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


def load_catalog(db: DB, B: dict) -> pd.DataFrame:
    cat = db.query("SELECT PRODUCT_ID, NAME, DEPARTMENT, CATEGORY, COLLECTION, PRICE, SALE_PRICE, COLORS, IS_NEW, "
                   "POPULARITY FROM CATALOG")
    if cat.empty:
        raise SystemExit("CATALOG is empty: run `python -m server catalog` first")
    cat["colors"] = cat["colors"].apply(lambda c: json.loads(c) if isinstance(c, str) else list(c))
    cat["is_new"] = cat["is_new"].astype(bool)
    return K.hm_attributes(cat, B["vocab"], B["fam_of_master"])


def _events_for(db: DB, users: list[str], since: dt.datetime) -> pd.DataFrame:
    frames = []
    for i in range(0, len(users), 500):
        part = users[i:i + 500]
        ph = ", ".join(["%s"] * len(part))
        frames.append(db.query(f"SELECT USER_ID, SESSION_ID, TYPE, TS, PRODUCT_ID, COLOR, PROPERTIES FROM EVENTS "
                               f"WHERE USER_ID IN ({ph}) AND TS >= %s ORDER BY USER_ID, TS", part + [since]))
    ev = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(
        columns=["user_id", "session_id", "type", "ts", "product_id", "color", "properties"])
    ev["ts"] = pd.to_datetime(ev["ts"])
    ev["properties"] = ev["properties"].apply(lambda p: json.loads(p) if isinstance(p, str) and p else (p or {}))
    return ev


def trending(db: DB, now: dt.datetime) -> dict:
    since = now - dt.timedelta(minutes=TRENDING_MINUTES)
    t = db.query("SELECT PRODUCT_ID, "
                 "SUM(CASE WHEN TYPE IN ('product_viewed', 'quickview_opened') THEN 1 ELSE 0 END) AS VIEWS, "
                 "SUM(CASE WHEN TYPE IN ('add_to_bag', 'purchase', 'checkout') THEN 1 ELSE 0 END) AS CARTS "
                 "FROM EVENTS WHERE TS >= %s AND PRODUCT_ID IS NOT NULL GROUP BY PRODUCT_ID", [since])
    if t.empty:
        db.execute("DELETE FROM TRENDING")
        return {}
    t["views"], t["carts"] = t["views"].astype(int), t["carts"].astype(int)
    t["score"] = t["views"] + 3.0 * t["carts"]
    t = t.sort_values("score", ascending=False).reset_index(drop=True)
    t["rank"] = range(1, len(t) + 1)
    t["window_minutes"] = TRENDING_MINUTES
    t["updated_at"] = now
    db.replace("TRENDING", t[["product_id", "views", "carts", "score", "rank", "window_minutes", "updated_at"]])
    return dict(zip(t["product_id"], t["score"]))


def refresh_once(db: DB | None = None, B: dict | None = None, session_model: dict | None = None,
                 users: list[str] | None = None, verbose: bool = True) -> dict:
    """One tick. `users` forces a rescore of those shoppers (e.g. after a retrain)."""
    own = db is None
    db = db or DB()
    B = B or bundle.load()
    session_model = session_model if session_model is not None else score.load_session_model()
    run_id = f"refresh-{_now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}"
    started = _now()
    try:
        mark = db.get_state("last_inserted_at", EPOCH)
        now = _now()
        if users is None:
            # shoppers with recent inserts whose event count differs from what their stored layout saw
            since = pd.Timestamp(mark).to_pydatetime() - OVERLAP
            new = db.query(
                "SELECT e.USER_ID, e.N, e.M FROM (SELECT USER_ID, COUNT(*) AS N, MAX(INSERTED_AT) AS M FROM EVENTS "
                "WHERE USER_ID IN (SELECT DISTINCT USER_ID FROM EVENTS WHERE INSERTED_AT > %s) AND TS >= %s "
                "GROUP BY USER_ID) e LEFT JOIN USER_LAYOUTS l ON l.USER_ID = e.USER_ID "
                "WHERE l.N_EVENTS IS NULL OR l.N_EVENTS <> e.N", [since, now - dt.timedelta(days=330)])
            users = new["user_id"].tolist()
            top = pd.to_datetime(new["m"]).max() if len(new) else None
        else:
            top = None
        tr = trending(db, now)
        if not users:
            if verbose:
                print(f"[{now:%H:%M:%S}] no new events; trending: {len(tr)} products", flush=True)
            _record(db, run_id, "refresh", started, "ok", B, {"users": 0, "trending": len(tr)})
            return {"users": 0}
        attrs = load_catalog(db, B)
        ev = _events_for(db, users, now - dt.timedelta(days=330))
        docs = score.build_docs(B, session_model, ev, attrs, users, tr, run_id, now)
        docs["updated_at"] = now
        docs["run_id"] = run_id
        cols = ["user_id", "updated_at", "run_id", "n_events", "n_carts", "homepage"]
        db.upsert("USER_LAYOUTS", docs[cols], "user_id", variant=("homepage",))
        db.insert("USER_LAYOUTS_HISTORY", docs[cols], variant=("homepage",))
        if top is not None and pd.notna(top):
            db.set_state("last_inserted_at", str(top))
        info = {"users": len(users), "events": int(len(ev)), "add_to_bags": int(docs["n_carts"].sum()),
                "trending": len(tr), "seconds": round((_now() - started).total_seconds(), 2)}
        _record(db, run_id, "refresh", started, "ok", B, info)
        if verbose:
            print(f"[{now:%H:%M:%S}] {run_id}: {info['users']} shoppers rescored from {info['events']} events "
                  f"({info['add_to_bags']} add-to-bags) in {info['seconds']}s", flush=True)
            from .layout_v1 import CAT_LABELS, DEPT_LABELS
            label = lambda x: DEPT_LABELS.get(x) or CAT_LABELS.get(x) or str(x)
            for r in docs.itertuples():
                h = r.homepage
                sh = h.get("shopper", {})
                persona = (sh.get("persona") or {}).get("name") or sh.get("label", "?")
                conf = sh.get("confidence", "low")
                changed = []
                for k, v in (h.get("layout") or {}).items():
                    if v.get("changed"):
                        val = v["value"]
                        changed.append(f"{k}={label(val) if not isinstance(val, list) else '/'.join(map(label, val[:2]))}")
                print(f"  {r.user_id:<28} {persona} ({conf})  {sh.get('persona_reason', '')}", flush=True)
                if changed:
                    print(f"    {' | '.join(changed[:4])}", flush=True)
        return info
    except Exception as e:
        _record(db, run_id, "refresh", started, "error", B, {"error": repr(e)[:2000]})
        raise
    finally:
        if own:
            db.close()


def _record(db: DB, run_id: str, kind: str, started, status: str, B: dict, details: dict):
    try:
        db.insert("MODEL_RUNS", pd.DataFrame([{
            "run_id": run_id, "kind": kind, "started_at": started, "finished_at": _now(), "status": status,
            "model_version": B["frozen_manifest"].get("frozen_at", "?") if B else "?", "details": details}]),
            variant=("details",))
    except Exception:
        traceback.print_exc()


def loop(every: int = REFRESH_EVERY_S):
    """Refresh forever. Reconnects after errors (network drops, warehouse hiccups) and keeps going."""
    B = bundle.load()
    sm = score.load_session_model()
    print(f"refresh loop: every {every}s, models frozen at {B['frozen_manifest'].get('frozen_at')}, "
          f"session model {'loaded' if sm else 'MISSING'}. Ctrl+C to stop.", flush=True)
    db = None
    while True:
        t0 = time.time()
        try:
            db = db or DB()
            refresh_once(db, B, sm)
        except KeyboardInterrupt:
            break
        except SystemExit:
            raise
        except Exception:
            traceback.print_exc()
            try:
                db.close()
            except Exception:
                pass
            db = None
        try:
            time.sleep(max(1.0, every - (time.time() - t0)))
        except KeyboardInterrupt:
            break
    if db:
        db.close()
