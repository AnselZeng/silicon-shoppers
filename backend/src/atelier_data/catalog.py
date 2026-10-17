"""8.14 catalog: demo articles from in-assortment articles at the final cutoff."""
from __future__ import annotations

import pandas as pd

from .cohort import largest_remainder

GARMENTS = [  # lowercase substring of product_type_name -> garment, first match wins
    (("dress",), "dress"), (("skirt",), "skirt"), (("trousers", "jeans", "leggings", "shorts"), "trousers"),
    (("blazer", "jacket"), "jacket"), (("coat",), "coat"), (("sweater", "cardigan", "hoodie"), "knit"),
    (("t-shirt", "vest top", "top"), "tshirt"), (("shirt", "blouse"), "shirt"),
    (("sneakers", "shoes", "boots", "sandals", "heels", "flat", "pumps"), "shoes"), (("bag",), "bag"),
]
GROUP_FALLBACK = {"underwear": "underwear", "nightwear": "underwear", "swimwear": "swimwear", "accessories": "accessory"}


def garment(product_type: str | None, product_group: str | None) -> str:
    t = (product_type or "").lower()
    for subs, g in GARMENTS:
        if any(s in t for s in subs):
            return g
    return GROUP_FALLBACK.get((product_group or "").strip().lower(), "other")


def allocate(cells: pd.DataFrame, n: int) -> dict:
    """cells: cell, size (deduped articles), weight (recent_units). Min 2 per cell with size >= 2, rest by
    largest remainder on weight, capped by size."""
    base = {c: (2 if s >= 2 else 0) for c, s in zip(cells["cell"], cells["size"])}
    if sum(base.values()) > n:
        raise ValueError(f"{sum(base.values())} minimum slots exceed n_articles={n}")
    caps = {c: s - base[c] for c, s in zip(cells["cell"], cells["size"])}
    extra = largest_remainder(n - sum(base.values()), dict(zip(cells["cell"], cells["weight"])), caps=caps)
    alloc = {c: base[c] + extra[c] for c in base}
    if sum(alloc.values()) != n:  # weights or caps ran out (e.g. zero recent_units cells)
        left = largest_remainder(n - sum(alloc.values()), {c: 1 for c in base}, caps={c: caps[c] - extra[c] for c in base})
        alloc = {c: alloc[c] + left[c] for c in base}
    if sum(alloc.values()) != n:
        raise ValueError(f"only {sum(alloc.values())} catalog articles available, need {n}")
    return alloc


def build(con, cfg, cutoff, refs_dir, vocab: dict) -> list[dict]:
    f = cfg["features"]
    m = f["anchor_min_rows"]
    df = con.execute(f"""
        WITH ia AS (SELECT r.*, a.* EXCLUDE (article_key) FROM read_parquet('{refs_dir}/article_ref.parquet') r
                    JOIN articles a USING (article_key) WHERE r.in_assortment)
        SELECT article_key, product_code_key, dept_code, group_code, product_type_name, product_group_name,
               colour_group_name, perceived_colour_master_name, color_family, is_solid, recent_units, first_seen,
               percent_rank() OVER (PARTITION BY product_type_key ORDER BY last_price) AS price_pct,
               percent_rank() OVER (ORDER BY recent_units) AS popularity_pct,
               coalesce(pooled_n >= {m} AND last_price <= {f['markdown_ratio']} * pooled_anchor, false) AS markdown,
               first_seen >= DATE '{cutoff}' - INTERVAL {f['novelty_days']} DAY AS is_new,
               date_diff('day', first_seen, DATE '{cutoff}') AS first_seen_days_ago
        FROM ia""").df()
    df = df[df["dept_code"].notna()].copy()
    cat_of = {g: i for i, g in enumerate(vocab["category_group_codes"])}
    ncat = len(vocab["category_keys"])
    df["cat_idx"] = [cat_of.get(g, ncat - 1) if pd.notna(g) else ncat - 1 for g in df["group_code"]]
    df["dept_idx"] = df["dept_code"].astype(int)
    df["cell"] = list(zip(df["dept_idx"], df["cat_idx"]))
    weight = df.groupby("cell")["recent_units"].sum()
    dedup = (df.sort_values(["recent_units", "article_key"], ascending=[False, True], kind="stable")
             .drop_duplicates(["cell", "product_code_key"]))
    cells = (dedup.groupby("cell").size().rename("size").to_frame().join(weight.rename("weight"))
             .reset_index().sort_values("cell"))
    alloc = allocate(cells, cfg["catalog"]["n_articles"])
    rows = []
    for cell in sorted(alloc):
        rows.append(dedup[dedup["cell"] == cell].head(alloc[cell]))
    out = pd.concat(rows)
    arts = []
    for i, r in enumerate(out.itertuples(index=False)):
        arts.append({
            "id": f"item_{i + 1:04d}",
            "name": f"{r.colour_group_name} {r.product_type_name}".title(),
            "department": vocab["department_keys"][r.dept_idx],
            "group": vocab["category_keys"][r.cat_idx],
            "product_type": r.product_type_name,
            "garment": garment(r.product_type_name, r.product_group_name),
            "color": r.perceived_colour_master_name,
            "color_family": r.color_family,
            "solid": bool(r.is_solid),
            "price_pct": round(float(r.price_pct), 2),
            "markdown": bool(r.markdown),
            "is_new": bool(r.is_new),
            "popularity_pct": round(float(r.popularity_pct), 2),
            "first_seen_days_ago": int(r.first_seen_days_ago),
        })
    return arts
