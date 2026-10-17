"""8.3 splits: dev/final cutoffs and target windows -> reports/split_manifest.json."""
from __future__ import annotations

import datetime as dt

from . import db
from .config import read_json, write_json
from .log import DataLog

EXPECTED_DMAX = dt.date(2020, 9, 22)


def compute(data_start: dt.date, d_max: dt.date, window_days: int = 28) -> dict:
    eval_start = d_max - dt.timedelta(days=window_days - 1)
    dev_start = eval_start - dt.timedelta(days=window_days)
    return {
        "data_start": data_start.isoformat(), "D_max": d_max.isoformat(),
        "dev": {"cutoff": dev_start.isoformat(), "target": [dev_start.isoformat(), eval_start.isoformat()]},
        "final": {"cutoff": eval_start.isoformat(),
                  "target": [eval_start.isoformat(), (d_max + dt.timedelta(days=1)).isoformat()]},
    }


def run(cfg, con, force: bool = False):
    out = cfg.paths.reports / "split_manifest.json"
    if out.exists() and not force:
        print("splits: outputs exist, skipping (use --force)")
        return
    start, d_max = con.execute(f"SELECT min(t_dat), max(t_dat) FROM {db.rows_all()}").fetchone()
    s = compute(start, d_max, cfg["dates"]["target_window_days"])
    warn = [] if d_max == EXPECTED_DMAX else [f"D_max is {d_max}, expected {EXPECTED_DMAX}"]
    write_json(out, s)
    DataLog(cfg.paths.reports).append("splits", note=f"C_dev={s['dev']['cutoff']} C_final={s['final']['cutoff']}",
                                      warnings=warn)
    print(f"splits: C_dev={s['dev']['cutoff']} C_final={s['final']['cutoff']}")


def load(cfg) -> dict:
    return read_json(cfg.paths.reports / "split_manifest.json")
