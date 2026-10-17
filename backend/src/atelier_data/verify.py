"""8.2 verify: pre-flight checks -> reports/preflight.json + config_generated/source_assertions.yaml."""
from __future__ import annotations

import yaml

from . import db, exposure
from .config import append_preflight, merge_json
from .ingest import ART_CSV, CUST_CSV, TX_CSV, csv
from .log import DataLog

TX_COLS = {"t_dat", "customer_id", "article_id", "price", "sales_channel_id"}
CUST_COLS = {"customer_id", "FN", "Active", "club_member_status", "fashion_news_frequency", "age", "postal_code"}
ART_REQUIRED = {"article_id", "product_code", "product_type_name", "product_group_name",
                "graphical_appearance_name", "colour_group_name", "perceived_colour_master_name",
                "index_group_name"}


class VerifyError(RuntimeError):
    pass


def channel_status(monthly: dict) -> dict:
    """monthly: {channel: {'2020-02': n, '2020-04': n}} -> store/online ids by the 2020 closure pattern."""
    ratios = {ch: (m.get("2020-04", 0) / m["2020-02"]) if m.get("2020-02") else None for ch, m in monthly.items()}
    collapsed = [ch for ch, r in ratios.items() if r is not None and r < 0.5]
    steady = [ch for ch, r in ratios.items() if r is not None and r >= 0.8]
    if len(ratios) == 2 and len(collapsed) == 1 and len(steady) == 1:
        return {"ratios": ratios, "store_channel_id": collapsed[0], "online_channel_id": steady[0],
                "channel_status": "verified_by_2020_closure_pattern"}
    return {"ratios": ratios, "store_channel_id": None, "online_channel_id": None, "channel_status": "unverified"}


def run(cfg, con, force: bool = False):
    p = cfg.paths
    out = p.reports / "preflight.json"
    if out.exists() and (p.config_generated / "source_assertions.yaml").exists() and not force:
        print("verify: outputs exist, skipping (use --force)")
        return
    log = DataLog(p.reports)
    res, hard_fail, warnings = {}, [], []

    # 1. column sets
    def cols(name):
        return {r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {csv(p.raw / name)}").fetchall()}
    tx_c, cu_c, ar_c = cols(TX_CSV), cols(CUST_CSV), cols(ART_CSV)
    col_ok = tx_c == TX_COLS and cu_c == CUST_COLS and ART_REQUIRED <= ar_c
    res["columns"] = {"ok": col_ok, "transactions": sorted(tx_c), "customers": sorted(cu_c),
                      "articles_missing": sorted(ART_REQUIRED - ar_c)}
    if not col_ok:
        hard_fail.append(f"column sets differ from Section 5: {res['columns']}")

    # 2. row counts and dates
    allr = db.rows_all()
    n_tx, dmin, dmax = con.execute(f"SELECT count(*), min(t_dat), max(t_dat) FROM {allr}").fetchone()
    res["rows"] = {"transactions": n_tx,
                   "articles": db.scalar(con, "SELECT count(*) FROM articles"),
                   "customers": db.scalar(con, "SELECT count(*) FROM customers")}
    res["dates"] = {"t_dat_min": dmin, "t_dat_max": dmax, "D_max": dmax}

    cap = cfg["units"]["multiplicity_cap"]
    con.execute(f"""CREATE OR REPLACE TEMP TABLE ug_all AS
        SELECT article_key, least(count(*), {cap}) AS q FROM {allr}
        GROUP BY customer_key, t_dat, channel, article_key""")
    con.execute("""CREATE OR REPLACE TEMP TABLE art_units AS
        SELECT article_key, sum(q) AS q FROM ug_all GROUP BY article_key""")

    # 3. departments
    depts = sorted(r[0] for r in con.execute(
        "SELECT DISTINCT index_group_name FROM articles WHERE index_group_name IS NOT NULL").fetchall())
    null_dept = db.scalar(con, "SELECT count(*) FROM articles WHERE index_group_name IS NULL")
    res["departments"] = {"found": depts, "expected": sorted(cfg["features"]["departments"]),
                          "null_department_articles": null_dept}
    if depts != sorted(cfg["features"]["departments"]):
        hard_fail.append(f"index_group_name values {depts} != features.departments")

    # 4. product groups
    res["product_groups"] = {g: int(q) for g, q in con.execute("""
        SELECT coalesce(a.product_group_name, '<null>'), sum(u.q) FROM art_units u JOIN articles a USING (article_key)
        GROUP BY 1 ORDER BY 2 DESC, 1""").fetchall()}

    # 5. colors
    mapped = {n.strip().lower(): fam for fam, names in cfg.colors.items() for n in names}
    rows = con.execute("""
        SELECT a.perceived_colour_master_name, coalesce(sum(u.q), 0) FROM articles a
        LEFT JOIN art_units u USING (article_key) GROUP BY 1 ORDER BY 1""").fetchall()
    total_q = sum(q for _, q in rows)
    unmapped = {n: int(q) for n, q in rows if n is not None and n.strip().lower() not in mapped}
    share = sum(unmapped.values()) / total_q if total_q else 0.0
    res["colors"] = {"mapping": {n: mapped.get(n.strip().lower(), "unknown") for n, _ in rows if n is not None},
                     "unmapped": sorted(unmapped), "unmapped_unit_share": share}
    if unmapped:
        warnings.append(f"unmapped colors treated as unknown: {sorted(unmapped)}")
    if share > 0.01:
        hard_fail.append(f"unmapped color unit share {share:.4f} > 1%")

    # 6. solid
    has_solid = db.scalar(con, "SELECT count(*) FROM articles WHERE lower(graphical_appearance_name) = 'solid'") > 0
    res["solid_present"] = has_solid
    if not has_solid:
        hard_fail.append("graphical_appearance_name has no 'Solid'")

    # 7. duplicates
    distinct_rows = db.scalar(con, f"SELECT count(*) FROM (SELECT DISTINCT customer_key, t_dat, channel, article_key, price FROM {allr})")
    groups_gt_cap = db.scalar(con, f"""SELECT count(*) FROM (SELECT 1 FROM {allr}
        GROUP BY customer_key, t_dat, channel, article_key HAVING count(*) > {cap})""")
    res["duplicates"] = {"exact_duplicate_rows": n_tx - distinct_rows, "groups_over_cap": groups_gt_cap}

    # 8. prices (descriptive, all-data article median)
    ratio = cfg["features"]["price_anomaly_ratio"]
    nonpos, anom = con.execute(f"""
        WITH m AS (SELECT article_key, quantile_cont(price, 0.5) AS med FROM {allr} GROUP BY article_key)
        SELECT count(*) FILTER (WHERE price IS NULL OR price <= 0),
               count(*) FILTER (WHERE price IS NULL OR price <= 0 OR price < {ratio} * m.med)
        FROM {allr} t JOIN m USING (article_key)""").fetchone()
    res["prices"] = {"nonpositive_or_null": nonpos, "anomaly_rows_all_data": anom}

    # 9. channels
    monthly = {}
    for ch, month, n in con.execute(f"""
            SELECT channel, strftime(t_dat, '%Y-%m'), count(*) FROM {allr}
            WHERE t_dat >= DATE '2019-09-01' AND t_dat < DATE '2020-10-01' GROUP BY 1, 2 ORDER BY 1, 2""").fetchall():
        monthly.setdefault(int(ch), {})[month] = n
    res["channels"] = {"monthly_rows": monthly, **channel_status(monthly)}
    if res["channels"]["channel_status"] != "verified_by_2020_closure_pattern":
        warnings.append("channel meaning unverified")

    # 10. age / postal code (aggregates only, computed inside exposure.py)
    res["customers_audit"] = exposure.source_checks(cfg, con)

    res["hard_failures"] = hard_fail
    p.reports.mkdir(parents=True, exist_ok=True)
    merge_json(out, res)
    assertions = {
        "rows": res["rows"], "t_dat_min": str(dmin), "t_dat_max": str(dmax),
        "departments": depts, "product_groups": list(res["product_groups"]),
        "color_mapping": res["colors"]["mapping"], "unmapped_colors": res["colors"]["unmapped"],
        "unmapped_unit_share": round(share, 6), "solid_present": has_solid,
        "store_channel_id": res["channels"]["store_channel_id"],
        "online_channel_id": res["channels"]["online_channel_id"],
        "channel_status": res["channels"]["channel_status"],
    }
    p.config_generated.mkdir(parents=True, exist_ok=True)
    (p.config_generated / "source_assertions.yaml").write_text(yaml.safe_dump(assertions, sort_keys=False))
    log.append("verify", note=f"{len(hard_fail)} hard failures", warnings=warnings + hard_fail)
    if hard_fail:
        raise VerifyError("Hard pre-flight checks failed:\n  - " + "\n  - ".join(hard_fail))
    print(f"verify: ok ({n_tx:,} rows, {dmin}..{dmax}, channel {res['channels']['channel_status']})")
