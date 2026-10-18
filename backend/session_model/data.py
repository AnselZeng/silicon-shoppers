"""OTTO events -> sampled shoppers, their first N_MAX events (model input) and their later-event style (targets).

Download: Kaggle credentials come from the repo's .env (KAGGLE_USERNAME + KAGGLE_KEY, or KAGGLE_API_TOKEN), or
~/.kaggle/kaggle.json, or place otto-recsys-train.jsonl in data/raw/otto/ yourself. Ingest streams the file in
chunks into data/ingested/otto_events.parquet (about 216M events; same file and schema as atelier_data.fusion). OTTO
"sessions" are shoppers followed for 4 weeks; visits split after 30 minutes without events, as in fusion.py.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from scipy.stats import rankdata

from . import config as K


def events_path() -> Path:
    from atelier_data import config
    return config.load().paths.ingested / "otto_events.parquet"


KAGGLE_VARS = ("KAGGLE_USERNAME", "KAGGLE_KEY", "KAGGLE_API_TOKEN")


def load_kaggle_env(env_file: Path | None = None) -> dict:
    """Kaggle credentials from the repo's .env (never printed). Real environment variables win."""
    from atelier_data.config import ROOT
    f = env_file or ROOT / ".env"
    found = {}
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k in KAGGLE_VARS and v:
                    found[k] = v
    env = {**found, **{k: os.environ[k] for k in KAGGLE_VARS if os.environ.get(k)}}
    return env


def download_otto(raw_dir: Path):
    """otto-recsys-train.jsonl into raw_dir via the Kaggle CLI, authenticated from .env."""
    from atelier_data import fusion
    target = raw_dir / fusion.OTTO_TRAIN
    if target.exists():
        print(f"otto: {target} present", flush=True)
        return
    creds = load_kaggle_env()
    has_env = ("KAGGLE_USERNAME" in creds and "KAGGLE_KEY" in creds) or "KAGGLE_API_TOKEN" in creds
    if not has_env and not (Path.home() / ".kaggle" / "kaggle.json").exists():
        sys.exit("Kaggle credentials missing. Add them to the repo's .env:\n"
                 "  KAGGLE_USERNAME=your_kaggle_username\n  KAGGLE_KEY=your_api_key\n"
                 "(from kaggle.com -> Settings -> API -> Create New Token; the downloaded kaggle.json holds both),\n"
                 f"or place {fusion.OTTO_TRAIN} from https://www.kaggle.com/datasets/{fusion.OTTO_DATASET} in {raw_dir}.")
    raw_dir.mkdir(parents=True, exist_ok=True)
    print(f"otto: downloading {fusion.OTTO_TRAIN} (about 11 GB) into {raw_dir}", flush=True)
    subprocess.run([sys.executable, "-m", "kaggle", "datasets", "download", "-d", fusion.OTTO_DATASET,
                    "-f", fusion.OTTO_TRAIN, "-p", str(raw_dir)], check=True, env={**os.environ, **creds})
    z = raw_dir / f"{fusion.OTTO_TRAIN}.zip"
    if z.exists():
        print("otto: unzipping", flush=True)
        with zipfile.ZipFile(z) as zf:
            zf.extractall(raw_dir)
        z.unlink()


INGEST_LINES = int(os.environ.get("OTTO_INGEST_LINES", 500_000))   # shoppers per chunk


def ingest_otto(src: Path, out: Path, lines_per_chunk: int = INGEST_LINES) -> Path:
    """otto-recsys-train.jsonl -> one parquet of events (session, aid, ts seconds, type 0/1/2), the same file and
    schema as atelier_data.fusion.ingest, but streamed in chunks so memory stays small (the one-shot JSON read
    needs more RAM than most laptops have). Finished chunks are kept, so an interrupted run resumes."""
    parts = out.parent / "otto_events_parts"
    parts.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute(f"SET memory_limit = '{K.duckdb_mem()}'")
    con.execute(f"SET threads = {min(K.duckdb_threads(), 4)}")
    con.execute("SET preserve_insertion_order = false")
    t, i, buf = time.time(), 0, []

    done = 0

    def flush(i, buf):
        nonlocal done
        done += len(buf)
        part = parts / f"part_{i:04d}.parquet"
        if part.exists():                       # finished in an earlier, interrupted run
            return
        chunk = parts / f"chunk_{i:04d}.jsonl"
        chunk.write_bytes(b"".join(buf))
        con.execute(f"""
            COPY (
              SELECT session::INTEGER AS session, e.aid::INTEGER AS aid, (e.ts // 1000)::INTEGER AS ts,
                     CASE e.type WHEN 'clicks' THEN 0 WHEN 'carts' THEN 1 WHEN 'orders' THEN 2 END::TINYINT AS type
              FROM (SELECT session, unnest(events) AS e
                    FROM read_json('{chunk.as_posix()}', format='newline_delimited',
                                   columns={{session: 'UBIGINT', events: 'STRUCT(aid UBIGINT, ts UBIGINT, type VARCHAR)[]'}},
                                   maximum_object_size=268435456))
            ) TO '{(parts / "tmp.parquet").as_posix()}' (FORMAT parquet, COMPRESSION zstd)""")
        (parts / "tmp.parquet").replace(part)   # only complete parts get a final name
        chunk.unlink()
        print(f"  otto ingest: chunk {i + 1} done ({done:,} shoppers so far, {time.time() - t:.0f}s)", flush=True)

    with open(src, "rb") as f:
        for line in f:
            buf.append(line)
            if len(buf) == lines_per_chunk:
                flush(i, buf); i += 1; buf = []
    if buf:
        flush(i, buf); i += 1
    glob = (parts / "part_*.parquet").as_posix()
    n, s, bad = con.execute(f"""SELECT count(*), count(DISTINCT session), count(*) FILTER (WHERE type IS NULL)
                                FROM read_parquet('{glob}')""").fetchone()
    if bad:
        raise ValueError(f"otto ingest: {bad} events with an unknown type")
    con.execute(f"COPY (SELECT * FROM read_parquet('{glob}')) TO '{(parts / 'all.tmp').as_posix()}' "
                "(FORMAT parquet, COMPRESSION zstd)")
    (parts / "all.tmp").replace(out)
    for p in parts.glob("part_*.parquet"):
        p.unlink()
    parts.rmdir()
    print(f"otto ingest: {n:,} events, {s:,} shoppers -> {out} ({time.time() - t:.0f}s)", flush=True)
    return out


def ensure_events(events: Path | None = None) -> Path:
    """Download (credentials from .env) and ingest OTTO unless the events parquet already exists."""
    p = events or events_path()
    if p.exists():
        return p
    from atelier_data import config, fusion
    cfg = config.load()
    raw = cfg.paths.raw / "otto"
    download_otto(raw)
    p.parent.mkdir(parents=True, exist_ok=True)
    return ingest_otto(raw / fusion.OTTO_TRAIN, p)


def _connect():
    con = duckdb.connect()
    con.execute(f"SET memory_limit = '{K.duckdb_mem()}'")
    con.execute(f"SET threads = {K.duckdb_threads()}")
    tmp = K.WORK / "duckdb_tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    con.execute(f"SET temp_directory = '{tmp.as_posix()}'")
    con.execute("SET preserve_insertion_order = false")
    return con


def percentile(v: np.ndarray) -> np.ndarray:
    """Mid-rank percentile among finite values; NaN stays NaN (no target for that shopper)."""
    out = np.full(len(v), np.nan)
    ok = np.isfinite(v)
    out[ok] = (rankdata(v[ok], method="average") - 0.5) / ok.sum()
    return out


def build(events: Path, out_dir: Path = K.WORK, sample: int = K.SAMPLE) -> dict:
    """Writes prefix_events.parquet (first N_MAX events per sampled shopper) and targets.parquet."""
    out_dir.mkdir(parents=True, exist_ok=True)
    con = _connect()
    t = time.time()
    src = f"read_parquet('{events.as_posix()}')"
    # Shoppers with enough later events, sampled in salted-hash order (reproducible, unbiased by id).
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE pick AS
        SELECT session FROM (SELECT session, count(*) AS n FROM {src} GROUP BY session)
        WHERE n >= {K.MIN_EVENTS}
        ORDER BY md5('{K.SALT}' || session::VARCHAR) LIMIT {int(sample)}""")
    n_pick = con.execute("SELECT count(*) FROM pick").fetchone()[0]
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE ev AS
        SELECT e.session, e.aid, e.ts, e.type,
               row_number() OVER (PARTITION BY e.session ORDER BY e.ts, e.type, e.aid) AS rn
        FROM {src} e JOIN pick USING (session)""")
    con.execute(f"""COPY (SELECT session, ts, aid, type, rn FROM ev WHERE rn <= {K.N_MAX} ORDER BY session, rn)
                    TO '{(out_dir / "prefix_events.parquet").as_posix()}' (FORMAT parquet)""")
    raw = later_style(con, f"(SELECT session, aid, ts, type FROM ev WHERE rn > {K.N_MAX})")
    tg = pd.DataFrame({"session": raw["session"].to_numpy()})
    for c in K.TARGETS:
        tg[c] = percentile(raw[c].to_numpy(float))
    tg["later_events"] = raw["n_events"].to_numpy()
    tg.to_parquet(out_dir / "targets.parquet", index=False)
    same_shopper_bridge(con, "(SELECT session, aid, ts, type FROM ev)").to_parquet(out_dir / "bridge.parquet", index=False)
    info = {"shoppers": int(n_pick), "seconds": round(time.time() - t, 1),
            "target_coverage": {c: float(np.isfinite(tg[c]).mean()) for c in K.TARGETS}}
    print(f"data: {n_pick:,} shoppers sampled, prefix + targets written to {out_dir} ({info['seconds']}s)", flush=True)
    return info


def same_shopper_bridge(con, events_sql: str) -> pd.DataFrame:
    """The fusion's 5 purchase-pattern (bridge) percentiles for the sampled shoppers who ordered, computed
    exactly like atelier_data.fusion.donor_raw over their whole 4 weeks. Lets train.py compare "purchases ->
    browsing style" with "live clicks -> browsing style" on the same shoppers."""
    from atelier_data import config, fusion
    cfg = config.load()
    raw = fusion.donor_raw(con, events_sql, cfg["fusion"], int(cfg["features"]["pseudo_count"]))
    out = pd.DataFrame({"session": raw["session"].to_numpy()})
    for c in fusion.BRIDGE:
        out[f"bridge_{c}"] = percentile(raw[c].to_numpy(float))
    return out


def later_style(con, events_sql: str) -> pd.DataFrame:
    """Raw browsing style per shopper on the given events; same definitions as atelier_data.fusion.donor_raw.
    Rates are smoothed toward the population rate; undefined measures (e.g. no carts) are NaN."""
    gap = K.VISIT_GAP_S
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE le AS
        WITH g AS (SELECT *, coalesce(ts - lag(ts) OVER w > {gap}, false)::INTEGER AS new_visit,
                          ts - lag(ts) OVER w AS dt, lag(aid) OVER w AS prev_aid,
                          row_number() OVER (PARTITION BY session, aid, type ORDER BY ts) AS nth_same
                   FROM {events_sql} WINDOW w AS (PARTITION BY session ORDER BY ts, type, aid))
        SELECT *, sum(new_visit) OVER (PARTITION BY session ORDER BY ts, type, aid
                                       ROWS UNBOUNDED PRECEDING) AS visit
        FROM g""")
    df = con.execute("""
        WITH s AS (SELECT session, count(*) AS n_events, count(*) FILTER (WHERE type = 0) AS n_clicks,
                          count(*) FILTER (WHERE type = 0 AND nth_same > 1 AND prev_aid IS DISTINCT FROM aid) AS n_reviews,
                          median(dt) FILTER (WHERE new_visit = 0 AND dt > 0) AS pace_s
                   FROM le GROUP BY session),
        v AS (SELECT session, avg(n) AS exploration
              FROM (SELECT session, visit, count(DISTINCT aid) AS n FROM le WHERE type = 0 GROUP BY ALL)
              GROUP BY session),
        it AS (SELECT session, aid,
                      min(ts) FILTER (WHERE type = 0) AS first_click, min(visit) FILTER (WHERE type = 0) AS click_visit,
                      min(ts) FILTER (WHERE type = 1) AS first_cart, min(visit) FILTER (WHERE type >= 1) AS buy_visit,
                      bool_or(type = 0) AS clicked, bool_or(type = 1) AS carted, bool_or(type = 2) AS ordered
               FROM le GROUP BY ALL),
        i AS (SELECT session,
                     count(*) FILTER (WHERE clicked) AS clicked,
                     count(*) FILTER (WHERE clicked AND carted) AS click_carted,
                     count(*) FILTER (WHERE carted) AS carted,
                     count(*) FILTER (WHERE carted AND ordered) AS cart_ordered,
                     count(*) FILTER (WHERE carted OR ordered) AS bought,
                     count(*) FILTER (WHERE (carted OR ordered) AND click_visit < buy_visit) AS researched,
                     median(first_cart - first_click) FILTER (WHERE first_click <= first_cart) AS decide_s
              FROM it GROUP BY session)
        SELECT * FROM s JOIN i USING (session) LEFT JOIN v USING (session) ORDER BY session""").fetchdf()
    con.execute("DROP TABLE le")

    def sm(num, den):
        n, d = df[num].to_numpy(float), df[den].to_numpy(float)
        mu = n.sum() / max(d.sum(), 1.0)
        r = (n + K.PSEUDO * mu) / (d + K.PSEUDO)
        r[d == 0] = np.nan            # no evidence: no target
        return r

    return pd.DataFrame({
        "session": df["session"].to_numpy(),
        "n_events": df["n_events"].to_numpy(),
        "exploration": df["exploration"].to_numpy(float),
        "comparison": sm("n_reviews", "n_clicks"),
        "browsing_pace": -df["pace_s"].to_numpy(float),          # faster = higher
        "click_to_cart": sm("click_carted", "clicked"),
        "cart_to_order": sm("cart_ordered", "carted"),
        "decision_speed": -df["decide_s"].to_numpy(float),       # faster = higher
        "multi_visit_research": sm("researched", "bought"),
    })


def synthetic_events(path: Path, shoppers: int = 3000, seed: int = 0) -> Path:
    """OTTO-shaped fake events with built-in browsing styles, for the smoke test only (not real data)."""
    rng = np.random.default_rng(seed)
    rows = []
    for s in range(shoppers):
        explore = rng.uniform(1, 12)           # items per visit
        compare = rng.uniform(0, 0.4)          # chance a click returns to an earlier item
        pace = rng.lognormal(3.5, 0.8)         # seconds between events
        cart_p = rng.uniform(0.02, 0.3)
        order_p = rng.uniform(0.1, 0.9)
        n = int(rng.integers(60, 160))
        ts = 1_659_304_800 + int(rng.integers(0, 86_400 * 3))
        seen = []
        for _ in range(n):
            ts += int(rng.exponential(pace)) + 1
            if rng.random() < 1 / max(explore * 2, 2):
                ts += int(rng.integers(1_900, 200_000))          # new visit
            if seen and rng.random() < compare:
                aid = int(rng.choice(seen))
            else:
                aid = int(rng.integers(0, 50_000))
                seen.append(aid)
            rows.append((s, aid, ts, 0))
            if rng.random() < cart_p:
                ts += int(rng.exponential(pace * 2)) + 1
                rows.append((s, aid, ts, 1))
                if rng.random() < order_p:
                    rows.append((s, aid, ts + 5, 2))
    df = pd.DataFrame(rows, columns=["session", "aid", "ts", "type"]).astype(
        {"session": "int32", "aid": "int32", "ts": "int32", "type": "int8"})
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)
    return path
