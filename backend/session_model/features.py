"""Live-session features, computed from the events a visitor has produced so far.

THIS FUNCTION IS MIRRORED LINE BY LINE IN web/sessionStyle.js (sessionFeatures). Change both together;
`node session_model/web/check.mjs` fails if they disagree.

An event is (ts seconds, aid item id, type 0 = click, 1 = add to cart, 2 = order). Events are sorted by
(ts, type, aid), the order atelier_data.fusion uses.
"""
from __future__ import annotations

import math

from .config import VISIT_GAP_S

FEATURES = [
    "n_events", "n_clicks", "n_carts", "n_orders", "n_visits", "events_per_visit",
    "distinct_items", "distinct_per_click", "explore_per_visit", "revisit_share", "repeat_share",
    "pace_median_log", "pace_mean_log", "span_log", "last_gap_log",
    "cart_rate", "decide_median_log", "cart_after_research", "cart_to_order_now",
]


def _median(xs):
    s = sorted(xs)
    n = len(s)
    if n == 0:
        return math.nan
    m = n // 2
    return s[m] if n % 2 else (s[m - 1] + s[m]) / 2.0


def _ratio(a, b):
    return a / b if b > 0 else math.nan


def session_features(events) -> list[float]:
    """events: iterable of (ts, aid, type). Returns floats in FEATURES order (NaN where undefined)."""
    ev = sorted(events, key=lambda e: (e[0], e[2], e[1]))
    n = len(ev)
    if n == 0:
        return [math.nan] * len(FEATURES)
    n_clicks = n_carts = n_orders = 0
    visit = 0
    gaps = []                      # gaps between consecutive events inside a visit (seconds, > 0)
    clicked_per_visit = {}         # visit -> set of clicked items
    click_count = {}               # aid -> clicks so far
    first_click = {}               # aid -> (ts, visit) of first click
    first_cart = {}                # aid -> (ts, visit) of first cart
    carted, ordered = set(), set()
    revisits = repeats = 0
    prev_ts, prev_aid = None, None
    for ts, aid, typ in ev:
        if prev_ts is not None:
            dt = ts - prev_ts
            if dt > VISIT_GAP_S:
                visit += 1
            elif dt > 0:
                gaps.append(dt)
        if typ == 0:
            n_clicks += 1
            seen = click_count.get(aid, 0)
            if seen > 0 and prev_aid != aid:
                revisits += 1          # came back to an item clicked before (not a double click)
            if prev_aid == aid:
                repeats += 1
            click_count[aid] = seen + 1
            clicked_per_visit.setdefault(visit, set()).add(aid)
            if aid not in first_click:
                first_click[aid] = (ts, visit)
        elif typ == 1:
            n_carts += 1
            carted.add(aid)
            if aid not in first_cart:
                first_cart[aid] = (ts, visit)
        else:
            n_orders += 1
            ordered.add(aid)
        prev_ts, prev_aid = ts, aid
    n_visits = visit + 1
    distinct_items = len({e[1] for e in ev})
    decide = [first_cart[a][0] - first_click[a][0] for a in first_cart
              if a in first_click and first_click[a][0] <= first_cart[a][0]]
    researched = [a for a in first_cart if a in first_click and first_click[a][1] < first_cart[a][1]]
    explore = [len(s) for s in clicked_per_visit.values()]
    return [
        float(n), float(n_clicks), float(n_carts), float(n_orders), float(n_visits), n / n_visits,
        float(distinct_items), _ratio(len(click_count), n_clicks),
        (sum(explore) / len(explore)) if explore else math.nan,
        _ratio(revisits, n_clicks), _ratio(repeats, n_clicks),
        math.log1p(_median(gaps)) if gaps else math.nan,
        (sum(math.log1p(g) for g in gaps) / len(gaps)) if gaps else math.nan,
        math.log1p(ev[-1][0] - ev[0][0]),
        math.log1p(max(ev[-1][0] - ev[-2][0], 0)) if n > 1 else math.nan,
        _ratio(len(carted & set(click_count)), len(click_count)),
        math.log1p(_median(decide)) if decide else math.nan,
        _ratio(len(researched), len(carted)),
        _ratio(len(carted & ordered), len(carted)),
    ]
