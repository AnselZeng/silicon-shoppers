"""python -m server <command>   (run from the repo root, venv active; see server/README.md)

One-time setup
  keygen          RSA key pair for Snowflake key-pair sign-in; prints the ALTER USER line to run in Snowsight
  check           sign in to Snowflake and print who/where you are
  setup           create the warehouse, database, schema and tables (server/schema.sql)
  catalog         upload the store catalog (../la-hacks-app/lib/store/catalog.ts) to CATALOG
  personas        fill the PERSONAS table from the H&M cohort (4 personas, counts, traits)
  app-user        print the SQL + key for a read/write service user the store's API routes use

Models
  retrain         hackathon-day retrain of every model on this laptop, then publish (see server/retrain.py)
  bundle          rebuild the serving bundle from the frozen models (the retrain does this)
  publish-run     upload the latest retrain record + H&M homepages, rescore every store shopper
  publish-hm      upload only the 100k H&M homepage documents

Live
  refresh         one refresh tick: new events -> layouts
  loop            refresh every REFRESH_EVERY_S seconds (default 120) until Ctrl+C
  rescore-all     rescore every shopper who ever sent an event
  status          counts and the latest runs
  show USER_ID    print one shopper's stored homepage document

Testing
  simulate        insert synthetic shoppers' events (ids start with sim-); --clear removes them
Add ATELIER_DB=local to use a local DuckDB file with the same tables instead of Snowflake.
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings

warnings.filterwarnings("ignore")


def main():
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(errors="replace")      # Windows consoles: never crash on a character
        except Exception:
            pass
    ap = argparse.ArgumentParser(prog="python -m server", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["keygen", "check", "setup", "catalog", "app-user", "personas", "retrain", "bundle",
                                    "publish-run", "publish-hm", "refresh", "loop", "rescore-all", "status", "show",
                                    "simulate"])
    ap.add_argument("arg", nargs="?")
    ap.add_argument("--every", type=int, default=None, help="loop: seconds between refreshes")
    ap.add_argument("--skip-hm", action="store_true", help="retrain: only the session model + bundle")
    ap.add_argument("--no-snowflake", action="store_true", help="retrain: don't upload at the end")
    ap.add_argument("--session-data", action="store_true", help="retrain: also resample OTTO (slow)")
    ap.add_argument("--users", type=int, default=20, help="simulate: number of shoppers")
    ap.add_argument("--clear", action="store_true", help="simulate: remove simulated shoppers")
    ap.add_argument("--catalog-ts", default=None, help="catalog: store app folder (e.g. ..\\silicon-shoppers\\frontend) or a products .json")
    a = ap.parse_args()

    if a.cmd == "keygen":
        from .sf import keygen
        from .config import env
        name = a.arg or "laptop"
        priv = keygen(name)
        pub = priv.with_suffix(".pub").read_text()
        user = env().get("SNOWFLAKE_USER", "<YOUR_USER>")
        print(f"private key: {priv}  (keep it secret; it's gitignored)\n")
        print("1. In Snowsight, open a SQL worksheet and run:\n")
        print(f"   ALTER USER {user} SET RSA_PUBLIC_KEY='{pub}';\n")
        print("2. Add to .env:\n")
        print(f"   SNOWFLAKE_PRIVATE_KEY_PATH=server/work/keys/{priv.name}")
        return

    if a.cmd == "retrain":
        from . import retrain
        s = retrain.run(skip_hm=a.skip_hm, snowflake=not a.no_snowflake, session_data=a.session_data or None)
        sys.exit(0 if s["status"] == "ok" else 1)
    if a.cmd == "bundle":
        from . import bundle
        bundle.build()
        return

    from .sf import DB
    db = DB()
    try:
        if a.cmd == "check":
            if db.kind == "local":
                print(f"local DuckDB: {db.path}")
            else:
                r = db.query("SELECT CURRENT_ACCOUNT() AS ACCOUNT, CURRENT_USER() AS USR, CURRENT_ROLE() AS ROLE, "
                             "CURRENT_WAREHOUSE() AS WH, CURRENT_DATABASE() AS DB, CURRENT_SCHEMA() AS SCH, "
                             "CURRENT_VERSION() AS VERSION")
                print(r.to_string(index=False))
        elif a.cmd == "setup":
            db.setup()
            print(f"setup: tables ready in {db.n['database']}.{db.n['schema']} ({db.kind})")
        elif a.cmd == "catalog":
            from pathlib import Path
            from . import catalog as K
            from .config import APP_DIR
            from .config import WORK
            src = Path(a.catalog_ts) if a.catalog_ts else APP_DIR
            cat, where = K.load_store_catalog(src, WORK)
            db.replace("CATALOG", cat, variant=("colors",))
            print(f"catalog: {len(cat)} products from {where}")
        elif a.cmd == "app-user":
            app_user(db)
        elif a.cmd == "personas":
            import pandas as pd
            from . import personas as P
            from .config import REPO
            db.setup()
            df = pd.read_parquet(REPO / "data" / "processed" / "fused_final.parquet")
            ref = P.Ref(df)
            rows = P.personas_rows(df, ref, pd.Timestamp.utcnow().isoformat())
            db.replace("PERSONAS", rows, variant=("key_traits",))
            if db.kind != "local":
                n = db.n
                db.execute(f"GRANT SELECT ON TABLE {n['database']}.{n['schema']}.PERSONAS TO ROLE ATELIER_APP_ROLE")
            print(rows[["persona_id", "name", "n_members_hm", "high_conf_share"]].to_string(index=False))
        elif a.cmd == "publish-run":
            db.close()
            from . import retrain
            retrain.publish_run(a.arg)
            return
        elif a.cmd == "publish-hm":
            from . import retrain
            retrain.publish_hm(db)
        elif a.cmd == "refresh":
            from . import refresh
            refresh.refresh_once(db)
        elif a.cmd == "loop":
            db.close()
            from . import refresh
            from .config import REFRESH_EVERY_S
            refresh.loop(a.every or REFRESH_EVERY_S)
            return
        elif a.cmd == "rescore-all":
            from . import refresh
            users = db.query("SELECT DISTINCT USER_ID FROM EVENTS")["user_id"].tolist()
            refresh.refresh_once(db, users=users)
        elif a.cmd == "status":
            for t in ("EVENTS", "CATALOG", "USER_LAYOUTS", "USER_LAYOUTS_HISTORY", "TRENDING", "MODEL_RUNS",
                      "HM_HOMEPAGES", "PERSONAS"):
                n = db.query(f"SELECT COUNT(*) AS N FROM {t}")["n"].iloc[0]
                print(f"{t:<22}{int(n):>10,}")
            r = db.query("SELECT RUN_ID, KIND, STATUS, FINISHED_AT FROM MODEL_RUNS ORDER BY FINISHED_AT DESC LIMIT 5")
            print("\nlatest runs:\n" + (r.to_string(index=False) if len(r) else "  none"))
        elif a.cmd == "show":
            if not a.arg:
                sys.exit("usage: python -m server show USER_ID")
            r = db.query("SELECT HOMEPAGE FROM USER_LAYOUTS WHERE USER_ID = %s", [a.arg])
            if r.empty:
                sys.exit(f"no layout for {a.arg} yet")
            h = r["homepage"].iloc[0]
            print(json.dumps(json.loads(h) if isinstance(h, str) else h, indent=1))
        elif a.cmd == "simulate":
            from . import simulate
            simulate.clear(db) if a.clear else simulate.run(db, a.users)
    finally:
        db.close()


def app_user(db):
    """A service user for the store's API routes: insert events, read layouts/trending/catalog. Nothing else."""
    from .sf import keygen
    from .config import WORK
    n = db.n
    p = WORK / "keys" / "app_rsa_key.p8"
    if not p.exists():
        keygen("app")
    pub = (WORK / "keys" / "app_rsa_key.pub").read_text()
    sql = f"""-- Run in Snowsight as ACCOUNTADMIN (or SECURITYADMIN + SYSADMIN)
CREATE ROLE IF NOT EXISTS ATELIER_APP_ROLE;
GRANT USAGE ON WAREHOUSE {n['warehouse']} TO ROLE ATELIER_APP_ROLE;
GRANT USAGE ON DATABASE {n['database']} TO ROLE ATELIER_APP_ROLE;
GRANT USAGE ON SCHEMA {n['database']}.{n['schema']} TO ROLE ATELIER_APP_ROLE;
GRANT INSERT, SELECT ON TABLE {n['database']}.{n['schema']}.EVENTS TO ROLE ATELIER_APP_ROLE;
GRANT SELECT ON TABLE {n['database']}.{n['schema']}.USER_LAYOUTS TO ROLE ATELIER_APP_ROLE;
GRANT SELECT ON TABLE {n['database']}.{n['schema']}.TRENDING TO ROLE ATELIER_APP_ROLE;
GRANT SELECT ON TABLE {n['database']}.{n['schema']}.CATALOG TO ROLE ATELIER_APP_ROLE;
GRANT SELECT ON TABLE {n['database']}.{n['schema']}.MODEL_RUNS TO ROLE ATELIER_APP_ROLE;
CREATE USER IF NOT EXISTS ATELIER_APP TYPE = SERVICE DEFAULT_ROLE = ATELIER_APP_ROLE
  DEFAULT_WAREHOUSE = {n['warehouse']} RSA_PUBLIC_KEY = '{pub}';
GRANT ROLE ATELIER_APP_ROLE TO USER ATELIER_APP;"""
    print(sql)
    print(f"\nPrivate key for the store's server env (Vercel / .env.local): {p}\n"
          "Give it to the UI team privately (not in git, not in chat). See server/app/README.md.")


if __name__ == "__main__":
    main()
