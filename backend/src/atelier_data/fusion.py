"""H&M + OTTO fusion: 25 H&M profile values + 2 bridge + 9 estimated browsing values + match confidence = 37.

H&M and OTTO hold different people, so nobody is matched across datasets. Both sides compute the same
five purchase-based bridge features, each converted to a percentile of its own population. Every H&M
cohort shopper takes the mean browsing style of its k nearest OTTO donors in bridge space.

Stages:
  otto-download   kaggle datasets download otto/recsys-dataset (CC BY 4.0), train file only
  otto-ingest     train jsonl -> data/ingested/otto_events.parquet (session, aid, ts seconds, type 0/1/2)
  otto-features   ordering sessions -> data/processed/otto_donors.parquet (5 bridge + 9 browsing percentiles)
  fuse            -> data/processed/fused_{dev,final}.parquet and reports/fusion.json
"""
from __future__ import annotations

import subprocess
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.neighbors import NearestNeighbors

from .config import write_json
from .hashing import hex16
from .log import DataLog
from .percentiles import ecdf_midrank

OTTO_DATASET = "otto/recsys-dataset"
OTTO_TRAIN = "otto-recsys-train.jsonl"

# Bridge features: purchase behavior both datasets can measure, used only to find similar OTTO shoppers.
#   purchase_frequency  shopping days per month
#   basket_size         units bought per shopping day (OTTO: distinct items ordered per order day)
#   item_rebuy          share of units that repeat an item bought on an earlier day
#   mainstream_score    average popularity percentile of the items bought
#   activity_spread     normalized entropy of units across shopping days (0 = one big day, 1 = evenly spread)
# Every bridge value is a percentile within its own population, so a 4-week OTTO history and a
# two-year H&M history compare by rank rather than raw count.
BRIDGE = ["purchase_frequency", "basket_size", "item_rebuy", "mainstream_score", "activity_spread"]
NEW_BRIDGE = ["basket_size", "activity_spread"]  # the other bridge concepts are already profile values

# Browsing features, measured on OTTO donors and estimated for H&M shoppers. All are percentiles among donors.
#   click_to_cart         share of clicked items that were carted
#   cart_to_order         share of carted items that were ordered
#   comparison            share of clicks that return to an item seen earlier (not a consecutive repeat)
#   exploration           distinct items clicked per visit
#   decision_speed        median time from an item's first click to its cart, faster = higher
#   browsing_pace         median gap between events within a visit, faster = higher
#   multi_visit_research  share of bought items first found in an earlier visit
#   evening_share         share of events from 18:00 local time
#   weekend_share         share of events on Saturday or Sunday
BROWSING = ["click_to_cart", "cart_to_order", "comparison", "exploration", "decision_speed",
            "browsing_pace", "multi_visit_research", "evening_share", "weekend_share"]


def _otto_dir(cfg) -> Path:
    return cfg.paths.raw / "otto"


def _events_path(cfg) -> Path:
    return cfg.paths.ingested / "otto_events.parquet"


def _donors_path(cfg) -> Path:
    return cfg.paths.processed / "otto_donors.parquet"


def _tune(cfg, con):
    fz = cfg["fusion"]
    con.execute(f"SET memory_limit = '{fz['memory_limit']}'")
    con.execute(f"SET threads = {int(fz['threads'])}")


def download(cfg, con, force=False):
    d = _otto_dir(cfg)
    d.mkdir(parents=True, exist_ok=True)
    if (d / OTTO_TRAIN).exists() and not force:
        print(f"otto-download: {OTTO_TRAIN} present")
        return
    if not (Path.home() / ".kaggle" / "kaggle.json").exists():
        sys.exit("Kaggle credentials missing. Save your API token to ~/.kaggle/kaggle.json,\n"
                 f"or place {OTTO_TRAIN} from https://www.kaggle.com/datasets/{OTTO_DATASET} in {d}.")
    subprocess.run([sys.executable, "-m", "kaggle", "datasets", "download", "-d", OTTO_DATASET,
                    "-f", OTTO_TRAIN, "-p", str(d)], check=True)
    z = d / f"{OTTO_TRAIN}.zip"
    if z.exists():
        with zipfile.ZipFile(z) as zf:
            zf.extractall(d)
        z.unlink()


def ingest(cfg, con, force=False):
    out = _events_path(cfg)
    if out.exists() and not force:
        print(f"otto-ingest: {out.name} present")
        return
    src = _otto_dir(cfg) / OTTO_TRAIN
    if not src.exists():
        sys.exit(f"otto-ingest: {src} missing; run otto-download first")
    _tune(cfg, con)
    # ts is in milliseconds in the official files; stored as seconds.
    con.execute(f"""
        COPY (
          SELECT session::INTEGER AS session, e.aid::INTEGER AS aid, (e.ts // 1000)::INTEGER AS ts,
                 CASE e.type WHEN 'clicks' THEN 0 WHEN 'carts' THEN 1 WHEN 'orders' THEN 2 END::TINYINT AS type
          FROM (SELECT session, unnest(events) AS e
                FROM read_json('{src.as_posix()}', format='newline_delimited',
                               columns={{session: 'UBIGINT', events: 'STRUCT(aid UBIGINT, ts UBIGINT, type VARCHAR)[]'}},
                               maximum_object_size=268435456))
        ) TO '{out.as_posix()}' (FORMAT parquet, COMPRESSION zstd)""")
    n, s, bad = con.execute(f"""SELECT count(*), count(DISTINCT session), count(*) FILTER (WHERE type IS NULL)
                                FROM '{out.as_posix()}'""").fetchone()
    if bad:
        raise ValueError(f"otto-ingest: {bad} events with an unknown type")
    DataLog(cfg.paths.reports).append("otto-ingest", note=f"{n} events, {s} sessions")
    print(f"otto-ingest: {n:,} events, {s:,} sessions")


def donor_raw(con, events: str, fz: dict, a: int) -> pd.DataFrame:
    """Raw bridge and browsing values for every session with at least one order.

    A visit ends after `visit_gap_minutes` without events. Days and hours are local (fixed UTC offset).
    """
    gap, tz = int(fz["visit_gap_minutes"]) * 60, int(fz["utc_offset_hours"]) * 3600
    # Every event of an ordering session, annotated: gap since the previous event (dt), the previous item,
    # how many times this item was already seen with this event type (nth_same), a running visit number,
    # and the local day and hour.
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE ev AS
        WITH e AS (SELECT * FROM {events} WHERE session IN (SELECT session FROM {events} WHERE type = 2)),
        g AS (SELECT *, coalesce(ts - lag(ts) OVER w > {gap}, false)::INTEGER AS new_visit,
                     ts - lag(ts) OVER w AS dt, lag(aid) OVER w AS prev_aid,
                     row_number() OVER (PARTITION BY session, aid, type ORDER BY ts) AS nth_same
              FROM e WINDOW w AS (PARTITION BY session ORDER BY ts, type, aid))
        SELECT *, sum(new_visit) OVER (PARTITION BY session ORDER BY ts, type, aid
                                       ROWS UNBOUNDED PRECEDING) AS visit,
               (ts + {tz}) // 86400 AS day, ((ts + {tz}) % 86400) // 3600 AS hour
        FROM g""")
    end_day = con.execute("SELECT max(day) FROM ev").fetchone()[0]
    # One order line per (session, day, aid): OTTO has no quantity.
    con.execute("""
        CREATE OR REPLACE TEMP TABLE od AS
        SELECT *, day > min(day) OVER (PARTITION BY session, aid) AS rebought
        FROM (SELECT DISTINCT session, day, aid FROM ev WHERE type = 2)""")
    # One row per session. s: event-level counts; v: items explored per visit; it/i: per-item funnel
    # (clicked -> carted -> ordered) and timing; pop/b: order lines, rebuys and item popularity;
    # sp: how evenly orders spread over days.
    df = con.execute(f"""
        WITH s AS (
          SELECT session, count(*) AS n_events, min(day) AS first_day,
                 count(*) FILTER (WHERE type = 0) AS n_clicks,
                 count(*) FILTER (WHERE type = 0 AND nth_same > 1 AND prev_aid IS DISTINCT FROM aid) AS n_reviews,
                 count(*) FILTER (WHERE hour >= 18) AS n_evening,
                 count(*) FILTER (WHERE (day + 3) % 7 >= 5) AS n_weekend,   -- 1970-01-01 was a Thursday
                 median(dt) FILTER (WHERE new_visit = 0 AND dt > 0) AS pace_s
          FROM ev GROUP BY session),
        v AS (SELECT session, avg(n) AS exploration
              FROM (SELECT session, visit, count(DISTINCT aid) AS n FROM ev WHERE type = 0 GROUP BY ALL)
              GROUP BY session),
        it AS (SELECT session, aid,
                      min(ts) FILTER (WHERE type = 0) AS first_click, min(visit) FILTER (WHERE type = 0) AS click_visit,
                      min(ts) FILTER (WHERE type = 1) AS first_cart, min(visit) FILTER (WHERE type >= 1) AS buy_visit,
                      bool_or(type = 0) AS clicked, bool_or(type = 1) AS carted, bool_or(type = 2) AS ordered
               FROM ev GROUP BY ALL),
        i AS (SELECT session,
                     count(*) FILTER (WHERE clicked) AS clicked,
                     count(*) FILTER (WHERE clicked AND carted) AS click_carted,
                     count(*) FILTER (WHERE carted) AS carted,
                     count(*) FILTER (WHERE carted AND ordered) AS cart_ordered,
                     count(*) FILTER (WHERE carted OR ordered) AS bought,
                     count(*) FILTER (WHERE (carted OR ordered) AND click_visit < buy_visit) AS researched,
                     median(first_cart - first_click) FILTER (WHERE first_click <= first_cart) AS decide_s
              FROM it GROUP BY session),
        pop AS (SELECT aid, (rank() OVER (ORDER BY n) - 1 + 0.5 * count(*) OVER (PARTITION BY n))
                            / count(*) OVER () AS pct
                FROM (SELECT aid, count(*) AS n FROM od GROUP BY aid)),
        b AS (SELECT session, count(DISTINCT day) AS order_days, count(*) AS order_lines,
                     count(*) FILTER (WHERE rebought) AS rebuy_lines, avg(pct) AS pop_mean
              FROM od JOIN pop USING (aid) GROUP BY session),
        sp AS (SELECT session, CASE WHEN count(*) < 2 THEN 0.0 ELSE -sum(p * ln(p)) / ln(count(*)) END AS spread
               FROM (SELECT session, day, count(*)::DOUBLE / sum(count(*)) OVER (PARTITION BY session) AS p
                     FROM od GROUP BY session, day)
               GROUP BY session)
        SELECT * FROM s JOIN i USING (session) JOIN b USING (session) JOIN sp USING (session)
        LEFT JOIN v USING (session)
        ORDER BY session""").fetchdf()

    def sm(num, den):  # smoothed toward the donor-population rate, as in features.py
        num, den = df[num].to_numpy(float), df[den].to_numpy(float)
        mu = num.sum() / den.sum()
        return (num + a * mu) / (den + a)

    # Months observed: from the session's first day to the end of the data, at least one (as in features.py).
    months = np.maximum(1.0, (end_day - df["first_day"].to_numpy(float) + 1) / 30.4375)
    return pd.DataFrame({
        "session": df["session"].astype(np.int64),
        "purchase_frequency": df["order_days"] / months,
        "basket_size": df["order_lines"] / df["order_days"],
        "item_rebuy": df["rebuy_lines"] / df["order_lines"],
        "mainstream_score": df["pop_mean"],
        "activity_spread": df["spread"],
        "click_to_cart": sm("click_carted", "clicked"),
        "cart_to_order": sm("cart_ordered", "carted"),
        "comparison": sm("n_reviews", "n_clicks"),
        "exploration": df["exploration"].astype(float),
        "decision_speed": -df["decide_s"].astype(float),   # faster = higher
        "browsing_pace": -df["pace_s"].astype(float),
        "multi_visit_research": sm("researched", "bought"),
        "evening_share": sm("n_evening", "n_events"),
        "weekend_share": sm("n_weekend", "n_events"),
        "n_events": df["n_events"],
    })


def to_percentiles(raw: pd.DataFrame, cols) -> pd.DataFrame:
    """Mid-rank ECDF within the frame; a missing value sits at 0.5 (no evidence either way)."""
    out = raw.copy()
    for c in cols:
        v = raw[c].to_numpy(float).round(9)
        ok = np.isfinite(v)
        pct = np.full(len(v), 0.5)
        pct[ok] = ecdf_midrank(np.sort(v[ok]), v[ok])
        out[c] = pct
    return out


def features(cfg, con, force=False):
    out = _donors_path(cfg)
    if out.exists() and not force:
        print(f"otto-features: {out.name} present")
        return
    ev = _events_path(cfg)
    if not ev.exists():
        sys.exit(f"otto-features: {ev} missing; run otto-ingest first")
    _tune(cfg, con)
    fz = cfg["fusion"]
    raw = donor_raw(con, f"read_parquet('{ev.as_posix()}')", fz, int(cfg["features"]["pseudo_count"]))
    donors = to_percentiles(raw, BRIDGE + BROWSING)
    # Salted hash order: ties in bridge space must not favor low session ids.
    donors["donor_hash"] = [hex16(fz["donor_salt"], str(s)) for s in donors["session"]]
    donors = donors.sort_values("donor_hash", kind="stable").reset_index(drop=True)
    donors.to_parquet(out, index=False)
    DataLog(cfg.paths.reports).append("otto-features", note=f"{len(donors)} ordering sessions as donors")
    print(f"otto-features: {len(donors):,} donor sessions")


def hm_population_raw(con, units: str) -> pd.DataFrame:
    """Basket size, same-item rebuy share and day spread for every customer in a units file."""
    return con.execute(f"""
        WITH ad AS (SELECT customer_key, t_dat, article_key, sum(q) AS q FROM '{units}' GROUP BY ALL),
        rb AS (SELECT customer_key, sum(q) AS q, sum(q) FILTER (WHERE rebought) AS rq
               FROM (SELECT *, t_dat > min(t_dat) OVER (PARTITION BY customer_key, article_key) AS rebought FROM ad)
               GROUP BY customer_key),
        sp AS (SELECT customer_key, count(*) AS days,
                      CASE WHEN count(*) < 2 THEN 0.0 ELSE -sum(p * ln(p)) / ln(count(*)) END AS activity_spread
               FROM (SELECT customer_key, t_dat, sum(q)::DOUBLE / sum(sum(q)) OVER (PARTITION BY customer_key) AS p
                     FROM ad GROUP BY customer_key, t_dat)
               GROUP BY customer_key)
        SELECT customer_key, rb.q::DOUBLE / sp.days AS basket_size,
               coalesce(rb.rq, 0)::DOUBLE / rb.q AS item_rebuy, activity_spread
        FROM sp JOIN rb USING (customer_key) ORDER BY customer_key""").fetchdf()


def hm_bridge(cfg, con, cut: str) -> pd.DataFrame:
    """Profiles for the cohort plus bridge percentiles against the whole pre-cutoff population.

    purchase_frequency and mainstream_score are already population percentiles in the profile.
    """
    units = (cfg.paths.interim / f"units_{cut}.parquet").as_posix()
    pct = to_percentiles(hm_population_raw(con, units), ["basket_size", "item_rebuy", "activity_spread"])
    prof = pd.read_parquet(cfg.paths.processed / f"profiles_{cut}_Eall.parquet")
    hm = prof.merge(pct, on="customer_key", how="left", validate="one_to_one")
    if hm[["basket_size", "item_rebuy", "activity_spread"]].isna().any().any():
        raise ValueError(f"fuse: cohort shoppers without units at {cut}")
    return hm


def profile_values(cols) -> list[str]:
    cols = list(cols)
    out = cols[cols.index("cat_garment_upper_body"):cols.index("mainstream_score") + 1]
    if len(out) != 25:
        raise ValueError(f"fuse: expected 25 profile values, found {len(out)}")
    return out


def knn(donor_x: np.ndarray, query_x: np.ndarray, k: int):
    return NearestNeighbors(n_neighbors=k, algorithm="kd_tree").fit(donor_x).kneighbors(query_x)


def predictability(dx, db, k, salt, hashes) -> dict:
    """How much of OTTO browsing the bridge explains: kNN from 80% of donors predicting the other 20%.

    R^2 near 0 means an estimated browsing column carries little beyond the population mean.
    """
    test = np.array([int(hex16(salt, h)[:8], 16) % 5 == 0 for h in hashes])
    _, idx = knn(dx[~test], dx[test], k)
    pred, y = db[~test][idx].mean(axis=1), db[test]
    r2 = 1 - ((y - pred) ** 2).sum(axis=0) / ((y - y.mean(axis=0)) ** 2).sum(axis=0)
    return {"holdout_donors": int(test.sum()), "r2": dict(zip(BROWSING, np.round(r2, 4)))}


def fuse_frame(hm: pd.DataFrame, dx: np.ndarray, db: np.ndarray, k: int) -> pd.DataFrame:
    """One fused row per H&M shopper: profile + new bridge values + donor-mean browsing + match confidence.

    dx holds the donors' bridge percentiles, db their browsing percentiles, in the same row order.
    """
    dist, idx = knn(dx, hm[BRIDGE].to_numpy(float), k)
    mean_d = dist.mean(axis=1)
    half = float(np.median(mean_d))
    out = hm[["customer_key", "stratum", "inclusion_weight"] + profile_values(hm.columns) + NEW_BRIDGE].copy()
    est = db[idx].mean(axis=1)  # each shopper's browsing = plain mean over its k nearest donors
    for j, c in enumerate(BROWSING):
        out[c] = est[:, j]
    # 0.5 at the cohort's median neighbor distance, halving with every further median distance.
    out["match_confidence"] = 0.5 ** (mean_d / half) if half > 0 else 1.0
    out["match_distance"] = mean_d
    return out


def vector_columns(out: pd.DataFrame) -> list[str]:
    """The 37 vector values in their fixed order; customer_key, stratum, weight and distance sit outside."""
    return profile_values(out.columns) + NEW_BRIDGE + BROWSING + ["match_confidence"]


def fuse(cfg, con, force=False):
    """Fuse both cutoffs against the same donor pool and write the quality report.

    The OTTO donors carry no time relation to H&M, and the H&M bridge uses only pre-cutoff units,
    so fusion adds no leakage into either target window.
    """
    fz = cfg["fusion"]
    k = int(fz["k"])
    _tune(cfg, con)
    donors = pd.read_parquet(_donors_path(cfg))
    dx, db = donors[BRIDGE].to_numpy(float), donors[BROWSING].to_numpy(float)
    report = {"donors": len(donors), "k": k, "bridge": BRIDGE, "browsing": BROWSING,
              "bridge_predictability": predictability(dx, db, k, fz["holdout_salt"], donors["donor_hash"])}
    for cut in ("dev", "final"):
        out = fuse_frame(hm_bridge(cfg, con, cut), dx, db, k)
        vec = vector_columns(out)
        if len(vec) != int(fz["vector_dims"]):
            raise ValueError(f"fuse: vector has {len(vec)} values, config says {fz['vector_dims']}")
        out.to_parquet(cfg.paths.processed / f"fused_{cut}.parquet", index=False)
        # Estimated browsing has a much smaller spread than the donors' own: averaging k donors pulls
        # every shopper toward the mean, and more so where the bridge predicts browsing poorly.
        report[cut] = {
            "rows": len(out), "vector": vec,
            "match_distance_median": float(out["match_distance"].median()),
            "match_confidence_median_by_stratum": out.groupby("stratum")["match_confidence"].median().round(4).to_dict(),
            "browsing_sd_estimated": dict(zip(BROWSING, out[BROWSING].std().round(4))),
            "browsing_sd_donors": dict(zip(BROWSING, db.std(axis=0).round(4))),
        }
        print(f"fuse[{cut}]: {len(out):,} shoppers x {len(vec)} values")
    write_json(cfg.paths.reports / "fusion.json", report)
    DataLog(cfg.paths.reports).append("fuse", note=f"k={k}, donors={len(donors)}")
