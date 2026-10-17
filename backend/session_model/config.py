"""Settings shared by every stage. Override the sample size and memory with environment variables."""
from __future__ import annotations

import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = HERE / "work"                       # all outputs (gitignored)
WEB = HERE / "web"                         # browser runtime + exported model

VISIT_GAP_S = 30 * 60                      # same visit definition as atelier_data.fusion
PREFIX_LENGTHS = [3, 5, 10, 20, 40]        # how many live events the model has seen
N_MAX = 40                                 # targets are measured on events after the 40th
MIN_EVENTS = 60                            # shoppers need >= 20 later events to measure their style
SAMPLE = int(os.environ.get("SESSION_SAMPLE", 200_000))   # shoppers sampled from OTTO
SALT = "otto-session-model-v1|"
PSEUDO = 5                                 # smoothing toward the population rate, as in fusion.py

# What the model predicts: browsing style percentiles among sampled OTTO shoppers (0 = lowest, 1 = highest).
# Same definitions as atelier_data.fusion.BROWSING, measured on the shopper's later events.
# evening_share / weekend_share are left out: time of day is not a browsing style the UI should react to.
TARGETS = ["exploration", "comparison", "browsing_pace", "click_to_cart", "cart_to_order",
           "decision_speed", "multi_visit_research"]


def duckdb_mem() -> str:
    return os.environ.get("ATELIER_DUCKDB_MEM", "4GB")


def duckdb_threads() -> int:
    return int(os.environ.get("ATELIER_DUCKDB_THREADS", os.cpu_count() or 2))
