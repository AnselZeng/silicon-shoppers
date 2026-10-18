import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).parent))
import fixtures  # noqa: E402

from atelier_data import db, features, references  # noqa: E402
from atelier_data.config import read_json  # noqa: E402


@pytest.fixture(scope="session")
def built(tmp_path_factory):
    return fixtures.build(tmp_path_factory.mktemp("fx"))


@pytest.fixture(scope="session")
def built_future(tmp_path_factory):
    """Same fixture plus 60 random rows dated in [C_dev, D_max]."""
    return fixtures.build(tmp_path_factory.mktemp("fx_future"), extra_future=60)


def keys(cfg) -> dict:
    df = pd.read_parquet(cfg.paths.ingested / "customer_index.parquet")
    return dict(zip(df["customer_id"], df["customer_key"]))


def art_keys(cfg) -> dict:
    df = pd.read_parquet(cfg.paths.ingested / "articles.parquet")
    return dict(zip(df["article_id"], df["article_key"]))


def flags_df(cfg, cut="dev") -> pd.DataFrame:
    """Per-unit flags at a cutoff, joined to raw ids for readable assertions."""
    con = db.connect(cfg)
    vocab = read_json(cfg.paths.processed / "vocabularies.json")
    references.register_cat_map(con, vocab)
    s = read_json(cfg.paths.reports / "split_manifest.json")
    units_rel = f"read_parquet('{cfg.paths.interim / f'units_{cut}.parquet'}')"
    sql = features.flags_sql(cfg, units_rel, cfg.paths.refs(cut), s["data_start"], len(vocab["category_keys"]))
    df = con.execute(sql).df()
    inv_c = {v: k for k, v in keys(cfg).items()}
    inv_a = {v: k for k, v in art_keys(cfg).items()}
    df["customer_id"] = df["customer_key"].map(inv_c)
    df["article_id"] = df["article_key"].map(inv_a)
    df["t_dat"] = pd.to_datetime(df["t_dat"]).dt.date
    return df
