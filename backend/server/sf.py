"""Database access: Snowflake (the real thing) or a local DuckDB file with the same tables (ATELIER_DB=local).

Snowflake settings in .env:
    SNOWFLAKE_ACCOUNT=orgname-accountname        (Snowsight > your name > Account > "Account identifier")
    SNOWFLAKE_USER=YOUR_USER
    SNOWFLAKE_PRIVATE_KEY_PATH=server/work/keys/laptop_rsa_key.p8   (key pair: python -m server keygen)
      or SNOWFLAKE_TOKEN=...                      (programmatic access token)
      or SNOWFLAKE_PASSWORD=...                   (only if your account still allows password sign-in)
    SNOWFLAKE_ROLE=ACCOUNTADMIN                   (optional)
    SNOWFLAKE_WAREHOUSE=ATELIER_WH  SNOWFLAKE_DATABASE=ATELIER  SNOWFLAKE_SCHEMA=LIVE   (defaults)
"""
from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

import numpy as np
import pandas as pd

from .config import HERE, REPO, WORK, backend, env

SCHEMA_SQL = HERE / "schema.sql"
SMALL = 2000            # rows; above this, Snowflake uploads go through write_pandas (stage + COPY)


def names() -> dict:
    e = env()
    return {"warehouse": e.get("SNOWFLAKE_WAREHOUSE", "ATELIER_WH"), "database": e.get("SNOWFLAKE_DATABASE", "ATELIER"),
            "schema": e.get("SNOWFLAKE_SCHEMA", "LIVE")}


def _statements(sql: str) -> list[str]:
    sql = "\n".join(l for l in sql.splitlines() if not l.strip().startswith("--"))
    return [s.strip() for s in sql.split(";") if s.strip()]


def _jsonable(v):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    if isinstance(v, (dict, list)):
        return json.dumps(v, separators=(",", ":"), default=_default)
    return v


def _default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if np.isnan(o) else float(o)
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


def _py(v):
    """numpy/pandas scalars -> plain Python for parameter binding."""
    if v is None:
        return None
    if isinstance(v, (pd.Timestamp,)):
        return None if pd.isna(v) else v.to_pydatetime().replace(tzinfo=None)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.floating):
        return None if np.isnan(v) else float(v)
    if isinstance(v, np.bool_):
        return bool(v)
    if isinstance(v, float) and np.isnan(v):
        return None
    return v


class DB:
    def __init__(self):
        self.kind = backend()
        self.n = names()
        if self.kind == "local":
            import duckdb
            WORK.mkdir(parents=True, exist_ok=True)
            self.path = WORK / "local.duckdb"
            self.con = duckdb.connect(str(self.path))
        else:
            self.con = _snowflake_connect(self.n)

    # ---------------------------------------------------------------- basics
    def execute(self, sql: str, params=None):
        if self.kind == "local":
            return self.con.execute(sql, params or [])
        cur = self.con.cursor()
        cur.execute(sql, params)
        return cur

    def query(self, sql: str, params=None) -> pd.DataFrame:
        """SELECT -> DataFrame with lower-case column names. Placeholders: %s (both backends)."""
        if self.kind == "local":
            df = self.con.execute(sql.replace("%s", "?"), params or []).df()
        else:
            cur = self.con.cursor()
            cur.execute(sql, params)
            cols = [c[0] for c in cur.description]
            df = pd.DataFrame(cur.fetchall(), columns=cols)
        df.columns = [c.lower() for c in df.columns]
        return df

    def close(self):
        try:
            self.con.close()
        except Exception:
            pass

    # ---------------------------------------------------------------- schema
    def setup(self):
        sql = SCHEMA_SQL.read_text(encoding="utf-8").format(**self.n)
        for st in _statements(sql):
            if self.kind == "local":
                if re.match(r"(CREATE (WAREHOUSE|DATABASE|SCHEMA)|USE )", st, re.I):
                    continue
                st = (st.replace("TIMESTAMP_NTZ", "TIMESTAMP").replace("VARIANT", "JSON").replace("STRING", "VARCHAR")
                        .replace("CURRENT_TIMESTAMP()", "CURRENT_TIMESTAMP").replace(" FLOAT", " DOUBLE"))
            self.execute(st)

    # ---------------------------------------------------------------- writes
    def _stage(self, df: pd.DataFrame, variant: tuple) -> tuple[str, list[str]]:
        """Copy df into a temporary table of strings/numbers; returns (table, upper-case columns)."""
        d = df.copy()
        d.columns = [c.upper() for c in d.columns]
        for c in variant:
            d[c.upper()] = [_jsonable(v) for v in d[c.upper()]]
        cols = list(d.columns)
        stg = f"STG_{uuid.uuid4().hex[:10].upper()}"
        if self.kind == "local":
            self.con.register("stg_df", d)
            self.con.execute(f"CREATE TEMP TABLE {stg} AS SELECT * FROM stg_df")
            self.con.unregister("stg_df")
            return stg, cols
        if len(d) > SMALL:
            from snowflake.connector.pandas_tools import write_pandas
            kw = dict(table_name=stg, auto_create_table=True, table_type="temporary", quote_identifiers=False)
            try:
                write_pandas(self.con, d, use_logical_type=True, **kw)
            except TypeError:
                write_pandas(self.con, d, **kw)
            return stg, cols
        types = []
        for c in cols:
            s = d[c]
            if pd.api.types.is_bool_dtype(s):
                types.append("BOOLEAN")
            elif pd.api.types.is_integer_dtype(s):
                types.append("NUMBER")
            elif pd.api.types.is_float_dtype(s):
                types.append("FLOAT")
            elif pd.api.types.is_datetime64_any_dtype(s):
                types.append("TIMESTAMP_NTZ")
            else:
                types.append("STRING")
        self.execute(f"CREATE TEMPORARY TABLE {stg} ({', '.join(f'{c} {t}' for c, t in zip(cols, types))})")
        if len(d):
            rows = [tuple(_py(v) for v in r) for r in d.itertuples(index=False, name=None)]
            cur = self.con.cursor()
            cur.executemany(f"INSERT INTO {stg} ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})", rows)
        return stg, cols

    def _select(self, cols, variant) -> str:
        v = {c.upper() for c in variant}
        if self.kind == "local":
            return ", ".join(f"CAST({c} AS JSON)" if c in v else c for c in cols)
        return ", ".join(f"PARSE_JSON({c})" if c in v else c for c in cols)

    def insert(self, table: str, df: pd.DataFrame, variant: tuple = ()):
        if df.empty:
            return 0
        stg, cols = self._stage(df, variant)
        self.execute(f"INSERT INTO {table} ({', '.join(cols)}) SELECT {self._select(cols, variant)} FROM {stg}")
        self.execute(f"DROP TABLE IF EXISTS {stg}")
        return len(df)

    def upsert(self, table: str, df: pd.DataFrame, key: str, variant: tuple = ()):
        """Replace rows with the same key, insert the rest (one statement each, inside the warehouse)."""
        if df.empty:
            return 0
        stg, cols = self._stage(df, variant)
        k = key.upper()
        self.execute(f"DELETE FROM {table} WHERE {k} IN (SELECT {k} FROM {stg})")
        self.execute(f"INSERT INTO {table} ({', '.join(cols)}) SELECT {self._select(cols, variant)} FROM {stg}")
        self.execute(f"DROP TABLE IF EXISTS {stg}")
        return len(df)

    def replace(self, table: str, df: pd.DataFrame, variant: tuple = ()):
        self.execute(f"DELETE FROM {table}")
        return self.insert(table, df, variant)

    # ---------------------------------------------------------------- state
    def get_state(self, name: str, default: str | None = None) -> str | None:
        df = self.query("SELECT VALUE FROM JOB_STATE WHERE NAME = %s", [name])
        return df["value"].iloc[0] if len(df) else default

    def set_state(self, name: str, value: str):
        self.upsert("JOB_STATE", pd.DataFrame({"name": [name], "value": [value], "updated_at": [pd.Timestamp.utcnow().tz_localize(None)]}), "name")


def _snowflake_connect(n: dict):
    try:
        import snowflake.connector
    except ImportError:
        raise SystemExit("pip install -r server/requirements.txt  (snowflake-connector-python is missing)")
    e = env()
    need = [k for k in ("SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USER") if not e.get(k)]
    if need:
        raise SystemExit(f"{', '.join(need)} missing in .env (see server/README.md, step 1)")
    kw = dict(account=e["SNOWFLAKE_ACCOUNT"], user=e["SNOWFLAKE_USER"], warehouse=n["warehouse"],
              database=n["database"], schema=n["schema"], client_session_keep_alive=False,
              application="atelier-laptop-server", login_timeout=60, network_timeout=300)
    if e.get("SNOWFLAKE_ROLE"):
        kw["role"] = e["SNOWFLAKE_ROLE"]
    key_path = e.get("SNOWFLAKE_PRIVATE_KEY_PATH")
    if key_path:
        p = Path(key_path)
        p = p if p.is_absolute() else REPO / p
        from cryptography.hazmat.primitives import serialization
        pw = e.get("SNOWFLAKE_PRIVATE_KEY_PASSPHRASE")
        key = serialization.load_pem_private_key(p.read_bytes(), password=pw.encode() if pw else None)
        kw["private_key"] = key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8,
                                              serialization.NoEncryption())
    elif e.get("SNOWFLAKE_TOKEN"):
        kw["authenticator"] = "PROGRAMMATIC_ACCESS_TOKEN"
        kw["token"] = e["SNOWFLAKE_TOKEN"]
    elif e.get("SNOWFLAKE_PASSWORD"):
        kw["password"] = e["SNOWFLAKE_PASSWORD"]
        if e.get("SNOWFLAKE_AUTHENTICATOR"):
            kw["authenticator"] = e["SNOWFLAKE_AUTHENTICATOR"]     # e.g. username_password_mfa
    else:
        raise SystemExit("No Snowflake credential in .env: set SNOWFLAKE_PRIVATE_KEY_PATH (recommended, "
                         "`python -m server keygen`), SNOWFLAKE_TOKEN or SNOWFLAKE_PASSWORD")
    con = snowflake.connector.connect(**kw)
    return con


def keygen(name: str = "laptop") -> Path:
    """RSA key pair for key-pair sign-in. The private key stays in server/work/keys (gitignored)."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    d = WORK / "keys"
    d.mkdir(parents=True, exist_ok=True)
    priv = d / f"{name}_rsa_key.p8"
    if priv.exists():
        raise SystemExit(f"{priv} already exists; delete it first if you really want a new key")
    k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv.write_bytes(k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                     serialization.NoEncryption()))
    pub = k.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    body = "".join(l for l in pub.decode().splitlines() if "PUBLIC KEY" not in l)
    (d / f"{name}_rsa_key.pub").write_text(body)
    return priv
