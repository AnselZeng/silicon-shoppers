"""8.16 manifest (minimal for now): freeze-point records in reports/build_manifest.json."""
from __future__ import annotations

import datetime as dt
import hashlib
import platform
import subprocess

from .config import ROOT, read_json, write_json


def sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def git_state() -> dict:
    try:
        commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        dirty = bool(subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.strip())
        return {"commit": commit, "dirty": dirty}
    except (OSError, subprocess.CalledProcessError):
        return {"commit": "nogit", "dirty": None}


def dataset_artifacts(cfg) -> list:
    """Frozen dataset files: ingested tables, splits, cohort, profiles (all cutoffs and budgets), halves,
    unit groups, held-out targets, references, vocabularies and catalog."""
    p = cfg.paths
    files = sorted(p.ingested.glob("*.parquet"))
    files += [p.reports / "split_manifest.json", p.processed / "cohort.parquet", p.processed / "vocabularies.json",
              p.frontend / "catalog.json"]
    files += sorted(p.processed.glob("profiles_*.parquet")) + sorted(p.processed.glob("halves_*.parquet"))
    files += sorted(p.interim.glob("units_*.parquet")) + sorted(p.interim.glob("targets_*.parquet"))
    files += sorted(f for d in sorted(p.processed.glob("references_*")) for f in d.iterdir())
    return files


def record_freeze(cfg, name: str, rules_version: str | None, note: str = "", snapshot: str | None = None,
                  artifacts: list | None = None) -> dict:
    p = cfg.paths
    path = p.reports / "build_manifest.json"
    m = read_json(path) if path.exists() else {}
    splits = read_json(p.reports / "split_manifest.json")
    pf = read_json(p.reports / "preflight.json")
    runtimes = p.reports / "stage_runtimes.json"
    entry = {
        "name": name, "rules_version": rules_version,
        "recorded_at": dt.datetime.now().isoformat(timespec="seconds"),
        "git": git_state(),
        "config_sha256": sha256(ROOT / "config" / "config.yaml"),
        "layout_rules_sha256": sha256(ROOT / "config" / "layout_rules.yaml"),
        "cutoffs": {k: splits[k]["cutoff"] for k in splits if isinstance(splits[k], dict)},
        "cohort_selected": pf.get("strata", {}).get("selected"),
        "stage_runtimes_s": read_json(runtimes) if runtimes.exists() else {},
        "source_snapshot": snapshot,
        "note": note,
    }
    if artifacts is not None:
        entry["artifacts_sha256"] = {str(f.relative_to(ROOT) if f.is_relative_to(ROOT) else f): sha256(f) for f in artifacts}
    m.update({"dataset_version": cfg["dataset_version"], "schema_version": cfg["schema_version"],
              "seed": cfg["seed"], "python": platform.python_version(), "smoke": cfg.smoke})
    m["freeze_points"] = [f for f in m.get("freeze_points", []) if f["name"] != name] + [entry]
    m["freeze_reached"] = name
    write_json(path, m)
    return entry


def package_versions() -> dict:
    lock = ROOT / "requirements.lock"
    out = {}
    if lock.exists():
        for line in lock.read_text().splitlines():
            if "==" in line:
                k, v = line.split("==", 1)
                out[k.strip()] = v.strip()
    return out


def checksum_files(cfg) -> list:
    p = cfg.paths
    files = sorted(p.raw.glob("*.csv"))
    for d in (p.processed, p.frontend, p.reports):
        files += sorted(f for f in d.rglob("*") if f.is_file() and f.name != "checksums.sha256")
    return files


def run(cfg, con, force: bool = False):
    """8.16: final data card render, build_manifest.json (freeze C, data-only) and checksums.sha256."""
    from . import export
    from .log import DataLog
    p = cfg.paths
    export.data_card(cfg)
    record_freeze(cfg, "C", "v1 (hand-written baseline, scoring harness only)",
                  note=("Data-only build: dataset v1 + compressed representations (all E x D x precision) + exposure audit "
                        "+ data card + docs/PIPELINE.md. No utility-based selection; canonical size left to the model stage. "
                        f"Cutoff {export.RESERVED_CUTOFF} reserved, untouched."))
    m = read_json(p.reports / "build_manifest.json")
    splits = read_json(p.reports / "split_manifest.json")
    pf = read_json(p.reports / "preflight.json")
    m.update({
        "git": git_state(), "packages": package_versions(),
        "config_sha256": sha256(ROOT / "config" / "config.yaml"),
        "layout_rules_sha256": sha256(ROOT / "config" / "layout_rules.yaml"),
        "cutoffs": {k: v["cutoff"] for k, v in splits.items() if isinstance(v, dict)},
        "reserved_cutoff": {"cutoff": export.RESERVED_CUTOFF, "status": "untouched, reserved for the model's final test"},
        "cohort_counts": pf["strata"],
        "canonical_config": None,
        "stage_runtimes_s": read_json(p.reports / "stage_runtimes.json") if (p.reports / "stage_runtimes.json").exists() else {},
    })
    write_json(p.reports / "build_manifest.json", m)
    files = checksum_files(cfg)
    lines = [f"{sha256(f)}  {f.relative_to(ROOT) if f.is_relative_to(ROOT) else f}" for f in files]
    (p.reports / "checksums.sha256").write_text("\n".join(lines) + "\n")
    DataLog(p.reports).append("manifest", note=f"{len(files)} files checksummed; freeze point C recorded")
    print(f"manifest: {len(files)} files checksummed")
