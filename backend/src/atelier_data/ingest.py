"""8.1 ingest: raw CSVs -> data/ingested/*.parquet (shared by smoke and full runs)."""
from __future__ import annotations

from .log import DataLog

TX_CSV, ART_CSV, CUST_CSV = "transactions_train.csv", "articles.csv", "customers.csv"
ART_KEEP = ["product_code", "product_type_name", "product_group_name", "graphical_appearance_name",
            "colour_group_name", "perceived_colour_master_name", "index_group_name"]
FAMILIES = ["neutral", "warm", "cool", "unknown"]


def csv(path) -> str:
    return f"read_csv('{path}', header=true, all_varchar=true)"


def norm_article(col: str) -> str:
    return f"CASE WHEN trim({col}) = '' THEN NULL ELSE lpad(trim({col}), 10, '0') END"


def color_map_values(colors: dict) -> str:
    rows = [f"('{name.strip().lower()}', '{fam}')" for fam in FAMILIES for name in colors.get(fam, [])]
    return "(VALUES " + ", ".join(rows) + ") AS cm(name_lc, family)"


def run(cfg, con, force: bool = False):
    p = cfg.paths
    out = {n: p.ingested / f"{n}.parquet" for n in
           ("customer_index", "articles", "transactions", "customers", "customers_audit")}
    if all(f.exists() for f in out.values()) and not force:
        print("ingest: outputs exist, skipping (use --force)")
        return
    p.ingested.mkdir(parents=True, exist_ok=True)
    log = DataLog(p.reports)
    raw = {n: p.raw / n for n in (TX_CSV, ART_CSV, CUST_CSV)}
    for f in raw.values():
        if not f.exists():
            raise FileNotFoundError(f"{f} missing; run `python -m atelier_data download` or place the CSVs in {p.raw}")

    # Typed staging copy of transactions: one CSV parse, everything else reads this.
    stage = p.tmp / "tx_stage.parquet"
    con.execute(f"""
        COPY (SELECT try_strptime(trim(t_dat), '%Y-%m-%d')::DATE AS t_dat,
                     nullif(trim(customer_id), '') AS customer_id,
                     {norm_article('article_id')} AS article_id,
                     CAST(price AS DOUBLE) AS price,
                     CAST(sales_channel_id AS INTEGER) AS channel
              FROM {csv(raw[TX_CSV])})
        TO '{stage}' (FORMAT parquet)""")

    # customer_index (private): union of distinct ids in customers and transactions.
    con.execute(f"""
        COPY (SELECT (row_number() OVER (ORDER BY customer_id) - 1)::INTEGER AS customer_key, customer_id
              FROM (SELECT customer_id FROM read_parquet('{stage}') WHERE customer_id IS NOT NULL
                    UNION SELECT nullif(trim(customer_id), '') FROM {csv(raw[CUST_CSV])}
                          WHERE nullif(trim(customer_id), '') IS NOT NULL))
        TO '{out['customer_index']}' (FORMAT parquet)""")

    # articles with integer codes (keeps unit-scale tables string-free).
    depts = cfg["features"]["departments"]
    dept_case = " ".join(f"WHEN lower(index_group_name) = '{d.lower()}' THEN {i}" for i, d in enumerate(depts))
    fam_case = " ".join(f"WHEN '{f}' THEN {i}" for i, f in enumerate(FAMILIES))
    trims = ", ".join(f"nullif(trim({c}), '') AS {c}" for c in ART_KEEP)
    n_art_raw = con.execute(f"SELECT count(*) FROM {csv(raw[ART_CSV])}").fetchone()[0]
    con.execute(f"""
        COPY (
          WITH a AS (SELECT {norm_article('article_id')} AS article_id, {trims} FROM {csv(raw[ART_CSV])}),
          c AS (SELECT a.*, coalesce(cm.family, 'unknown') AS color_family
                FROM a LEFT JOIN {color_map_values(cfg.colors)}
                  ON cm.name_lc = lower(a.perceived_colour_master_name))
          SELECT (row_number() OVER (ORDER BY article_id) - 1)::INTEGER AS article_key,
                 article_id, {", ".join(ART_KEEP)}, color_family,
                 color_family <> 'unknown' AS color_known,
                 coalesce(lower(graphical_appearance_name) = 'solid', false) AS is_solid,
                 CASE WHEN product_group_name IS NULL THEN NULL
                      ELSE (dense_rank() OVER (ORDER BY product_group_name) - 1) END::SMALLINT AS group_code,
                 (CASE {dept_case} ELSE NULL END)::TINYINT AS dept_code,
                 (CASE color_family {fam_case} END)::TINYINT AS fam_code,
                 CASE WHEN color_family = 'unknown' THEN NULL
                      ELSE (dense_rank() OVER (ORDER BY CASE WHEN color_family <> 'unknown'
                            THEN perceived_colour_master_name END) - 1) END::SMALLINT AS master_code,
                 (dense_rank() OVER (ORDER BY product_code) - 1)::INTEGER AS product_code_key,
                 (dense_rank() OVER (ORDER BY product_type_name) - 1)::SMALLINT AS product_type_key
          FROM c ORDER BY article_id)
        TO '{out['articles']}' (FORMAT parquet)""")
    n_art = con.execute(f"SELECT count(*) FROM read_parquet('{out['articles']}')").fetchone()[0]
    dup_art = n_art_raw - con.execute(
        f"SELECT count(DISTINCT article_id) FROM read_parquet('{out['articles']}')").fetchone()[0]
    if dup_art:
        raise ValueError(f"articles.csv has {dup_art} duplicate article_id values")
    log.append("ingest:articles", n_art_raw, n_art, {})

    # transactions: drop null keys, drop unknown articles, map to integer keys.
    cnt = con.execute(f"""
        SELECT count(*),
               count(*) FILTER (WHERE t_dat IS NULL OR customer_id IS NULL OR article_id IS NULL),
               count(*) FILTER (WHERE t_dat IS NOT NULL AND customer_id IS NOT NULL AND article_id IS NOT NULL
                                AND article_id NOT IN (SELECT article_id FROM read_parquet('{out['articles']}')))
        FROM read_parquet('{stage}')""").fetchone()
    con.execute(f"""
        COPY (SELECT s.t_dat, ci.customer_key, a.article_key, s.price, s.channel::TINYINT AS channel
              FROM read_parquet('{stage}') s
              JOIN read_parquet('{out['customer_index']}') ci USING (customer_id)
              JOIN read_parquet('{out['articles']}') a USING (article_id)
              WHERE s.t_dat IS NOT NULL
              ORDER BY s.t_dat, ci.customer_key, a.article_key, channel, s.price)
        TO '{out['transactions']}' (FORMAT parquet, COMPRESSION zstd)""")
    n_tx = con.execute(f"SELECT count(*) FROM read_parquet('{out['transactions']}')").fetchone()[0]
    log.append("ingest:transactions", cnt[0], n_tx,
               {"null t_dat/customer_id/article_id": cnt[1], "article_id missing from articles": cnt[2]})

    # customers + private audit file.
    n_cust_raw = con.execute(f"SELECT count(*) FROM {csv(raw[CUST_CSV])}").fetchone()[0]
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE cust AS
        SELECT ci.customer_key, lower(trim(c.fashion_news_frequency)) AS fnf,
               TRY_CAST(c.age AS DOUBLE) AS age, nullif(trim(c.postal_code), '') AS postal_code
        FROM {csv(raw[CUST_CSV])} c JOIN read_parquet('{out['customer_index']}') ci
          ON ci.customer_id = nullif(trim(c.customer_id), '')""")
    n_cust = con.execute("SELECT count(*) FROM cust").fetchone()[0]
    n_dup = n_cust - con.execute("SELECT count(DISTINCT customer_key) FROM cust").fetchone()[0]
    if n_dup:
        raise ValueError(f"customers.csv has {n_dup} duplicate customer_id rows")
    con.execute(f"""
        COPY (SELECT customer_key,
                     CASE WHEN fnf IN ('regularly', 'monthly') THEN 'subscribed'
                          WHEN fnf = 'none' THEN 'not_subscribed' ELSE 'unknown' END AS newsletter
              FROM cust ORDER BY customer_key) TO '{out['customers']}' (FORMAT parquet)""")
    con.execute(f"COPY (SELECT customer_key, age, postal_code FROM cust ORDER BY customer_key) "
                f"TO '{out['customers_audit']}' (FORMAT parquet)")
    log.append("ingest:customers", n_cust_raw, n_cust, {"null customer_id": n_cust_raw - n_cust})
    stage.unlink()
    print(f"ingest: {n_tx:,} transactions, {n_art:,} articles, {n_cust:,} customers")
