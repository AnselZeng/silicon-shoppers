"""Item ranker for the homepage product tiles: candidate generation + LightGBM LambdaRank.

Candidates per shopper (all from data before the cutoff):
  rebuy     - articles the shopper bought before (most recent first)
  variant   - other articles of products the shopper bought in the last 180 days (other colors/sizes of a product)
  pop       - the store's top sellers in the last 7 days
  segment   - top sellers in the last 7 days within the shopper's favorite (department, category) segments
  copurch   - articles other shoppers bought on the same day as the shopper's most recent articles (last 8 weeks)
  new       - best-selling new arrivals (first sold within 28 days) in the shopper's favorite departments
Each (shopper, article) pair gets shopper features, article features and match features, and the ranker learns
which candidates are bought in the 28-day target window. Scored with MAP@12 (the H&M competition metric).
"""
from __future__ import annotations

import datetime as dt
import warnings

import lightgbm as lgb
import numpy as np
import pandas as pd

from atelier_data import references
from atelier_data.config import read_json

warnings.filterwarnings("ignore", message=".*X does not have valid feature names.*")
warnings.filterwarnings("ignore", message=".*eval_set.*")

N_REBUY, N_VARIANT, N_POP, N_SEG, N_SEGS, N_CO, N_NEW = 20, 12, 40, 16, 4, 15, 12
CO_DAYS, CO_SOURCES = 56, 6
USER_COLS = ["price_level", "markdown_affinity", "novelty_affinity", "rebuy_share", "channel_2_share",
             "purchase_frequency", "mainstream_score", "basket_size", "activity_spread", "exploration",
             "multi_visit_research", "match_confidence", "units_all", "days_all", "units_30d", "units_90d",
             "days_since_last", "mean_gap_days"]
PARAMS = dict(objective="lambdarank", n_estimators=600, learning_rate=0.05, num_leaves=63, min_child_samples=50,
              subsample=0.8, subsample_freq=1, colsample_bytree=0.8, verbose=-1, lambdarank_truncation_level=20)


def _cutoff(cfg, cut):
    return dt.date.fromisoformat(read_json(cfg.paths.reports / "split_manifest.json")[cut]["cutoff"])


def prepare(con, cfg, cut: str, vocab: dict):
    """Per-cut article and history tables shared by every chunk of shoppers."""
    cutoff = _cutoff(cfg, cut)
    units = cfg.paths.interim / f"units_{cut}.parquet"
    refs = cfg.paths.refs(cut)
    references.register_cat_map(con, vocab)
    ncat = len(vocab["category_keys"])
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE art AS
        WITH p AS (SELECT article_key,
                          sum(q) FILTER (WHERE t_dat >= DATE '{cutoff}' - INTERVAL 7 DAY) AS u7,
                          sum(q) FILTER (WHERE t_dat >= DATE '{cutoff}' - INTERVAL 28 DAY) AS u28,
                          sum(q) FILTER (WHERE t_dat >= DATE '{cutoff}' - INTERVAL 7 DAY AND channel = 2) AS u7_online
                   FROM read_parquet('{units}') WHERE t_dat >= DATE '{cutoff}' - INTERVAL 28 DAY GROUP BY 1)
        SELECT a.article_key, a.product_code_key, a.product_type_key, a.dept_code, a.master_code, a.is_solid,
               coalesce(cm.cat_idx, {ncat - 1}) AS cat_idx,
               coalesce(p.u7, 0) AS u7, coalesce(p.u28, 0) AS u28,
               coalesce(p.u7_online, 0) / greatest(coalesce(p.u7, 0), 1) AS online7,
               r.last_price, r.art_pop_pct, date_diff('day', r.first_seen, DATE '{cutoff}') AS item_age
        FROM articles a LEFT JOIN cat_map cm ON cm.group_code = a.group_code
        LEFT JOIN p USING (article_key)
        LEFT JOIN read_parquet('{refs}/article_ref.parquet') r USING (article_key)""")
    con.execute("""
        CREATE OR REPLACE TEMP TABLE art2 AS
        SELECT *, u7 / greatest(u28 / 4.0, 1) AS trend,
               rank() OVER (ORDER BY u7 DESC, u28 DESC, article_key) AS pop_rank,
               rank() OVER (PARTITION BY dept_code, cat_idx ORDER BY u7 DESC, u28 DESC, article_key) AS seg_rank,
               last_price / median(last_price) OVER (PARTITION BY product_type_key) AS rel_price
        FROM art""")
    # same-day co-purchase counts among recent baskets (customer-day), for the copurch source
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE co AS
        WITH b AS (SELECT DISTINCT customer_key, t_dat, article_key FROM read_parquet('{units}')
                   WHERE t_dat >= DATE '{cutoff}' - INTERVAL {CO_DAYS} DAY)
        SELECT x.article_key AS src, y.article_key AS dst, count(*) AS n
        FROM b x JOIN b y ON x.customer_key = y.customer_key AND x.t_dat = y.t_dat AND x.article_key <> y.article_key
        GROUP BY 1, 2 HAVING count(*) >= 2""")
    return {"cutoff": cutoff, "units": units}


def candidates(con, cut_info: dict, keys: np.ndarray) -> pd.DataFrame:
    """Candidate pairs with source flags and pair features for the given shoppers."""
    cutoff, units = cut_info["cutoff"], cut_info["units"]
    con.register("ck", pd.DataFrame({"customer_key": keys.astype("int32")}))
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE uh AS
        SELECT u.customer_key, u.article_key, sum(u.q) AS u_units, count(DISTINCT u.t_dat) AS u_days,
               min(date_diff('day', u.t_dat, DATE '{cutoff}')) AS u_age, sum(u.w) AS u_w
        FROM read_parquet('{units}') u JOIN ck USING (customer_key) GROUP BY 1, 2""")
    con.execute("""
        CREATE OR REPLACE TEMP TABLE useg AS
        SELECT customer_key, dept_code, cat_idx, w,
               row_number() OVER (PARTITION BY customer_key ORDER BY w DESC, dept_code, cat_idx) AS r
        FROM (SELECT uh.customer_key, a.dept_code, a.cat_idx, sum(uh.u_w) AS w
              FROM uh JOIN art2 a USING (article_key) GROUP BY 1, 2, 3)""")
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE cand AS
        WITH rebuy AS (
            SELECT customer_key, article_key FROM (
                SELECT customer_key, article_key,
                       row_number() OVER (PARTITION BY customer_key ORDER BY u_age, u_units DESC, article_key) AS r
                FROM uh) WHERE r <= {N_REBUY}),
        variant AS (
            SELECT customer_key, article_key FROM (
                SELECT DISTINCT ON (x.customer_key, a.article_key) x.customer_key, a.article_key, a.u28
                FROM (SELECT uh.customer_key, ar.product_code_key FROM uh JOIN art2 ar USING (article_key)
                      WHERE uh.u_age < 180) x
                JOIN art2 a ON a.product_code_key = x.product_code_key AND a.u28 > 0)
            QUALIFY row_number() OVER (PARTITION BY customer_key ORDER BY u28 DESC, article_key) <= {N_VARIANT}),
        pop AS (SELECT ck.customer_key, a.article_key FROM ck CROSS JOIN (SELECT article_key FROM art2
                WHERE pop_rank <= {N_POP}) a),
        seg AS (SELECT s.customer_key, a.article_key FROM useg s JOIN art2 a
                ON a.dept_code = s.dept_code AND a.cat_idx = s.cat_idx AND a.seg_rank <= {N_SEG} AND a.u7 > 0
                WHERE s.r <= {N_SEGS}),
        recent AS (SELECT customer_key, article_key FROM uh
                   QUALIFY row_number() OVER (PARTITION BY customer_key ORDER BY u_age, u_units DESC, article_key)
                           <= {CO_SOURCES}),
        copurch AS (SELECT customer_key, article_key FROM (
                        SELECT r.customer_key, co.dst AS article_key, sum(co.n) AS n
                        FROM recent r JOIN co ON co.src = r.article_key GROUP BY 1, 2)
                    QUALIFY row_number() OVER (PARTITION BY customer_key ORDER BY n DESC, article_key) <= {N_CO}),
        topdept AS (SELECT customer_key, dept_code FROM (SELECT customer_key, dept_code, sum(w) AS w FROM useg GROUP BY 1, 2)
                    QUALIFY row_number() OVER (PARTITION BY customer_key ORDER BY w DESC, dept_code) <= 2),
        newa AS (SELECT * FROM (SELECT article_key, dept_code,
                     row_number() OVER (PARTITION BY dept_code ORDER BY u7 DESC, article_key) AS r
                 FROM art2 WHERE item_age <= 28 AND u7 > 0) WHERE r <= {N_NEW}),
        newc AS (SELECT t.customer_key, n.article_key FROM topdept t JOIN newa n USING (dept_code)),
        allc AS (SELECT *, 'rebuy' AS src FROM rebuy UNION ALL SELECT *, 'variant' FROM variant
                 UNION ALL SELECT *, 'pop' FROM pop UNION ALL SELECT *, 'seg' FROM seg
                 UNION ALL SELECT *, 'copurch' FROM copurch UNION ALL SELECT *, 'new' FROM newc)
        SELECT customer_key, article_key,
               max((src = 'rebuy')::INT) AS s_rebuy, max((src = 'variant')::INT) AS s_variant,
               max((src = 'pop')::INT) AS s_pop, max((src = 'seg')::INT) AS s_seg,
               max((src = 'copurch')::INT) AS s_copurch, max((src = 'new')::INT) AS s_new
        FROM allc GROUP BY 1, 2""")
    df = con.execute("""
        WITH pc AS (SELECT uh.customer_key, a.product_code_key, sum(uh.u_units) AS pc_units, min(uh.u_age) AS pc_age
                    FROM uh JOIN art2 a USING (article_key) GROUP BY 1, 2),
        tot AS (SELECT customer_key, sum(u_w) AS w_tot FROM uh GROUP BY 1)
        SELECT c.*, a.u7, a.u28, a.trend, a.online7, a.pop_rank, a.seg_rank, a.last_price, a.rel_price,
               a.art_pop_pct, a.item_age, a.cat_idx, a.dept_code, a.master_code, a.is_solid::INT AS is_solid,
               coalesce(h.u_units, 0) AS bought_units, h.u_age AS bought_age,
               coalesce(pc.pc_units, 0) AS product_units, pc.pc_age AS product_age,
               coalesce(sg.w, 0) / tot.w_tot AS seg_affinity, coalesce(sg.r, 99) AS seg_pref_rank
        FROM cand c JOIN art2 a USING (article_key)
        LEFT JOIN uh h USING (customer_key, article_key)
        LEFT JOIN pc ON pc.customer_key = c.customer_key AND pc.product_code_key = a.product_code_key
        LEFT JOIN useg sg ON sg.customer_key = c.customer_key AND sg.dept_code = a.dept_code AND sg.cat_idx = a.cat_idx
        LEFT JOIN tot ON tot.customer_key = c.customer_key
        ORDER BY c.customer_key, c.article_key""").df()
    for t in ("uh", "useg", "cand"):
        con.execute(f"DROP TABLE {t}")
    con.unregister("ck")
    return df


def add_user_features(df: pd.DataFrame, user: pd.DataFrame, user_cols=None) -> pd.DataFrame:
    """Shopper columns plus shopper-article match features (category/department/color share, price fit)."""
    u = user.set_index("customer_key")
    idx = u.index.get_indexer(df["customer_key"])
    out = df.copy()
    for c in ("cat_idx", "dept_code", "master_code"):
        out[c] = out[c].fillna(-1).astype(int)
    for c in (USER_COLS if user_cols is None else user_cols):
        out[f"u_{c}"] = u[c].to_numpy()[idx]
    cat = u[[f"hcat_all_{i}" for i in range(8)]].to_numpy()[idx]
    dep = u[[f"hdept_all_{i}" for i in range(5)]].to_numpy()[idx]
    mc = u[[c for c in u.columns if c.startswith("hmc_all_")]].to_numpy()[idx]
    cat90 = u[[f"hcat_90d_{i}" for i in range(8)]].to_numpy()[idx]
    r = np.arange(len(out))
    ci = np.clip(out["cat_idx"].to_numpy(), 0, 7)
    out["m_cat"] = cat[r, ci]
    out["m_cat90"] = cat90[r, ci]
    d = out["dept_code"].to_numpy()
    out["m_dept"] = np.where(d >= 0, dep[r, np.clip(d, 0, 4)], np.nan)
    m = out["master_code"].to_numpy()
    out["m_color"] = np.where((m >= 0) & (m < mc.shape[1]), mc[r, np.clip(m, 0, mc.shape[1] - 1)], np.nan)
    out["m_price_gap"] = out["art_pop_pct"] - out["u_price_level"]
    return out


FEATURES = None  # set on first call


def feature_cols(df: pd.DataFrame) -> list[str]:
    drop = {"customer_key", "article_key", "label"}
    return [c for c in df.columns if c not in drop]


def attach_labels(df: pd.DataFrame, targets: pd.DataFrame) -> pd.DataFrame:
    t = targets[["customer_key", "article_key"]].drop_duplicates().assign(label=1)
    out = df.merge(t, on=["customer_key", "article_key"], how="left")
    out["label"] = out["label"].fillna(0).astype(int)
    return out


def map_at_k(pred: dict, truth: dict, k: int = 12) -> float:
    """Mean over shoppers in `truth` of AP@k (Kaggle H&M definition); shoppers with no predictions score 0."""
    aps = []
    for u, actual in truth.items():
        p = pred.get(u, [])[:k]
        hits, s = 0, 0.0
        for i, a in enumerate(p):
            if a in actual:
                hits += 1
                s += hits / (i + 1)
        aps.append(s / min(len(actual), k))
    return float(np.mean(aps)) if aps else 0.0


def topk(df: pd.DataFrame, score: np.ndarray, k: int) -> dict:
    d = df[["customer_key", "article_key"]].assign(s=score).sort_values(["customer_key", "s"], ascending=[True, False])
    d = d.groupby("customer_key").head(k)
    return d.groupby("customer_key")["article_key"].apply(list).to_dict()


def fit_ranker(df: pd.DataFrame, cols: list[str], seed: int, n_estimators=None, valid=None):
    df = df.sort_values("customer_key", kind="stable")
    grp = df.groupby("customer_key", sort=False).size().to_numpy()
    m = lgb.LGBMRanker(random_state=seed, **{**PARAMS, **({"n_estimators": n_estimators} if n_estimators else {})})
    if valid is not None:
        v = valid.sort_values("customer_key", kind="stable")
        m.fit(df[cols], df["label"], group=grp, eval_set=[(v[cols], v["label"])],
              eval_group=[v.groupby("customer_key", sort=False).size().to_numpy()], eval_at=[12],
              callbacks=[lgb.early_stopping(50, verbose=False)])
    else:
        m.fit(df[cols], df["label"], group=grp)
    return m
