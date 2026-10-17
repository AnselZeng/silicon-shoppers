import datetime as dt

import duckdb
import pandas as pd
import pytest
from conftest import art_keys, keys
from fixtures import ARTICLES, C_DEV

from atelier_data import db, features
from atelier_data.ingest import norm_article


def test_article_id_normalization(built):
    con = duckdb.connect()
    got = con.execute(f"SELECT {norm_article(chr(39) + '108775015' + chr(39))}, "
                      f"{norm_article(chr(39) + '0108775015' + chr(39))}").fetchone()
    assert got == ("0108775015", "0108775015")
    ak = art_keys(built)
    tx = pd.read_parquet(built.paths.ingested / "transactions.parquet")
    c01 = tx[tx["customer_key"] == keys(built)["c01"]]
    assert ak["0108775015"] in set(c01["article_key"])
    raw_rows = sum(1 for _ in open(built.paths.raw / "transactions_train.csv")) - 1
    assert len(tx) == raw_rows  # nothing dropped as a missing article


def test_unit_cap_and_weight(built):
    u = pd.read_parquet(built.paths.interim / "units_dev.parquet")
    row = u[(u["customer_key"] == keys(built)["c07"]) & (u["article_key"] == art_keys(built)[ARTICLES["CAP"][0]])]
    assert len(row) == 1
    row = row.iloc[0]
    assert row["n_rows"] == 5 and row["q"] == 3
    delta = (C_DEV - dt.date(2020, 7, 1)).days
    assert row["w"] == pytest.approx(3 * 2 ** (-delta / 180), abs=1e-12)


def test_e_budget(built):
    con = db.connect(built)
    k = keys(built)["c06"]
    rel = f"(SELECT * FROM read_parquet('{built.paths.interim / 'units_dev.parquet'}') WHERE customer_key = {k})"
    def q_eff(E):
        return [r[0] for r in con.execute(
            f"SELECT q FROM {features.budget_sql(built, rel, E, C_DEV)} ORDER BY t_dat DESC").fetchall()]
    assert q_eff(3) == [2, 1]
    assert q_eff(1) == [1]
    assert q_eff(10) == [2, 2]
    assert q_eff("all") == [2, 2]
