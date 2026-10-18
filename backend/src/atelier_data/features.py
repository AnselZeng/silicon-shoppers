"""8.7 features: 25-value profiles, evidence, E budgets and halves (customer-level SQL, numpy finish)."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from . import cohort as cohort_mod
from . import db, references, splits, units
from .config import read_json, write_json
from .log import DataLog
from .percentiles import ecdf_midrank

SCALAR_FEATURES = ["solid_share", "price_level", "markdown_affinity", "novelty_affinity", "rebuy_share",
                   "channel_2_share", "purchase_frequency", "mainstream_score"]
COLOR_KEYS = ["color_neutral", "color_warm", "color_cool"]
EVIDENCE = ["units_used", "rows_raw", "shopping_days", "first_date", "last_date", "history_days",
            "days_since_last", "known_color_units", "color_coverage", "confidence", "top_colors", "top_groups"]


def feature_order(vocab: dict) -> list[str]:
    return (vocab["category_keys"] + vocab["department_keys"] + COLOR_KEYS + ["color_concentration", "solid_share",
            "price_level", "markdown_affinity", "novelty_affinity", "rebuy_share", "channel_2_share",
            "purchase_frequency", "mainstream_score"])


# ---------- SQL ----------

def flags_sql(cfg, units_rel: str, refs_dir, data_start, ncat: int) -> str:
    """Per-unit attribute flags. Requires temp table cat_map (group_code -> cat_idx)."""
    f = cfg["features"]
    m = f["anchor_min_rows"]
    anc = (f"CASE WHEN coalesce(c.n, 0) >= {m} THEN c.anchor "
           f"WHEN coalesce(r.pooled_n, 0) >= {m} THEN r.pooled_anchor END")
    return f"""
        SELECT u.customer_key, u.t_dat, u.channel, u.article_key, u.n_rows, u.q, u.w, u.price_pct,
               coalesce(cm.cat_idx, {ncat - 1}) AS cat_idx, a.dept_code AS dept_idx, a.fam_code AS fam,
               a.master_code, a.group_code, a.is_solid, r.art_pop_pct,
               ({anc}) IS NOT NULL AND u.price_mean IS NOT NULL AS md_elig,
               coalesce(u.price_mean <= {f['markdown_ratio']} * ({anc}), false) AS md,
               r.first_seen >= DATE '{data_start}' + INTERVAL {f['novelty_left_censor_days']} DAY AS nov_elig,
               date_diff('day', r.first_seen, u.t_dat) <= {f['novelty_days']} AS nov,
               u.t_dat > min(u.t_dat) OVER (PARTITION BY u.customer_key, a.product_code_key) AS rebuy
        FROM {units_rel} u
        JOIN articles a USING (article_key)
        JOIN read_parquet('{refs_dir}/article_ref.parquet') r USING (article_key)
        LEFT JOIN cat_map cm ON cm.group_code = a.group_code
        LEFT JOIN read_parquet('{refs_dir}/anchor_cells.parquet') c
               ON c.article_key = u.article_key AND c.channel = u.channel"""


def customer_sums_sql(flags_rel: str, cutoff) -> str:
    return f"""
        SELECT customer_key, sum(q) AS units_used, sum(n_rows) AS rows_raw, count(DISTINCT t_dat) AS shopping_days,
               min(t_dat) AS first_date, max(t_dat) AS last_date,
               date_diff('day', min(t_dat), DATE '{cutoff}') AS span_days,
               {db.xsum('w')} AS w_all,
               {db.xsum('w', 'dept_idx IS NOT NULL')} AS w_dept,
               {db.xsum('w', 'fam < 3')} AS w_known,
               sum(q) FILTER (WHERE fam < 3) AS known_units,
               {db.xsum('w', 'price_pct IS NOT NULL')} AS w_pp,
               {db.xsum('w * price_pct', 'price_pct IS NOT NULL')} AS wpp,
               {db.xsum('w', 'is_solid')} AS w_solid,
               {db.xsum('w', 'md_elig')} AS w_md_elig,
               {db.xsum('w', 'md_elig AND md')} AS w_md,
               {db.xsum('w', 'nov_elig')} AS w_nov_elig,
               {db.xsum('w', 'nov_elig AND nov')} AS w_nov,
               {db.xsum('w', 'rebuy')} AS w_rebuy,
               {db.xsum('w', 'channel = 2')} AS w_ch2,
               {db.xsum('w * art_pop_pct')} AS w_pop
        FROM {flags_rel} GROUP BY customer_key ORDER BY customer_key"""


def budget_sql(cfg, units_rel: str, E, cutoff) -> str:
    """Most recent E units (t_dat DESC, article_key ASC, channel ASC); q_eff = least(q, E - cum_prev)."""
    if E == "all":
        return units_rel
    hl = cfg["units"]["recency_half_life_days"]
    return f"""(
        WITH b AS (SELECT *, coalesce(sum(q) OVER (PARTITION BY customer_key ORDER BY t_dat DESC, article_key, channel
                                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS cum_prev
                   FROM {units_rel})
        SELECT customer_key, t_dat, channel, article_key, n_rows,
               least(q, {int(E)} - cum_prev)::INTEGER AS q, price_mean, price_pct,
               least(q, {int(E)} - cum_prev) * pow(2, -date_diff('day', t_dat, DATE '{cutoff}')::DOUBLE / {hl}) AS w
        FROM b WHERE cum_prev < {int(E)})"""


def halves_sql(units_rel: str, which: str) -> str:
    cond = "rn <= ceil(ng / 2.0)" if which == "early" else "rn > ceil(ng / 2.0)"
    return f"""(
        WITH o AS (SELECT *, row_number() OVER (PARTITION BY customer_key ORDER BY t_dat, article_key, channel) AS rn,
                          count(*) OVER (PARTITION BY customer_key) AS ng FROM {units_rel})
        SELECT * EXCLUDE (rn, ng) FROM o WHERE {cond})"""


def keyed_units(units_path, keys_table: str) -> str:
    return (f"(SELECT * FROM read_parquet('{units_path}') "
            f"WHERE customer_key IN (SELECT customer_key FROM {keys_table}))")


# ---------- numpy ----------

def _f(agg, col):
    return agg[col].fillna(0).to_numpy(dtype=float)


# Parallel float sums differ in the last bits between runs; rounding before ECDF lookups and
# tie-break sorts keeps mid-rank ties and alphabetical tie-breaks deterministic.
TIE_DECIMALS = 9


def scalar_raws(agg: pd.DataFrame, priors: dict, cfg) -> dict:
    k = cfg["features"]["pseudo_count"]
    w_all = _f(agg, "w_all")
    raws = {
        "price_level": (_f(agg, "wpp") + k * 0.5) / (_f(agg, "w_pp") + k),
        "purchase_frequency": _f(agg, "shopping_days") / np.maximum(1.0, _f(agg, "span_days") / 30.4375),
        "mainstream_score": (_f(agg, "w_pop") + k * round(priors["mu"], TIE_DECIMALS)) / (w_all + k),
    }
    return {n: np.round(v, TIE_DECIMALS) for n, v in raws.items()}


def smoothed(num, den, prior, k):
    """(num + k*prior) / (den + k); num may be a (customers x keys) matrix with a prior vector."""
    den = np.asarray(den, dtype=float)
    if np.ndim(num) == 2:
        den = den[:, None]
    return (num + k * np.asarray(prior)) / (den + k)


def pivot(long: pd.DataFrame, keys: np.ndarray, n: int) -> np.ndarray:
    m = np.zeros((len(keys), n))
    if len(long):
        np.add.at(m, (np.searchsorted(keys, long["customer_key"].to_numpy()), long["k"].to_numpy().astype(int)),
                  long["s"].to_numpy(dtype=float))
    return m


def top_names(long: pd.DataFrame, keys: np.ndarray, names: list, n: int) -> list:
    """Top n codes by sum w per customer (ties: code ascending, which is alphabetical)."""
    out = [[] for _ in keys]
    if len(long):
        d = long.assign(s=long["s"].round(TIE_DECIMALS))
        d = d[d["s"] > 0].sort_values(["customer_key", "s", "k"], ascending=[True, False, True], kind="stable")
        d = d.groupby("customer_key", sort=False).head(n)
        for ck, code in zip(d["customer_key"].to_numpy(), d["k"].to_numpy()):
            out[np.searchsorted(keys, ck)].append(names[int(code)])
    return out


def round_block(m: np.ndarray, decimals: int = 6) -> np.ndarray:
    """Round a share block and put the residual on each row's largest share so rows still sum to 1."""
    r = np.round(m, decimals)
    top = r.argmax(axis=1)
    rows = np.arange(len(r))
    r[rows, top] = np.round(r[rows, top] + (1.0 - r.sum(axis=1)), decimals)
    return r


def cat_breadth(shares: np.ndarray) -> np.ndarray:
    p = np.clip(shares, 1e-300, None)
    return -(shares * np.log(p)).sum(axis=1) / math.log(shares.shape[1])


def assemble(con, cfg, refs: references.Refs, cutoff) -> pd.DataFrame:
    """Build profiles from temp table `fl` (flags of the kept units)."""
    k = cfg["features"]["pseudo_count"]
    v, pr = refs.vocab, refs.priors
    agg = con.execute(customer_sums_sql("fl", cutoff)).df()
    keys = agg["customer_key"].to_numpy()

    def long(col, where="TRUE"):
        return con.execute(f"SELECT customer_key, {col} AS k, {db.xsum('w')} AS s FROM fl "
                           f"WHERE {col} IS NOT NULL AND {where} GROUP BY 1, 2").df()

    ncat, ndept, K = len(v["category_keys"]), len(v["department_keys"]), len(v["master_colors"])
    w_all, w_known = _f(agg, "w_all"), _f(agg, "w_known")
    out = {"customer_key": keys}
    cat = smoothed(pivot(long("cat_idx"), keys, ncat), w_all, pr["category"], k)
    dept = smoothed(pivot(long("dept_idx"), keys, ndept), _f(agg, "w_dept"), pr["department"], k)
    fam = smoothed(pivot(long("fam", "fam < 3"), keys, 3), w_known, pr["color_family"], k)
    master_long = long("master_code")
    s_m = smoothed(pivot(master_long, keys, K), w_known, pr["master_color"], k)
    hhi = (s_m ** 2).sum(axis=1)
    conc = np.clip((hhi - 1 / K) / (1 - 1 / K), 0, 1) if K > 1 else np.zeros(len(keys))
    for i, key in enumerate(v["category_keys"]):
        out[key] = cat[:, i]
    for i, key in enumerate(v["department_keys"]):
        out[key] = dept[:, i]
    for i, key in enumerate(COLOR_KEYS):
        out[key] = fam[:, i]
    raws = scalar_raws(agg, pr, cfg)
    out["color_concentration"] = conc
    out["solid_share"] = smoothed(_f(agg, "w_solid"), w_all, pr["is_solid"], k)
    out["price_level"] = ecdf_midrank(refs.pop["price_level"], raws["price_level"])
    out["markdown_affinity"] = smoothed(_f(agg, "w_md"), _f(agg, "w_md_elig"), pr["markdown"], k)
    out["novelty_affinity"] = smoothed(_f(agg, "w_nov"), _f(agg, "w_nov_elig"), pr["novel"], k)
    out["rebuy_share"] = smoothed(_f(agg, "w_rebuy"), w_all, pr["rebuy"], k)
    out["channel_2_share"] = smoothed(_f(agg, "w_ch2"), w_all, pr["channel_2"], k)
    out["purchase_frequency"] = ecdf_midrank(refs.pop["purchase_frequency"], raws["purchase_frequency"])
    out["mainstream_score"] = ecdf_midrank(refs.pop["mainstream_score"], raws["mainstream_score"])
    df = pd.DataFrame(out)
    fo = feature_order(v)
    df[fo] = df[fo].round(6)
    for blk in (v["category_keys"], v["department_keys"], COLOR_KEYS):
        df[blk] = round_block(df[blk].to_numpy())
    df["cat_breadth"] = cat_breadth(df[v["category_keys"]].to_numpy())

    # evidence
    c = cfg["confidence"]
    units_used = agg["units_used"].to_numpy()
    df["units_used"] = units_used.astype(int)
    df["rows_raw"] = agg["rows_raw"].to_numpy().astype(int)
    df["shopping_days"] = agg["shopping_days"].to_numpy().astype(int)
    df["first_date"] = pd.to_datetime(agg["first_date"]).dt.date
    df["last_date"] = pd.to_datetime(agg["last_date"]).dt.date
    df["history_days"] = [(b - a).days for a, b in zip(df["first_date"], df["last_date"])]
    cut = pd.Timestamp(cutoff).date()
    df["days_since_last"] = [(cut - b).days for b in df["last_date"]]
    df["known_color_units"] = _f(agg, "known_units").astype(int)
    df["color_coverage"] = df["known_color_units"] / np.maximum(units_used, 1)
    df["confidence"] = np.where(units_used < c["low_below_units"], "low",
                                np.where(units_used >= c["high_from_units"], "high", "medium"))
    df["top_colors"] = top_names(master_long, keys, v["master_colors"], cfg["rules"]["color_top_n"])
    df["top_groups"] = top_names(long("group_code"), keys, v["group_names"], 3)
    return df


def build_profiles(con, cfg, refs, units_rel: str, cutoff, data_start) -> pd.DataFrame:
    ncat = len(refs.vocab["category_keys"])
    references.register_cat_map(con, refs.vocab)
    con.execute(f"CREATE OR REPLACE TEMP TABLE fl AS {flags_sql(cfg, units_rel, refs.dir, data_start, ncat)}")
    df = assemble(con, cfg, refs, cutoff)
    con.execute("DROP TABLE fl")
    return df


def attach_cohort(df: pd.DataFrame, coh: pd.DataFrame, con) -> pd.DataFrame:
    news = con.execute("SELECT customer_key, newsletter FROM customers").df()
    df = df.merge(coh[["customer_key", "stratum", "inclusion_weight"]], on="customer_key", how="left")
    df = df.merge(news, on="customer_key", how="left")
    df["newsletter"] = df["newsletter"].fillna("unknown")
    lead = ["customer_key", "stratum", "inclusion_weight"]
    return df[lead + [c for c in df.columns if c not in lead]].sort_values("customer_key").reset_index(drop=True)


def build_halves(con, cfg, refs, units_path, keys_table, cutoff, data_start, full: pd.DataFrame):
    elig = full.loc[full["units_used"] >= cfg["reliability"]["min_units"], ["customer_key"]]
    con.register("halves_keys_df", elig)
    con.execute("CREATE OR REPLACE TEMP TABLE halves_keys AS SELECT * FROM halves_keys_df")
    base = keyed_units(units_path, "halves_keys")
    parts = {h: build_profiles(con, cfg, refs, halves_sql(base, h), cutoff, data_start) for h in ("early", "late")}
    ok = set(parts["early"].loc[parts["early"]["units_used"] >= 3, "customer_key"]) & \
        set(parts["late"].loc[parts["late"]["units_used"] >= 3, "customer_key"])
    out = pd.concat([p[p["customer_key"].isin(ok)].assign(half=h) for h, p in parts.items()])
    return out.sort_values(["customer_key", "half"]).reset_index(drop=True), len(elig)


# ---------- stage ----------

def run(cfg, con, force: bool = False):
    p = cfg.paths
    s = splits.load(cfg)
    coh = cohort_mod.load(cfg)
    con.register("cohort_df", coh[["customer_key"]])
    con.execute("CREATE OR REPLACE TEMP TABLE cohort_keys AS SELECT * FROM cohort_df")
    log = DataLog(p.reports)
    budgets = cfg["compression"]["history_budgets"]
    for cut in ("dev", "final"):
        C, (t0, t1) = s[cut]["cutoff"], s[cut]["target"]
        outs = [p.processed / f"profiles_{cut}_E{E}.parquet" for E in budgets] + \
               [p.processed / f"halves_{cut}.parquet", p.interim / f"targets_{cut}.parquet"]
        if all(o.exists() for o in outs) and not force:
            print(f"build[{cut}]: outputs exist, skipping (use --force)")
            continue
        units_path = p.interim / f"units_{cut}.parquet"
        n_rows = db.scalar(con, f"SELECT count(*) FROM {db.rows_before(C)}")
        n_groups = units.write_units(con, cfg, C, units_path)
        log.append(f"build:units_{cut}", note=f"{n_rows:,} rows before {C} -> {n_groups:,} unit groups")
        if cut == "dev":
            vocab = references.build_vocab(con, cfg, units_path)
            write_json(p.processed / "vocabularies.json", vocab)
            write_json(p.reports / "vocabularies.json", vocab)
        else:
            vocab = read_json(p.processed / "vocabularies.json")
        refs = references.build(con, cfg, C, s["data_start"], units_path, p.refs(cut), vocab)
        n_t = units.write_targets(con, cfg, C, t0, t1, "cohort_keys", p.interim / f"targets_{cut}.parquet")
        log.append(f"build:targets_{cut}", note=f"{n_t:,} target unit groups in [{t0}, {t1})")
        keyed = keyed_units(units_path, "cohort_keys")
        full = None
        for E in budgets:
            df = attach_cohort(build_profiles(con, cfg, refs, budget_sql(cfg, keyed, E, C), C, s["data_start"]), coh, con)
            df.to_parquet(p.processed / f"profiles_{cut}_E{E}.parquet", index=False)
            log.append(f"build:profiles_{cut}_E{E}", len(coh), len(df),
                       {"no units before cutoff": len(coh) - len(df)})
            if E == "all":
                full = df
        halves, n_elig = build_halves(con, cfg, refs, units_path, "cohort_keys", C, s["data_start"], full)
        halves.to_parquet(p.processed / f"halves_{cut}.parquet", index=False)
        n_kept = halves["customer_key"].nunique()
        log.append(f"build:halves_{cut}", len(coh), n_kept,
                   {"units_used < min_units": len(coh) - n_elig, "a half with < 3 units": n_elig - n_kept})
        print(f"build[{cut}]: {n_groups:,} unit groups, {len(full):,} profiles, {n_kept:,} halves")


def evidence_values(col: pd.Series) -> list:
    """Comparable evidence values (parquet returns lists as arrays and dates as timestamps)."""
    def norm(x):
        if isinstance(x, (list, tuple, np.ndarray)):
            return tuple(str(v) for v in x)
        if hasattr(x, "isoformat"):
            return pd.Timestamp(x).date().isoformat()
        return x.item() if hasattr(x, "item") else x
    return [norm(x) for x in col]


def leakage_check(cfg, con, n: int = 2000):
    """12.2: rebuild dev references + features from a view physically limited to t_dat < C_dev."""
    p = cfg.paths
    s = splits.load(cfg)
    C = s["dev"]["cutoff"]
    coh = cohort_mod.load(cfg).sort_values("showcase_hash").head(n)
    con.register("leak_df", coh[["customer_key"]])
    con.execute("CREATE OR REPLACE TEMP TABLE leak_keys AS SELECT * FROM leak_df")
    src = db.create_filtered_source(con, "_leak_src", C)
    upath = p.tmp / "leak_units_dev.parquet"
    units.write_units(con, cfg, C, upath, src=src)
    vocab = references.build_vocab(con, cfg, upath)
    main_vocab = read_json(p.processed / "vocabularies.json")
    refs = references.build(con, cfg, C, s["data_start"], upath, p.tmp / "leak_refs_dev", vocab, src=src)
    got = build_profiles(con, cfg, refs, keyed_units(upath, "leak_keys"), C, s["data_start"])
    main = pd.read_parquet(p.processed / "profiles_dev_Eall.parquet")
    main = main[main["customer_key"].isin(coh["customer_key"])].sort_values("customer_key").reset_index(drop=True)
    got = got.sort_values("customer_key").reset_index(drop=True)
    fo = feature_order(main_vocab)
    same_keys = got["customer_key"].tolist() == main["customer_key"].tolist()
    feat_ok = same_keys and np.allclose(got[fo].to_numpy(), main[fo].to_numpy(), atol=1e-9)
    ev_cols = [c for c in EVIDENCE if c != "color_coverage"]
    ev_ok = same_keys and all(evidence_values(got[c]) == evidence_values(main[c]) for c in ev_cols) \
        and np.allclose(got["color_coverage"], main["color_coverage"], atol=1e-9)
    res = {"cutoff": C, "customers": len(coh), "vocabulary_identical": vocab == main_vocab,
           "features_allclose": bool(feat_ok), "evidence_identical": bool(ev_ok)}
    res["passed"] = all(v for k, v in res.items() if isinstance(v, bool))
    if same_keys and not feat_ok:
        diff = np.abs(got[fo].to_numpy() - main[fo].to_numpy()).max(axis=0)
        res["max_abs_diff"] = dict(zip(fo, diff.tolist()))
    write_json(p.reports / "leakage_check.json", res)
    upath.unlink(missing_ok=True)
    DataLog(p.reports).append("leakage-check", note=f"passed={res['passed']}")
    if not res["passed"]:
        raise AssertionError(f"leakage check failed: {res}")
    print(f"leakage-check: passed ({len(coh)} customers)")
