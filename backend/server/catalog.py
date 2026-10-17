"""The demo store's catalog and its translation into H&M terms.

The H&M model only knows H&M product groups, departments and colors. Every demo product is mapped once:
    category   -> H&M product group (the adapter's HM_TO_APP_CATEGORIES, reversed)
    department -> Ladieswear / Menswear
    color      -> H&M master color (black -> Black, navy -> Blue, olive -> Khaki green, burgundy -> Red,
                  cream -> White, camel -> Beige, ...)
    price      -> price percentile among demo products of the same H&M group (H&M: within group and month)
    sale       -> on markdown when the store shows a sale price (H&M infers markdowns from 30%+ price drops)
    new        -> the store's "new" flag
    popularity -> percentile of the store's popularity score

Source of truth: the CATALOG table (uploaded from the app's lib/store/catalog.ts by `python -m server catalog`).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

APP_TO_HM_CATEGORY = {
    "tshirts": "cat_garment_upper_body", "shirts": "cat_garment_upper_body", "knitwear": "cat_garment_upper_body",
    "jackets": "cat_garment_upper_body", "coats": "cat_garment_upper_body",
    "jeans": "cat_garment_lower_body", "trousers": "cat_garment_lower_body", "skirts": "cat_garment_lower_body",
    "dresses": "cat_garment_full_body", "shoes": "cat_shoes", "bags": "cat_accessories",
}
APP_TO_HM_DEPT = {"women": "dept_ladieswear", "men": "dept_menswear"}
APP_TO_HM_COLOR = {"black": "Black", "white": "White", "beige": "Beige", "navy": "Blue", "grey": "Grey",
                   "olive": "Khaki green", "burgundy": "Red", "cream": "White", "brown": "Brown", "camel": "Beige"}
# H&M -> store (adapter.ts HM_TO_APP_COLOR): what a highlighted H&M color shows as in the store
HM_TO_APP_COLOR = {"Black": "black", "White": "white", "Beige": "beige", "Blue": "navy", "Grey": "grey",
                   "Khaki green": "olive", "Red": "burgundy", "Brown": "brown", "Mole": "brown"}

COLUMNS = ["product_id", "name", "department", "category", "collection", "price", "sale_price", "colors",
           "is_new", "popularity"]


def parse_catalog_ts(path: Path) -> pd.DataFrame:
    """Seed objects from the app's lib/store/catalog.ts (one `{ id: ..., ... }` literal per line)."""
    text = Path(path).read_text(encoding="utf-8")
    rows = []
    for m in re.finditer(r"\{\s*id:\s*\"[^\n]*?\}(?=,?\s*\n)", text):
        lit = m.group(0)
        js = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', lit)
        js = re.sub(r",\s*([}\]])", r"\1", js)
        rows.append(json.loads(js))
    if not rows:
        raise SystemExit(f"no products found in {path}")
    df = pd.DataFrame(rows)
    out = pd.DataFrame({
        "product_id": df["id"], "name": df["name"], "department": df["department"], "category": df["category"],
        "collection": df.get("collection"), "price": df["price"].astype(float),
        "sale_price": df["salePrice"].astype(float) if "salePrice" in df else np.nan,
        "colors": df["colors"].apply(lambda c: list(c) if isinstance(c, list) and c else ["black", "navy"]),
        "is_new": df["isNew"].fillna(False).astype(bool) if "isNew" in df else False,
        "popularity": df["popularity"].astype(float),
    })
    return out[COLUMNS]


def _percent_rank(v: np.ndarray) -> np.ndarray:
    """SQL percent_rank(): (rank - 1) / (n - 1), ties share the lowest rank."""
    n = len(v)
    if n <= 1:
        return np.zeros(n)
    order = np.sort(v)
    return np.searchsorted(order, v, side="left") / (n - 1)


def hm_attributes(cat: pd.DataFrame, vocab: dict, fam_of_master: list[int]) -> pd.DataFrame:
    """One row per product with the H&M attributes the feature builder needs."""
    c = cat.copy().reset_index(drop=True)
    ck, dk, mk = vocab["category_keys"], vocab["department_keys"], vocab["master_colors"]
    c["hm_category"] = c["category"].map(APP_TO_HM_CATEGORY).fillna("cat_other")
    c["cat_idx"] = c["hm_category"].map(ck.index)
    c["dept_idx"] = c["department"].map(lambda d: dk.index(APP_TO_HM_DEPT[d]) if d in APP_TO_HM_DEPT else np.nan)
    paid = c["sale_price"].where(c["sale_price"].notna(), c["price"]).to_numpy(float)
    c["paid"] = paid
    c["on_sale"] = c["sale_price"].notna() & (c["sale_price"] < c["price"])
    c["price_pct"] = np.nan
    for _, idx in c.groupby("hm_category").groups.items():
        c.loc[idx, "price_pct"] = _percent_rank(paid[np.asarray(idx)])
    c["art_pop_pct"] = _percent_rank(c["popularity"].to_numpy(float))
    c["product_code_key"] = np.arange(len(c))
    c["master_codes"] = c["colors"].apply(lambda cs: [mk.index(APP_TO_HM_COLOR[x]) if x in APP_TO_HM_COLOR else -1
                                                      for x in cs])
    c["fam_of_master"] = [fam_of_master] * len(c)
    return c


def units_from_events(ev: pd.DataFrame, attrs: pd.DataFrame, carts=("add_to_bag", "purchase", "checkout"),
                      cap: int = 3) -> pd.DataFrame:
    """Store events -> H&M-style unit rows. A unit is an add-to-bag (the demo has no checkout; an order event
    would count the same). Same (shopper, day, product, color) groups are summed and capped at 3, as in H&M."""
    cols = ["user", "t_dat", "channel", "article", "n_rows", "q", "price_pct", "cat_idx", "dept_idx", "fam",
            "master_code", "is_solid", "art_pop_pct", "md_elig", "md", "nov_elig", "nov", "product_code_key",
            "f_new", "f_sale"]
    e = ev[ev["type"].isin(carts) & ev["product_id"].notna()]
    if e.empty:
        return pd.DataFrame(columns=cols)
    a = attrs.set_index("product_id")
    e = e[e["product_id"].isin(a.index)].copy()
    if e.empty:
        return pd.DataFrame(columns=cols)
    pr = a.loc[e["product_id"]]
    # chosen color (product page sends it; quick view doesn't, so the first listed color)
    col = [c if isinstance(c, str) and c in cs else cs[0] for c, cs in zip(e["color"], pr["colors"])]
    ci = [cs.index(c) for c, cs in zip(col, pr["colors"])]
    mc = [m[i] for m, i in zip(pr["master_codes"], ci)]
    fam_map = pr["fam_of_master"].iloc[0]
    g = pd.DataFrame({
        "user": e["user_id"].to_numpy(), "t_dat": pd.to_datetime(e["ts"]).dt.date.to_numpy(), "channel": 2,
        "article": pr["product_code_key"].to_numpy() * 16 + np.array(ci), "product_code_key": pr["product_code_key"].to_numpy(),
        "master_code": mc, "price_pct": pr["price_pct"].to_numpy(float), "cat_idx": pr["cat_idx"].to_numpy(int),
        "dept_idx": pr["dept_idx"].to_numpy(float), "art_pop_pct": pr["art_pop_pct"].to_numpy(float),
        "on_sale": pr["on_sale"].to_numpy(bool), "is_new": pr["is_new"].to_numpy(bool),
    })
    keys = ["user", "t_dat", "channel", "article"]
    u = (g.groupby(keys, as_index=False)
          .agg(n_rows=("price_pct", "size"), product_code_key=("product_code_key", "first"),
               master_code=("master_code", "first"), price_pct=("price_pct", "first"), cat_idx=("cat_idx", "first"),
               dept_idx=("dept_idx", "first"), art_pop_pct=("art_pop_pct", "first"), on_sale=("on_sale", "first"),
               is_new=("is_new", "first")))
    u["q"] = np.minimum(u["n_rows"], cap)
    u["fam"] = [fam_map[m] if m >= 0 else 3 for m in u["master_code"]]
    u["master_code"] = u["master_code"].where(u["master_code"] >= 0, np.nan)
    u["is_solid"] = True              # the demo catalog is single-color plain garments
    u["md_elig"] = True
    u["md"] = u["on_sale"]
    u["nov_elig"] = True
    u["nov"] = u["is_new"]
    u["f_new"] = u["is_new"]
    u["f_sale"] = u["on_sale"]
    return u[cols]
