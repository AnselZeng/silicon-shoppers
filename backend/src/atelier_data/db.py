"""DuckDB connection factory and the only readers of the transactions table.

Leakage guard: every module other than ingest/verify reads transactions through
rows_before (features, references, cohort) or rows_between / rows_all (target labels only).
"""
from __future__ import annotations

import duckdb

TX_VIEW = "_tx"


def connect(cfg) -> duckdb.DuckDBPyConnection:
    p = cfg.paths
    p.tmp.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    d = cfg["duckdb"]
    con.execute(f"SET memory_limit = '{d['memory_limit']}'")
    con.execute(f"SET threads = {int(d['threads'])}")
    con.execute(f"SET temp_directory = '{p.tmp}'")
    con.execute(f"SET max_temp_directory_size = '{d['max_temp_directory_size']}'")
    con.execute("SET preserve_insertion_order = false")
    con.execute("SET enable_progress_bar = false")
    tx = p.ingested / "transactions.parquet"
    if tx.exists():
        con.execute(f"CREATE OR REPLACE VIEW {TX_VIEW} AS SELECT * FROM read_parquet('{tx}')")
    for name in ("articles", "customers"):
        f = p.ingested / f"{name}.parquet"
        if f.exists():
            con.execute(f"CREATE OR REPLACE VIEW {name} AS SELECT * FROM read_parquet('{f}')")
    return con


def rows_before(cutoff, src: str = TX_VIEW) -> str:
    """Relation of transaction rows with t_dat < cutoff (exclusive)."""
    return f"(SELECT * FROM {src} WHERE t_dat < DATE '{cutoff}')"


def rows_between(start, end, src: str = TX_VIEW) -> str:
    """Relation of transaction rows with start <= t_dat < end (target windows)."""
    return f"(SELECT * FROM {src} WHERE t_dat >= DATE '{start}' AND t_dat < DATE '{end}')"


def rows_all(src: str = TX_VIEW) -> str:
    """All rows. Only for target labels (first_seen_global) and descriptive verify checks."""
    return f"(SELECT * FROM {src})"


def create_filtered_source(con, name: str, cutoff) -> str:
    """A view physically limited to t_dat < cutoff (used by leakage-check)."""
    con.execute(f"CREATE OR REPLACE VIEW {name} AS SELECT * FROM {rows_before(cutoff)}")
    return name


# Parallel float SUM/AVG is not bit-reproducible (combine order varies). Summing in DECIMAL is exact
# integer arithmetic, so results are identical on every run regardless of thread order.
EXACT = "DECIMAL(18,12)"


def xsum(expr: str, where: str | None = None) -> str:
    f = f" FILTER (WHERE {where})" if where else ""
    return f"(sum(({expr})::{EXACT}){f})::DOUBLE"


def xavg(expr: str, where: str | None = None) -> str:
    f = f" FILTER (WHERE {where})" if where else ""
    return f"((sum(({expr})::{EXACT}){f})::DOUBLE / (count({expr}){f}))"


def scalar(con, sql: str, params=None):
    return con.execute(sql, params or []).fetchone()[0]
