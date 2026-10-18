"""Tiny synthetic H&M-shaped dataset with hand-checkable scenarios.

Dates span 2018-09-20..2020-09-22, so C_dev = 2020-07-29 and C_final = 2020-08-26.
Strata at C_dev with per_stratum = 2:
  light      c01(1) c02(2) c03(1) c04(2)     4 eligible
  lower_mid  c05(3) c06(4) c07(5)            3 eligible
  upper_mid  c08(7)                          1 eligible  <- short: deficit 1 goes to light (largest remainder)
  heavy      c09 c10 c11(11)                 3 eligible
  c12 buys only after C_dev (not eligible); c13 has no transactions.
"""
from __future__ import annotations

import csv
import datetime as dt
import random
from pathlib import Path

from atelier_data import config

C_DEV = dt.date(2020, 7, 29)
C_FINAL = dt.date(2020, 8, 26)
D = dt.date.fromisoformat

DEPTS = ["Ladieswear", "Menswear"]
OVERRIDES = {
    "features.top_product_groups": 2,
    "features.departments": DEPTS,
    "cohort.per_stratum": 2,
    "duckdb.memory_limit": "1GB",
    "duckdb.threads": 2,
}

ART_HEADER = ["article_id", "product_code", "prod_name", "product_type_no", "product_type_name",
              "product_group_name", "graphical_appearance_no", "graphical_appearance_name", "colour_group_code",
              "colour_group_name", "perceived_colour_value_id", "perceived_colour_value_name",
              "perceived_colour_master_id", "perceived_colour_master_name", "department_no", "department_name",
              "index_code", "index_name", "index_group_no", "index_group_name", "section_no", "section_name",
              "garment_group_no", "garment_group_name", "detail_desc"]

# name -> (article_id, product_code, type, group, appearance, colour, master, index_group)
ARTICLES = {
    "A01":    ("0108775015", "0108775", "Vest top", "Garment Upper body", "Solid", "Black", "Black", "Ladieswear"),
    "MD":     ("0200000001", "0200000", "T-shirt", "Garment Upper body", "Solid", "White", "White", "Ladieswear"),
    "A19":    ("0200001001", "0200001", "T-shirt", "Garment Upper body", "Stripe", "Red", "Red", "Ladieswear"),
    "OLD":    ("0200002001", "0200002", "Sweater", "Garment Upper body", "Solid", "Blue", "Blue", "Menswear"),
    "NEW":    ("0200003001", "0200003", "Sweater", "Garment Upper body", "Solid", "Black", "Black", "Menswear"),
    "NEW2":   ("0200004001", "0200004", "Sneakers", "Shoes", "Solid", "Black", "Black", "Menswear"),
    "R1":     ("0200005001", "0200005", "Boots", "Shoes", "Solid", "Black", "Black", "Ladieswear"),
    "R2":     ("0200005002", "0200005", "Boots", "Shoes", "Solid", "Red", "Red", "Ladieswear"),
    "CAP":    ("0200006001", "0200006", "Sandals", "Shoes", "Stripe", "Blue", "Blue", "Ladieswear"),
    "Y":      ("0200007001", "0200007", "Trousers", "Garment Lower body", "Solid", "Grey", "Grey", "Menswear"),
    "Z":      ("0200008001", "0200008", "Bag", "Accessories", "Solid", "Undefined", "undefined", "Ladieswear"),
    "NODEPT": ("0200009001", "0200009", "Bag", "Accessories", "Solid", "Black", "Black", ""),
}
for i in range(13):  # filler articles to reach 25
    g = ["Shoes", "Garment Upper body", "Accessories", "Garment Lower body"][i % 4]
    t = {"Shoes": "Sneakers", "Garment Upper body": "Blouse", "Accessories": "Bag", "Garment Lower body": "Skirt"}[g]
    col = ["Black", "Red", "Blue", "White"][i % 4]
    ARTICLES[f"F{i:02d}"] = (f"03000{i:02d}001", f"03000{i:02d}", t, g, ["Solid", "Stripe"][i % 2], col, col,
                             DEPTS[i % 2])


def _tx(rows, day, cust, art, price=0.05, ch=2, n=1, raw_id=None):
    for _ in range(n):
        rows.append([day.isoformat(), cust, raw_id or ARTICLES[art][0], f"{price}", str(ch)])


def transactions(extra_future: int = 0, seed: int = 1) -> list[list[str]]:
    r = []
    _tx(r, D("2018-09-20"), "c10", "OLD")                      # data_start; OLD is left-censored
    _tx(r, D("2019-06-01"), "c01", "A01", raw_id="108775015")  # leading zero missing
    # light
    _tx(r, D("2019-03-01"), "c02", "F00"); _tx(r, D("2020-02-01"), "c02", "F01")
    _tx(r, D("2020-05-05"), "c03", "F02")
    _tx(r, D("2019-11-11"), "c04", "F03"); _tx(r, D("2019-12-12"), "c04", "F04")
    # lower_mid
    for i, d in enumerate(["2019-01-05", "2019-08-05", "2020-04-05"]):
        _tx(r, D(d), "c05", f"F0{5 + i}")
    _tx(r, D("2020-03-01"), "c06", "Y", n=2)                   # E budget: q=2 then q=2 (newer)
    _tx(r, D("2020-06-01"), "c06", "Z", n=2)
    _tx(r, D("2020-07-01"), "c07", "CAP", price=0.04, n=5)    # cap: 5 identical rows -> q=3
    _tx(r, D("2019-10-01"), "c07", "F08"); _tx(r, D("2019-10-02"), "c07", "F09")
    # upper_mid: rebuy scenario
    _tx(r, D("2020-01-10"), "c08", "R1"); _tx(r, D("2020-01-10"), "c08", "R2")
    _tx(r, D("2020-03-10"), "c08", "R1")
    for i, d in enumerate(["2019-02-01", "2019-04-01", "2019-06-01", "2019-08-01"]):
        _tx(r, D(d), "c08", f"F{10 + i % 3}")
    # heavy
    for i in range(20):                                       # MD anchor: 20 rows @ 10.0
        _tx(r, D("2019-01-01") + dt.timedelta(days=7 * i), "c10", "MD", price=10.0)
    for i in range(19):                                       # 19 rows -> ineligible for markdown
        _tx(r, D("2019-01-02") + dt.timedelta(days=7 * i), "c10", "A19", price=10.0)
    _tx(r, D("2020-01-01"), "c10", "NEW"); _tx(r, D("2020-02-01"), "c10", "NEW2")
    _tx(r, D("2020-06-01"), "c09", "MD", price=6.5)           # markdown unit (6.5 <= 0.70 x 10.0)
    _tx(r, D("2020-01-29"), "c09", "NEW")                      # 28 days after first seen: novel
    _tx(r, D("2020-03-01"), "c09", "NEW2")                     # 29 days: not novel
    for i in range(9):
        _tx(r, D("2019-05-01") + dt.timedelta(days=11 * i), "c09", f"F{i % 4:02d}", ch=1)
    for i in range(6):
        _tx(r, D("2019-09-01") + dt.timedelta(days=13 * i), "c11", ["R1", "CAP", "F04"][i % 3], ch=1)
    for i in range(4):
        _tx(r, D("2020-02-01") + dt.timedelta(days=5 * i), "c11", "Z")
    _tx(r, D("2020-05-20"), "c11", "NODEPT")
    # targets (dev window [07-29, 08-26), final window [08-26, 09-23))
    for c, a, d in [("c01", "F00", "2020-08-01"), ("c05", "R1", "2020-08-03"), ("c09", "MD", "2020-08-10"),
                    ("c10", "NEW", "2020-08-20"), ("c12", "F01", "2020-08-02"),
                    ("c02", "F01", "2020-09-01"), ("c08", "R2", "2020-09-05"), ("c11", "CAP", "2020-09-10"),
                    ("c09", "NEW2", "2020-09-15"), ("c10", "F05", "2020-09-22")]:
        _tx(r, D(d), c, a)
    rng = random.Random(seed)
    custs = [f"c{i:02d}" for i in range(1, 13)]
    span = (D("2020-09-22") - C_DEV).days
    for _ in range(extra_future):
        _tx(r, C_DEV + dt.timedelta(days=rng.randint(0, span)), rng.choice(custs), rng.choice(list(ARTICLES)),
            price=round(rng.uniform(0.01, 0.2), 4), ch=rng.choice([1, 2]))
    return r


def customers() -> list[list[str]]:
    news = {"c01": "Regularly", "c02": "NONE", "c03": "", "c04": "Monthly"}
    rows = []
    for i in range(1, 14):
        c = f"c{i:02d}"
        rows.append([c, "", "", "ACTIVE", news.get(c, "NONE"), "" if c == "c03" else str(20 + 3 * i),
                     "P1" if i % 2 else f"P{i}"])
    return rows


def write_dataset(root: Path, extra_future: int = 0) -> config.Config:
    raw = root / "data" / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    with open(raw / "transactions_train.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["t_dat", "customer_id", "article_id", "price", "sales_channel_id"])
        w.writerows(transactions(extra_future))
    with open(raw / "articles.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(ART_HEADER)
        for aid, pc, typ, grp, app, col, master, idx in ARTICLES.values():
            w.writerow([aid, pc, "name", "1", typ, grp, "1", app, "1", col, "1", "Dark", "1", master,
                        "1", "dep", "A", idx, "1", idx, "1", "sec", "1", "gg", "desc"])
    with open(raw / "customers.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["customer_id", "FN", "Active", "club_member_status", "fashion_news_frequency", "age", "postal_code"])
        w.writerows(customers())
    cfg = config.load(data_root=root / "data", run_root=root / "run", overrides=OVERRIDES)
    cfg.paths.makedirs()
    return cfg


def build(root: Path, extra_future: int = 0, upto: str = "build") -> config.Config:
    """Write the fixture and run the pipeline stages through `upto`."""
    from atelier_data import cohort, db, features, ingest, splits, verify
    cfg = write_dataset(root, extra_future)
    con = db.connect(cfg)
    ingest.run(cfg, con)
    con = db.connect(cfg)
    stages = [verify.run, splits.run, cohort.run, features.run]
    names = ["verify", "splits", "cohort", "build"]
    for name, fn in zip(names, stages):
        fn(cfg, con)
        if name == upto:
            break
    return cfg
