"""Supabase hosting for the fused dataset: Postgres tables for API queries, a private bucket for Parquet files.

Uploader (needs the service-role key; run once after a rebuild):
    python -m atelier_data.cloud upload

Teammates (anon key + their own login; RLS lets only signed-in users read):
    python -m atelier_data.cloud download              # every file into data/
    python -m atelier_data.cloud download fused_dev    # one file

    from atelier_data.cloud import fetch
    light = fetch("fused_dev", stratum="eq.light", select="customer_key,markdown_affinity")

Credentials come from a .env file at the repo root (never committed); see .env.example.
"""
from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[2]
BUCKET = "atelier"
PAGE = 1000      # Supabase's default max rows per API response
BATCH = 5000     # rows per insert request

# name -> local file. Tables are created by supabase/schema.sql; articles is a bucket file only.
FILES = {
    "fused_dev": "data/processed/fused_dev.parquet",
    "fused_final": "data/processed/fused_final.parquet",
    "targets_dev": "data/interim/targets_dev.parquet",
    "targets_final": "data/interim/targets_final.parquet",
    "articles": "data/ingested/articles.parquet",
}
TABLES = ["fused_dev", "fused_final", "targets_dev", "targets_final"]


def _env() -> dict:
    """Read KEY=value lines from .env, letting real environment variables win."""
    env = {}
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"')
    env.update({k: v for k, v in os.environ.items() if k.startswith("SUPABASE_")})
    if not env.get("SUPABASE_URL"):
        sys.exit("SUPABASE_URL missing: copy .env.example to .env and fill it in")
    env["SUPABASE_URL"] = env["SUPABASE_URL"].rstrip("/")
    return env


def _service_headers(env) -> dict:
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        sys.exit("upload needs SUPABASE_SERVICE_ROLE_KEY in .env (uploader only; never share it)")
    # New-style secret keys (sb_secret_...) aren't JWTs, so they go in apikey only; legacy JWT keys also need Bearer.
    return {"apikey": key} if key.startswith("sb_") else {"apikey": key, "Authorization": f"Bearer {key}"}


def _user_headers(env) -> dict:
    """Sign in with the teammate's email and password; the token carries the 'authenticated' role."""
    anon = env.get("SUPABASE_ANON_KEY")
    if not (anon and env.get("SUPABASE_EMAIL") and env.get("SUPABASE_PASSWORD")):
        sys.exit("needs SUPABASE_ANON_KEY, SUPABASE_EMAIL and SUPABASE_PASSWORD in .env")
    r = requests.post(f"{env['SUPABASE_URL']}/auth/v1/token?grant_type=password",
                      headers={"apikey": anon},
                      json={"email": env["SUPABASE_EMAIL"], "password": env["SUPABASE_PASSWORD"]}, timeout=30)
    r.raise_for_status()
    return {"apikey": anon, "Authorization": f"Bearer {r.json()['access_token']}"}


def _records(df: pd.DataFrame) -> list[dict]:
    """JSON-safe rows: dates as ISO strings, NaN as null."""
    out = df.copy()
    for c in out.columns:
        if out[c].dtype == object and len(out) and hasattr(out[c].iloc[0], "isoformat"):
            out[c] = out[c].map(lambda d: d.isoformat() if d is not None else None)
    rows = out.to_dict("records")
    return [{k: (None if isinstance(v, float) and math.isnan(v) else v) for k, v in r.items()} for r in rows]


def upload():
    env = _env()
    url, h = env["SUPABASE_URL"], _service_headers(env)
    for name in TABLES:
        df = pd.read_parquet(ROOT / FILES[name])
        # Empty the table first so a re-upload never duplicates rows.
        requests.delete(f"{url}/rest/v1/{name}?customer_key=gte.0", headers=h, timeout=300).raise_for_status()
        rows = _records(df)
        for i in range(0, len(rows), BATCH):
            r = requests.post(f"{url}/rest/v1/{name}", json=rows[i:i + BATCH], timeout=300,
                              headers={**h, "Prefer": "return=minimal"})
            if not r.ok:
                sys.exit(f"upload {name}: {r.status_code} {r.text[:500]}")
        print(f"table {name}: {len(rows):,} rows")
    for name, rel in FILES.items():
        r = requests.post(f"{url}/storage/v1/object/{BUCKET}/{name}.parquet", data=(ROOT / rel).read_bytes(),
                          headers={**h, "x-upsert": "true", "Content-Type": "application/octet-stream"}, timeout=600)
        if not r.ok:
            sys.exit(f"upload {name}.parquet: {r.status_code} {r.text[:500]}")
        print(f"file {name}.parquet: {(ROOT / rel).stat().st_size / 1e6:.1f} MB")


def download(names=None):
    """Save bucket files to the same paths the pipeline and scoring harness expect."""
    env = _env()
    h = _user_headers(env)
    for name in names or list(FILES):
        r = requests.get(f"{env['SUPABASE_URL']}/storage/v1/object/authenticated/{BUCKET}/{name}.parquet",
                         headers=h, timeout=600)
        r.raise_for_status()
        dest = ROOT / FILES[name]
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(r.content)
        print(f"{name}.parquet -> {FILES[name]} ({len(r.content) / 1e6:.1f} MB)")


def fetch(table: str, select: str = "*", **filters) -> pd.DataFrame:
    """Query a table through the API, paging past the 1,000-row limit.

    filters use PostgREST syntax: fetch("fused_dev", stratum="eq.light", match_confidence="gte.0.6").
    For whole tables, download() is faster and lighter on the free-tier bandwidth.
    """
    env = _env()
    h = _user_headers(env)
    frames, start = [], 0
    while True:
        r = requests.get(f"{env['SUPABASE_URL']}/rest/v1/{table}", timeout=120,
                         params={"select": select, "order": "customer_key", **filters},
                         headers={**h, "Range": f"{start}-{start + PAGE - 1}"})
        r.raise_for_status()
        part = r.json()
        frames.append(pd.DataFrame(part))
        if len(part) < PAGE:
            return pd.concat(frames, ignore_index=True)
        start += PAGE


if __name__ == "__main__":
    cmd, *args = sys.argv[1:] or ["help"]
    if cmd == "upload":
        upload()
    elif cmd == "download":
        download(args or None)
    else:
        sys.exit(__doc__)
