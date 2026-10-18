"""Load and validate config, apply smoke overrides, resolve run_root paths."""
from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]

REQUIRED = ["dataset_version", "schema_version", "seed", "duckdb", "dates", "cohort", "units",
            "features", "confidence", "reliability", "rules", "evaluation", "compression",
            "exposure", "showcase", "catalog"]


@dataclass(frozen=True)
class Paths:
    data_root: Path   # holds raw/, ingested/, tmp/ (shared by all runs)
    run_root: Path    # "." for the full run, runs/smoke for smoke

    @property
    def raw(self): return self.data_root / "raw"
    @property
    def ingested(self): return self.data_root / "ingested"
    @property
    def tmp(self): return self.data_root / "tmp"
    @property
    def interim(self): return self.run_root / "data" / "interim"
    @property
    def processed(self): return self.run_root / "data" / "processed"
    @property
    def frontend(self): return self.run_root / "artifacts" / "frontend"
    @property
    def reports(self): return self.run_root / "reports"
    @property
    def figures(self): return self.reports / "figures"
    @property
    def config_generated(self): return self.run_root / "config_generated"

    def refs(self, cut: str) -> Path:
        return self.processed / f"references_{cut}"

    def makedirs(self):
        for p in (self.raw, self.ingested, self.tmp, self.interim, self.processed,
                  self.frontend, self.figures, self.config_generated):
            p.mkdir(parents=True, exist_ok=True)


class Config(dict):
    """The config.yaml dict plus `rules`, `colors`, `paths`, `smoke`."""
    rules: dict
    colors: dict
    paths: Paths
    smoke: bool


def set_dotted(d: dict, dotted: str, value):
    *head, last = dotted.split(".")
    for k in head:
        d = d[k]
    if last not in d:
        raise KeyError(f"override targets unknown key {dotted}")
    d[last] = value


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def load(smoke: bool = False, config_dir: Path | None = None, data_root: Path | None = None,
         run_root: Path | None = None, overrides: dict | None = None) -> Config:
    config_dir = config_dir or ROOT / "config"
    raw = yaml.safe_load((config_dir / "config.yaml").read_text())
    missing = [k for k in REQUIRED if k not in raw]
    if missing:
        raise ValueError(f"config.yaml missing keys: {missing}")
    smoke_over = raw.pop("smoke", {}) or {}
    cfg = Config(copy.deepcopy(raw))
    if smoke:
        for k, v in smoke_over.items():
            set_dotted(cfg, k, v)
    for k, v in (overrides or {}).items():
        set_dotted(cfg, k, v)
    cfg.rules = yaml.safe_load((config_dir / "layout_rules.yaml").read_text())
    cfg.colors = yaml.safe_load((config_dir / "color_map.yaml").read_text())
    cfg.smoke = smoke
    cfg.paths = Paths(data_root or ROOT / "data",
                      run_root or (ROOT / "runs" / "smoke" if smoke else ROOT))
    return cfg


def dept_keys(cfg) -> list[str]:
    return ["dept_" + slug(d) for d in cfg["features"]["departments"]]


def read_json(path: Path):
    return json.loads(Path(path).read_text())


def write_json(path: Path, obj):
    """Strict JSON: NaN/inf become null so frontend parsers accept the file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    clean = _finite(json.loads(json.dumps(obj, default=_json_default)))
    path.write_text(json.dumps(clean, indent=2, allow_nan=False) + "\n")


def _finite(o):
    import math
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _finite(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_finite(v) for v in o]
    return o


def merge_json(path: Path, updates: dict):
    """Read-merge-write by top-level key; never drops keys written by other stages."""
    path = Path(path)
    cur = read_json(path) if path.exists() else {}
    cur.update(updates)
    write_json(path, cur)
    return cur


def _json_default(o):
    import datetime as _dt

    import numpy as np
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, (_dt.date, _dt.datetime)):
        return o.isoformat()
    if isinstance(o, Path):
        return str(o)
    raise TypeError(f"not JSON serializable: {type(o)}")


def append_preflight(cfg, key: str, value):
    merge_json(cfg.paths.reports / "preflight.json", {key: value})
