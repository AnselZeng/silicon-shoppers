"""Upload the compact homepages to Supabase (project owner only: needs SUPABASE_SERVICE_ROLE_KEY).

    python -m model publish            # work/export/*.parquet -> homepages_final, homepage_articles

Create the tables first with model/schema.sql. Re-running replaces the rows. The app then reads one shopper:
    supabase.from("homepages_final").select("homepage").eq("customer_key", 5).single()
and resolves tile article_ids against homepage_articles.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import requests

from atelier_data.cloud import _env, _service_headers

from . import common as C

WORK = C.WORK / "export"
BATCH = 2000


def _post(url, h, table, rows):
    r = requests.post(f"{url}/rest/v1/{table}", json=rows, timeout=300,
                      headers={**h, "Prefer": "resolution=merge-duplicates,return=minimal"})
    if not r.ok:
        sys.exit(f"upload {table}: {r.status_code} {r.text[:500]}")


def main():
    env = _env()
    url, h = env["SUPABASE_URL"], _service_headers(env)
    arts = pd.read_parquet(WORK / "homepage_articles_final.parquet")
    rows = [{k: (None if isinstance(v, float) and v != v else v) for k, v in r.items()} for r in arts.to_dict("records")]
    for i in range(0, len(rows), BATCH):
        _post(url, h, "homepage_articles", rows[i:i + BATCH])
    print(f"homepage_articles: {len(rows):,} rows")
    pages = pd.read_parquet(WORK / "homepages_final_compact.parquet")
    for i in range(0, len(pages), BATCH):
        part = pages.iloc[i:i + BATCH]
        _post(url, h, "homepages_final", [{"customer_key": int(k), "stratum": s, "homepage": json.loads(d)}
                                          for k, s, d in zip(part["customer_key"], part["stratum"], part["homepage"])])
    print(f"homepages_final: {len(pages):,} rows")

