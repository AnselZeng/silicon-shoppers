"""Synthetic store shoppers, for testing the pipeline before real visitors arrive.

    python -m server simulate --users 20      # inserts their events into EVENTS (user ids start with "sim-")
    python -m server simulate --clear         # removes every sim- row again

Each simulated shopper follows a simple persona (what they look at, what they add to the bag, how they sort and
filter), so the refresh job's output can be checked by eye: the deal hunter should get price sorting and sale
first, the menswear shopper should land on Menswear, and so on. Simulated rows are clearly marked and are
never mixed into training.
"""
from __future__ import annotations

import datetime as dt
import random
import uuid

import pandas as pd

PERSONAS = {
    "deal_hunter": {"dept": "women", "cats": None, "colors": None, "sale": True, "sort": "price_asc", "filter": ("sale", "true")},
    "menswear_minimal": {"dept": "men", "cats": ["jackets", "coats", "knitwear", "shirts"], "colors": ["black", "grey", "navy"],
                         "sale": None, "sort": "newest", "filter": ("color", "black")},
    "dress_lover": {"dept": "women", "cats": ["dresses", "skirts"], "colors": ["black", "burgundy"], "sale": None,
                    "sort": None, "filter": ("category", "dresses")},
    "new_arrivals": {"dept": "women", "cats": None, "colors": None, "sale": False, "new": True, "sort": "newest",
                     "filter": None},
    "shoe_and_bag": {"dept": None, "cats": ["shoes", "bags"], "colors": ["brown", "camel", "black"], "sale": None,
                     "sort": None, "filter": ("category", "shoes")},
}


def _pick(cat: pd.DataFrame, p: dict, rng: random.Random) -> pd.Series:
    c = cat
    if p.get("dept"):
        c = c[c["department"] == p["dept"]]
    if p.get("cats"):
        c = c[c["category"].isin(p["cats"])]
    if p.get("sale") is True:
        c = c[c["sale_price"].notna()]
    if p.get("new"):
        c = c[c["is_new"]]
    if p.get("colors"):
        cc = c[c["colors"].apply(lambda cs: any(x in p["colors"] for x in cs))]
        c = cc if len(cc) else c
    c = c if len(c) else cat
    return c.iloc[rng.randrange(len(c))]


def shopper_events(cat: pd.DataFrame, persona: str, user: str, start: dt.datetime, rng: random.Random,
                   visits: int = 1) -> list[dict]:
    p = PERSONAS[persona]
    rows, t = [], start
    for v in range(visits):
        sess = f"{user}-v{v}"

        def add(type_, product=None, color=None, **props):
            nonlocal t
            t += dt.timedelta(seconds=rng.randint(4, 40))
            rows.append({"event_id": uuid.uuid4().hex, "user_id": user, "session_id": sess, "type": type_, "ts": t,
                         "route": f"/store/product/{product}" if product else "/store", "product_id": product,
                         "color": color,
                         "properties": ({"productId": product, **({"color": color} if color else {}), **props}
                                        if product else props)})
        add("page_view", path="/store")
        if p.get("sort") and rng.random() < 0.9:
            add("sort_changed", value=p["sort"])
        if p.get("filter") and rng.random() < 0.8:
            add("filter_applied", type=p["filter"][0], value=p["filter"][1])
        for _ in range(rng.randint(6, 14)):
            pr = _pick(cat, p, rng)
            add("product_viewed", pr["product_id"], price=float(pr["sale_price"] if pr["sale_price"] == pr["sale_price"] else pr["price"]))
            if rng.random() < 0.3:
                col = next((c for c in pr["colors"] if p.get("colors") and c in p["colors"]), pr["colors"][0])
                add("add_to_bag", pr["product_id"], color=col, size="M")
        t += dt.timedelta(hours=rng.randint(5, 30))
    return rows


def run(db, n_users: int = 20, seed: int = 7, visits_max: int = 3):
    from .refresh import load_catalog
    from . import bundle
    rng = random.Random(seed)
    cat = load_catalog(db, bundle.load())
    now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    rows = []
    names = list(PERSONAS)
    for i in range(n_users):
        persona = names[i % len(names)]
        start = now - dt.timedelta(days=rng.randint(0, 3), hours=rng.randint(0, 20))
        rows += shopper_events(cat, persona, f"sim-{persona}-{i:03d}", start, rng, visits=rng.randint(1, visits_max))
    ev = pd.DataFrame(rows)
    ev["ts"] = ev["ts"].clip(upper=now)
    ev["inserted_at"] = now
    ev = ev[["event_id", "user_id", "session_id", "type", "ts", "route", "product_id", "color", "properties", "inserted_at"]]
    db.insert("EVENTS", ev, variant=("properties",))
    print(f"simulate: {len(ev)} events for {n_users} shoppers ({', '.join(names)})")
    return ev


def clear(db):
    for t in ("EVENTS", "USER_LAYOUTS", "USER_LAYOUTS_HISTORY"):
        db.execute(f"DELETE FROM {t} WHERE USER_ID LIKE 'sim-%'")
    print("simulate: removed all sim- shoppers")
