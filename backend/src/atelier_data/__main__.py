"""CLI: python -m atelier_data <command> [--smoke] [--force]"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

from . import cohort, compress, config, db, evaluate, export, exposure, features, fusion, ingest, manifest, splits, validity, verify
from .config import _finite, merge_json, write_json
from .log import DataLog

COMPETITION = "h-and-m-personalized-fashion-recommendations"
RAW_FILES = [ingest.TX_CSV, ingest.ART_CSV, ingest.CUST_CSV]


def download(cfg, con, force=False):
    raw = cfg.paths.raw
    raw.mkdir(parents=True, exist_ok=True)
    for name in RAW_FILES:
        z = raw / f"{name}.zip"
        if not (raw / name).exists() and z.exists():
            with zipfile.ZipFile(z) as zf:
                zf.extractall(raw)
    missing = [n for n in RAW_FILES if not (raw / n).exists()]
    if not missing:
        print("download: all three CSVs present in data/raw")
        return
    cred = Path.home() / ".kaggle" / "kaggle.json"
    if not cred.exists():
        sys.exit("Kaggle credentials missing. Accept the competition rules at\n"
                 f"  https://www.kaggle.com/competitions/{COMPETITION}/rules\n"
                 "then save your API token to ~/.kaggle/kaggle.json and `chmod 600` it,\n"
                 f"or place {', '.join(RAW_FILES)} in {raw} manually.")
    for name in missing:  # never the whole archive (~30 GB of images)
        subprocess.run(["kaggle", "competitions", "download", "-c", COMPETITION, "-f", name, "-p", str(raw)], check=True)
        z = raw / f"{name}.zip"
        if z.exists():
            with zipfile.ZipFile(z) as zf:
                zf.extractall(raw)


def clear_tmp(tmp: Path):
    for f in tmp.iterdir():
        shutil.rmtree(f) if f.is_dir() else f.unlink()


STAGES = {
    "download": download,
    "ingest": ingest.run,
    "verify": verify.run,
    "splits": splits.run,
    "cohort": cohort.run,
    "build": features.run,
    "validity": validity.run,
    "evaluate": evaluate.run,
    "compress": compress.run,
    "audit": exposure.run,
    "reconstruct": compress.reconstruct,
    "export": export.run,
    "leakage-check": lambda cfg, con, force=False: features.leakage_check(cfg, con),
    "manifest": manifest.run,
    "otto-download": fusion.download,
    "otto-ingest": fusion.ingest,
    "otto-features": fusion.features,
    "fuse": fusion.fuse,
}
ALL = ["ingest", "verify", "splits", "cohort", "build", "validity", "evaluate", "compress", "audit", "export",
       "leakage-check", "manifest"]
FUSION = ["otto-download", "otto-ingest", "otto-features", "fuse"]  # needs OTTO; separate from `all`


def score_command(cfg, a):
    if not a.layouts or not a.cutoff:
        sys.exit("score needs --layouts <file.parquet> and --cutoff dev|final")
    con = db.connect(cfg)
    try:
        res = evaluate.score_layouts(cfg, con, a.layouts, a.cutoff)
    except evaluate.LayoutError as e:
        sys.exit(f"score: invalid layout file: {e}")
    finally:
        con.close()
        clear_tmp(cfg.paths.tmp)
    if a.out:
        write_json(Path(a.out), res)
        print(f"score: wrote {a.out}")
    else:
        print(json.dumps(_finite(json.loads(json.dumps(res, default=str))), indent=2))


def main(argv=None):
    ap = argparse.ArgumentParser(prog="atelier_data")
    ap.add_argument("command", choices=list(STAGES) + ["all", "fusion", "score"])
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--layouts", help="score: Parquet with one layout per cohort shopper")
    ap.add_argument("--cutoff", choices=["dev", "final"], help="score: which held-out window")
    ap.add_argument("--out", help="score: write the JSON result here (default: stdout)")
    a = ap.parse_args(argv)
    cfg = config.load(smoke=a.smoke)
    if a.command == "score":
        return score_command(cfg, a)
    cfg.paths.makedirs()
    for name in {"all": ALL, "fusion": FUSION}.get(a.command, [a.command]):
        t = time.perf_counter()
        con = db.connect(cfg)  # fresh per stage: views see the latest files, spill files are released
        try:
            STAGES[name](cfg, con, force=a.force)
        finally:
            con.close()
            clear_tmp(cfg.paths.tmp)
        secs = round(time.perf_counter() - t, 1)
        print(f"[{name}] {secs}s")
        merge_json(cfg.paths.reports / "stage_runtimes.json", {name: secs})
        DataLog(cfg.paths.reports).append(f"runtime:{name}", note=f"{secs}s")


if __name__ == "__main__":
    main()
