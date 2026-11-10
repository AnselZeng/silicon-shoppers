"""Deploy the refresh loop into Snowflake: stage upload, procedures, tasks.

    .venv\\Scripts\\python deploy\\deploy.py            # upload + create + show
    .venv\\Scripts\\python deploy\\deploy.py --tick     # also CALL REFRESH_SHOPPERS() once
    .venv\\Scripts\\python deploy\\deploy.py --suspend  # pause the task (save credits)

Pieces:
  1. @ATELIER.LIVE.MODELS gets pkg.zip (code), bundle.pkl, cfg.pkl, session_model.json
  2. REFRESH_SHOPPERS() runs the same refresh tick the laptop runs (score.build_docs)
  3. REFRESH_LAYOUTS task calls it on a 4-minute schedule (serverless XS compute)
  4. RETRAIN_INTEREST() + RETRAIN_INTEREST_NIGHTLY learn a store-native
     next-department predictor from live events, logged to MODEL_RUNS and the
     model registry; predictions land in INTEREST_PREDICTIONS.
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(REPO))

from server.config import env  # noqa: E402
from server.sf import _snowflake_connect, names  # noqa: E402

STAGE = "ATELIER.LIVE.MODELS"

ARTIFACTS = [
    (HERE / "out" / "pkg.zip", ""),
    (REPO / "server" / "work" / "bundle.pkl", "artifacts"),
    (REPO / "server" / "work" / "cfg.pkl", "artifacts"),
    (REPO / "session_model" / "web" / "session_model.json", "artifacts"),
]

PACKAGES = ("'snowflake-snowpark-python','pandas','numpy','pyarrow','lightgbm',"
            "'scikit-learn','pyyaml','snowflake-ml-python'")

DDL = f"""
CREATE OR REPLACE PROCEDURE REFRESH_SHOPPERS()
RETURNS STRING
LANGUAGE PYTHON RUNTIME_VERSION = '3.12'
PACKAGES = ({PACKAGES})
IMPORTS = ('@{STAGE}/pkg.zip')
HANDLER = 'jobs.refresh_shoppers'
COMMENT = 'Rescores shoppers with new events into USER_LAYOUTS. Ported from server/refresh.py.';
""".strip()

DDL_RETRAIN = f"""
CREATE OR REPLACE PROCEDURE RETRAIN_INTEREST()
RETURNS STRING
LANGUAGE PYTHON RUNTIME_VERSION = '3.12'
PACKAGES = ({PACKAGES})
IMPORTS = ('@{STAGE}/pkg.zip')
HANDLER = 'jobs.retrain_interest'
COMMENT = 'Store-native next-department model trained on live EVENTS.';
""".strip()

DDL_TABLE = """
CREATE TABLE IF NOT EXISTS INTEREST_PREDICTIONS (
  USER_ID STRING, PRED_DEPARTMENT STRING, CONFIDENCE FLOAT,
  TRAINED_ON STRING, UPDATED_AT TIMESTAMP_NTZ)
""".strip()

DDL_TASK = """
CREATE OR REPLACE TASK REFRESH_LAYOUTS
  WAREHOUSE = {wh}
  SCHEDULE = '4 MINUTE'
  COMMENT = 'Four-minute refresh of shopper layouts, replacing the laptop loop.'
AS CALL REFRESH_SHOPPERS()
""".strip()

DDL_TASK_RETRAIN = """
CREATE OR REPLACE TASK RETRAIN_INTEREST_NIGHTLY
  WAREHOUSE = {wh}
  SCHEDULE = 'USING CRON 0 6 * * * America/Los_Angeles'
  COMMENT = 'Nightly retrain of the store-native interest model.'
AS CALL RETRAIN_INTEREST()
""".strip()


def main():
    tick = "--tick" in sys.argv
    suspend = "--suspend" in sys.argv
    n = names()
    con = _snowflake_connect(n)
    cur = con.cursor()
    db, sch = n["database"], n["schema"]

    if suspend:
        cur.execute(f"ALTER TASK IF EXISTS {db}.{sch}.REFRESH_LAYOUTS SUSPEND")
        cur.execute(f"ALTER TASK IF EXISTS {db}.{sch}.RETRAIN_INTEREST_NIGHTLY SUSPEND")
        print("tasks suspended")
        con.close()
        return

    print(f"deploying into {db}.{sch} on {n['warehouse']}")
    cur.execute(f"CREATE STAGE IF NOT EXISTS {db}.{sch}.MODELS")
    cur.execute(f"USE DATABASE {db}")
    cur.execute(f"USE SCHEMA {sch}")
    for path, sub in ARTIFACTS:
        if not path.exists():
            raise SystemExit(f"missing artifact: {path}")
        target = f"@{STAGE}" + (f"/{sub}" if sub else "")
        print(f"  PUT {path.name} -> {target}")
        cur.execute(f"PUT 'file://{path.as_posix()}' {target} AUTO_COMPRESS=FALSE OVERWRITE=TRUE")

    for label, sql in [("INTEREST_PREDICTIONS", DDL_TABLE), ("REFRESH_SHOPPERS", DDL),
                       ("RETRAIN_INTEREST", DDL_RETRAIN)]:
        print(f"  CREATE {label}")
        cur.execute(sql)
    wh = n["warehouse"]
    print(f"  CREATE TASK REFRESH_LAYOUTS (4 MINUTE, warehouse {wh})")
    cur.execute(DDL_TASK.format(wh=wh))
    print("  CREATE TASK RETRAIN_INTEREST_NIGHTLY (daily 6am PT)")
    cur.execute(DDL_TASK_RETRAIN.format(wh=wh))
    cur.execute(f"ALTER TASK {db}.{sch}.REFRESH_LAYOUTS RESUME")
    cur.execute(f"ALTER TASK {db}.{sch}.RETRAIN_INTEREST_NIGHTLY RESUME")

    if tick:
        print("smoke test: CALL REFRESH_SHOPPERS() ...")
        row = cur.execute("CALL REFRESH_SHOPPERS()").fetchone()
        print(f"  -> {row[0]}")

    print("task status:")
    for r in cur.execute(f"SHOW TASKS IN SCHEMA {db}.{sch}").fetchall():
        print(f"  {r[1]:<32} {r[10]}")
    con.close()
    print("done")


if __name__ == "__main__":
    main()
