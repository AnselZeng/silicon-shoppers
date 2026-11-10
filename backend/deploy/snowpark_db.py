"""DB shim for Snowpark stored procedures: same API as server.sf.DB, backed by a Snowpark session.

Bundled into pkg.zip; jobs.py passes the procedure's session in. Query/execute use %s params like
sf.DB does, so refresh.py's SQL runs unchanged.
"""
from __future__ import annotations

import json
import uuid
from typing import Any

import numpy as np
import pandas as pd


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


class DB:
    kind = "snowflake"

    def __init__(self, session):
        self.session = session

    def _sql(self, sql: str, params=None):
        # sf.DB uses %s placeholders; Snowpark session.sql wants ?
        return self.session.sql(sql.replace("%s", "?"),
                                params=list(params) if params else None)

    def execute(self, sql: str, params=None):
        return self._sql(sql, params).collect()

    def query(self, sql: str, params=None) -> pd.DataFrame:
        df = self._sql(sql, params).to_pandas()
        df.columns = [c.lower() for c in df.columns]
        return df

    def close(self):
        pass

    # ---------------------------------------------------------------- writes

    def _stage(self, df: pd.DataFrame, variant: tuple) -> tuple[str, list[str]]:
        d = df.copy()
        d.columns = [c.upper() for c in d.columns]
        for c in variant:
            d[c.upper()] = [_jsonable(v) for v in d[c.upper()]]
        stg = f"STG_{uuid.uuid4().hex[:10].upper()}"
        # owner's-rights procedures cannot create temporary tables: stage into a
        # uniquely named permanent table and drop it after the merge
        self.session.create_dataframe(d).write.mode("overwrite").save_as_table(stg)
        return stg, list(d.columns)

    def _select(self, cols, variant) -> str:
        v = {c.upper() for c in variant}
        return ", ".join(f"PARSE_JSON({c})" if c in v else c for c in cols)

    def insert(self, table: str, df: pd.DataFrame, variant: tuple = ()) -> int:
        if df.empty:
            return 0
        stg, cols = self._stage(df, variant)
        self.execute(f"INSERT INTO {table} ({', '.join(cols)}) SELECT {self._select(cols, variant)} FROM {stg}")
        self.execute(f"DROP TABLE IF EXISTS {stg}")
        return len(df)

    def upsert(self, table: str, df: pd.DataFrame, key: str, variant: tuple = ()) -> int:
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
        self.upsert("JOB_STATE", pd.DataFrame(
            {"name": [name], "value": [value],
             "updated_at": [pd.Timestamp.utcnow().tz_localize(None)]}), "name")
