"""python -m pytest deploy/tests

The Snowpark procedures, run locally. The DB shim (snowpark_db.DB) and the handlers' logic
(jobs.py) are the ones the procedures use; only the Snowpark session is swapped for a small
stand-in over a DuckDB file with the same tables. The refresh test needs the serving bundle
(python -m server bundle) and is skipped without it.
"""
import datetime as dt
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

DEPLOY = Path(__file__).resolve().parents[1]
REPO = DEPLOY.parent
for p in (str(REPO), str(DEPLOY)):
    if p not in sys.path:
        sys.path.insert(0, p)

import jobs  # noqa: E402
import snowpark_db  # noqa: E402
from server.config import WORK  # noqa: E402

need_bundle = pytest.mark.skipif(not (WORK / "bundle.pkl").exists(), reason="no serving bundle (python -m server bundle)")


# ---------------------------------------------------------------- a Snowpark session over DuckDB

class _Result:
    def __init__(self, con, sql, params):
        self.con, self.sql, self.params = con, sql, params

    def collect(self):
        self.con.execute(self.sql, self.params)
        return []

    def to_pandas(self):
        return self.con.execute(self.sql, self.params).df()


class _Writer:
    def __init__(self, con, df):
        self.con, self.df = con, df

    def mode(self, _mode):
        return self

    def save_as_table(self, name):
        self.con.register("stg_df", self.df)
        self.con.execute(f"CREATE TABLE {name} AS SELECT * FROM stg_df")
        self.con.unregister("stg_df")


class _Frame:
    def __init__(self, con, df):
        self.write = _Writer(con, df)


class FakeSession:
    """The three Snowpark calls snowpark_db.DB makes: sql().collect(), sql().to_pandas(), create_dataframe().write."""

    def __init__(self, con):
        self.con = con
        self.statements: list[str] = []

    def sql(self, sql, params=None):
        self.statements.append(sql)
        return _Result(self.con, sql, params or [])

    def create_dataframe(self, df):
        return _Frame(self.con, df)


def _deploy_script():
    spec = importlib.util.spec_from_file_location("deploy_script", DEPLOY / "deploy.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def local(tmp_path, monkeypatch):
    """(sf.DB on DuckDB with the real schema, the same connection behind the Snowpark shim)."""
    monkeypatch.setenv("ATELIER_DB", "local")
    import server.sf as sf
    monkeypatch.setattr(sf, "WORK", tmp_path)
    sfdb = sf.DB()
    sfdb.setup()
    # INTEREST_PREDICTIONS is created by deploy.py, not schema.sql: same DDL, DuckDB type names
    ddl = (_deploy_script().DDL_TABLE.replace("TIMESTAMP_NTZ", "TIMESTAMP").replace("STRING", "VARCHAR")
           .replace(" FLOAT", " DOUBLE"))
    sfdb.execute(ddl)
    sfdb.execute("CREATE OR REPLACE MACRO PARSE_JSON(x) AS CAST(x AS JSON)")
    yield sfdb, snowpark_db.DB(FakeSession(sfdb.con))
    sfdb.close()


def _staging_tables(sfdb) -> list[str]:
    t = sfdb.query("SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'STG_%'")
    return t["table_name"].tolist()


CATALOG = pd.DataFrame({
    "product_id": ["w-a", "w-b", "m-c", "m-d"], "name": ["A", "B", "C", "D"],
    "department": ["women", "women", "men", "men"], "category": ["dresses", "jeans", "jackets", "tees"],
    "collection": ["Studio"] * 4, "price": [100.0, 80.0, 120.0, 40.0], "sale_price": [np.nan, 60.0, np.nan, 30.0],
    "colors": [["black"], ["navy", "grey"], ["olive"], ["navy"]], "is_new": [True, False, False, True],
    "popularity": [80.0, 60.0, 70.0, 50.0]})


def _events(shoppers: dict[str, list[str]]) -> pd.DataFrame:
    """shopper -> the product ids they touched in order; views, with every third one a bag add."""
    rows, t0 = [], dt.datetime(2026, 11, 1, 9, 0, 0)
    for user, products in shoppers.items():
        for i, pid in enumerate(products):
            rows.append({
                "event_id": f"{user}-{i}", "user_id": user, "session_id": f"s-{user}",
                "type": "add_to_bag" if i % 3 == 2 else "product_viewed",
                "ts": t0 + dt.timedelta(minutes=i), "route": "/store", "product_id": pid, "color": None,
                "properties": {"productId": pid}, "inserted_at": t0})
    return pd.DataFrame(rows)


WOMEN, MEN = ["w-a", "w-b"] * 6, ["m-c", "m-d"] * 6          # 12 events each
SHOPPERS = {"anna": WOMEN, "bea": WOMEN, "cleo": WOMEN, "dan": MEN, "eli": MEN, "finn": MEN}


def _seed(sfdb, shoppers=SHOPPERS):
    sfdb.replace("CATALOG", CATALOG, variant=("colors",))
    sfdb.insert("EVENTS", _events(shoppers), variant=("properties",))


# ---------------------------------------------------------------- the DB shim

def test_shim_writes_variant_columns_and_drops_its_staging_tables(local):
    sfdb, db = local
    run = {"run_id": "r1", "kind": "refresh", "started_at": dt.datetime(2026, 11, 1), "finished_at": dt.datetime(2026, 11, 1),
           "status": "ok", "model_version": "v", "details": {"users": 3, "nested": {"a": [1, 2]}}}
    assert db.insert("MODEL_RUNS", pd.DataFrame([run]), variant=("details",)) == 1
    back = db.query("SELECT RUN_ID, DETAILS FROM MODEL_RUNS WHERE RUN_ID = %s", ["r1"])
    assert list(back.columns) == ["run_id", "details"]            # lower-case, like sf.DB
    assert json.loads(back["details"].iloc[0]) == {"users": 3, "nested": {"a": [1, 2]}}
    assert _staging_tables(sfdb) == []


def test_shim_upsert_replaces_by_key_and_replace_swaps_the_table(local):
    sfdb, db = local
    preds = pd.DataFrame({"user_id": ["u1", "u2"], "pred_department": ["women", "men"], "confidence": [0.9, 0.8],
                          "trained_on": ["a", "a"], "updated_at": [dt.datetime(2026, 11, 1)] * 2})
    db.insert("INTEREST_PREDICTIONS", preds)
    db.upsert("INTEREST_PREDICTIONS", preds.iloc[[1]].assign(pred_department="women", trained_on="b"), "user_id")
    got = db.query("SELECT USER_ID, PRED_DEPARTMENT, TRAINED_ON FROM INTEREST_PREDICTIONS ORDER BY USER_ID")
    assert got.values.tolist() == [["u1", "women", "a"], ["u2", "women", "b"]]
    db.replace("INTEREST_PREDICTIONS", preds.iloc[[0]].assign(trained_on="c"))
    assert db.query("SELECT USER_ID, TRAINED_ON FROM INTEREST_PREDICTIONS").values.tolist() == [["u1", "c"]]
    assert db.insert("INTEREST_PREDICTIONS", preds.iloc[:0]) == 0   # an empty frame writes nothing
    assert _staging_tables(sfdb) == []


def test_shim_drops_the_staging_table_when_the_write_fails(local):
    sfdb, db = local
    with pytest.raises(Exception):
        db.insert("NO_SUCH_TABLE", pd.DataFrame({"a": [1]}))
    with pytest.raises(Exception):
        db.upsert("NO_SUCH_TABLE", pd.DataFrame({"a": [1]}), "a")
    assert _staging_tables(sfdb) == []


def test_shim_state_round_trips_and_translates_placeholders(local):
    _, db = local
    assert db.get_state("last_inserted_at", "1970") == "1970"
    db.set_state("last_inserted_at", "2026-11-01 09:00:00")
    db.set_state("last_inserted_at", "2026-11-01 09:04:00")
    assert db.get_state("last_inserted_at") == "2026-11-01 09:04:00"
    # callers write %s like sf.DB; Snowpark's session.sql wants ?
    assert all("%s" not in s for s in db.session.statements)


# ---------------------------------------------------------------- the interest retrain

def test_interest_rows_take_features_from_early_events_and_the_label_from_late_ones(local):
    sfdb, db = local
    switcher = ["w-a", "w-b"] * 4 + ["m-c", "m-d"] * 2             # browses women, ends on men
    _seed(sfdb, {**SHOPPERS, "gus": switcher, "newbie": ["w-a"] * 5})
    ev = db.query("SELECT USER_ID, TYPE, TS, PRODUCT_ID FROM EVENTS ORDER BY USER_ID, TS")
    cat = db.query("SELECT PRODUCT_ID, DEPARTMENT, CATEGORY, PRICE, SALE_PRICE FROM CATALOG")
    rows = jobs.interest_rows(ev, cat).set_index("user_id")
    assert "newbie" not in rows.index                               # under MIN_EVENTS: not a training row
    assert rows.loc["anna", "label"] == "women" and rows.loc["dan", "label"] == "men"
    assert rows.loc["anna", "women_share"] == 1.0 and rows.loc["dan", "men_share"] == 1.0
    assert rows.loc["gus", "label"] == "men" and rows.loc["gus", "women_share"] == 1.0
    assert rows.loc["anna", "n_events"] == 8                         # first 70% of 12


def test_train_interest_writes_predictions_a_run_record_and_a_model(local):
    sfdb, db = local
    _seed(sfdb)
    saved = []

    def save(blob, run_id):
        saved.append((blob, run_id))
        return f"@stage/models/{run_id}.pkl"

    info = jobs.train_interest(db, save, now=dt.datetime(2026, 11, 2, 6, 0, 0))
    assert info["status"] == "ok" and info["n_shoppers"] == 6
    assert info["run_id"] == info["version"] == "interest_20261102_060000"
    assert info["artifact"] == "@stage/models/interest_20261102_060000.pkl"
    assert saved[0][1] == info["run_id"] and saved[0][0]["features"] == jobs.INTEREST_FEATURES
    preds = db.query("SELECT USER_ID, PRED_DEPARTMENT, CONFIDENCE, TRAINED_ON FROM INTEREST_PREDICTIONS").set_index("user_id")
    assert preds["pred_department"].to_dict() == {"anna": "women", "bea": "women", "cleo": "women",
                                                  "dan": "men", "eli": "men", "finn": "men"}
    assert preds["confidence"].between(0.5, 1.0).all() and set(preds["trained_on"]) == {info["run_id"]}
    runs = db.query("SELECT KIND, STATUS, MODEL_VERSION, DETAILS FROM MODEL_RUNS")
    assert runs[["kind", "status", "model_version"]].values.tolist() == [["interest_retrain", "ok", info["run_id"]]]
    assert json.loads(runs["details"].iloc[0])["train_accuracy"] == info["train_accuracy"]

    # the next night replaces the predictions instead of adding to them
    again = jobs.train_interest(db, save, now=dt.datetime(2026, 11, 3, 6, 0, 0))
    after = db.query("SELECT TRAINED_ON FROM INTEREST_PREDICTIONS")
    assert len(after) == 6 and set(after["trained_on"]) == {again["run_id"]}
    assert _staging_tables(sfdb) == []


def test_train_interest_skips_without_enough_shoppers_and_leaves_predictions_alone(local):
    sfdb, db = local
    _seed(sfdb, {"anna": WOMEN, "bea": WOMEN, "cleo": WOMEN, "dora": WOMEN})   # four shoppers, one department
    old = pd.DataFrame({"user_id": ["keep"], "pred_department": ["men"], "confidence": [0.7], "trained_on": ["earlier"],
                        "updated_at": [dt.datetime(2026, 11, 1)]})
    db.insert("INTEREST_PREDICTIONS", old)
    info = jobs.train_interest(db, lambda blob, run_id: pytest.fail("no model to save"))
    assert info["status"].startswith("skipped") and info["version"] is None
    assert db.query("SELECT USER_ID FROM INTEREST_PREDICTIONS")["user_id"].tolist() == ["keep"]
    assert db.query("SELECT STATUS FROM MODEL_RUNS")["status"].iloc[0].startswith("skipped")


def test_train_interest_records_an_error_instead_of_raising(local, monkeypatch):
    _, db = local

    def down(sql, params=None):
        raise RuntimeError("warehouse down")

    monkeypatch.setattr(db, "query", down)
    info = jobs.train_interest(db)
    monkeypatch.undo()
    assert info["status"] == "error" and "warehouse down" in info["error"]
    runs = db.query("SELECT KIND, STATUS FROM MODEL_RUNS")
    assert runs.values.tolist() == [["interest_retrain", "error"]]


def test_train_interest_with_no_events_is_a_skip_not_an_error(local):
    _, db = local
    info = jobs.train_interest(db)
    assert info["status"].startswith("skipped") and info["n_shoppers"] == 0


# ---------------------------------------------------------------- the refresh tick

@need_bundle
def test_refresh_tick_through_the_shim_matches_the_laptop_path(local):
    """The same tick REFRESH_SHOPPERS runs: simulate -> refresh_once(db=shim) -> layouts, history, state."""
    sfdb, db = local
    from server import bundle, refresh, score, simulate
    B = bundle.load()
    sfdb.replace("CATALOG", CATALOG, variant=("colors",))
    simulate.run(sfdb, 5)
    sm = score.load_session_model()
    info = refresh.refresh_once(db=db, B=B, session_model=sm, verbose=False)
    assert info["users"] == 5
    assert refresh.refresh_once(db=db, B=B, session_model=sm, verbose=False)["users"] == 0     # nothing new
    lay = db.query("SELECT USER_ID, N_EVENTS, HOMEPAGE FROM USER_LAYOUTS")
    assert len(lay) == 5
    doc = json.loads(lay["homepage"].iloc[0])
    assert doc["format"] == "atelier.store_layout.v1" and "shopper" in doc and "layout" in doc
    assert len(db.query("SELECT USER_ID FROM USER_LAYOUTS_HISTORY")) == 5
    assert db.get_state("last_inserted_at") is not None
    runs = db.query("SELECT KIND, STATUS FROM MODEL_RUNS ORDER BY STARTED_AT")
    assert runs.values.tolist() == [["refresh", "ok"], ["refresh", "ok"]]
    assert _staging_tables(sfdb) == []
