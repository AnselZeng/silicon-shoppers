"""Hackathon-day retrain: every model trained again from scratch on this laptop, logged step by step.

    python -m server retrain                 # full: H&M windows -> layouts -> items -> freeze -> 2019 -> export,
                                             # then the live session model, the serving bundle, and Snowflake
    python -m server retrain --skip-hm       # only the session model + bundle (minutes)
    python -m server retrain --no-snowflake  # train only, upload later with `python -m server publish-run`

What it guarantees:
  - The models frozen on 2026-10-15 (the ones the 2019 test was run on) are copied to
    model/work/frozen_backup_<time> first, untouched.
  - Same code, same data, same seeds: this is a reproduction run. The 2019 test is re-run on the new models
    with --i-know-this-is-a-rerun, so its report says "rerun", and the comparison table puts the new numbers
    next to the backed-up ones.
  - Every step's output goes to server/work/logs/retrain_<time>.log; the summary to server/work/retrain_<time>.json
    and the MODEL_RUNS table.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import platform
import shutil
import subprocess
import sys
import time

from .config import REPO, WORK

FROZEN = REPO / "model" / "work" / "frozen"
RUNS = REPO / "model" / "work" / "runs"
SESSION_WORK = REPO / "session_model" / "work"


def _steps(skip_hm: bool, session_data: bool) -> list[tuple[str, list[str]]]:
    py = [sys.executable, "-m"]
    s = []
    if not skip_hm:
        s += [("H&M: build 11 training windows + dev + final", py + ["model", "windows"]),
              ("H&M: layout models on 12 windows, scored on August", py + ["model", "train"]),
              ("H&M: section models (one window, LambdaRank)",
               [sys.executable, "-c", "from model import mw; mw.add_section_variants(['dev'])"]),
              ("H&M: item ranker + baselines + tiles", py + ["model", "items"]),
              ("H&M: choose per decision on August, freeze", py + ["model", "freeze"]),
              ("H&M: 2019 test on the new models (recorded as a rerun)", py + ["model", "test2019", "--i-know-this-is-a-rerun"]),
              ("H&M: homepage documents for 100k shoppers", py + ["model", "export"])]
    if session_data:
        s.append(("Session: sample OTTO shoppers", py + ["session_model", "data"]))
    s += [("Session: train live session model (incl. single-visit table)", py + ["session_model", "train"]),
          ("Session: export browser model", py + ["session_model", "export"])]
    s.append(("Serving bundle for the refresh job", py + ["server", "bundle"]))
    return s


def _metrics() -> dict:
    out = {}
    t = FROZEN / "test_2019.json"
    if t.exists():
        r = json.loads(t.read_text())
        out["test_2019"] = {d: {k: v.get(k) for k in ("gain", "ci95", "changed_users", "validated") if k in v}
                            for d, v in r["layout"].items() if d != "_extra"}
        it = r.get("items", {})
        out["test_2019_items_map12"] = {pol: {m: v.get("map12") for m, v in d.items() if isinstance(v, dict)}
                                        for pol, d in it.items() if isinstance(d, dict)}
        out["test_2019_rerun"] = r.get("rerun")
    sr = SESSION_WORK / "report.json"
    if sr.exists():
        r = json.loads(sr.read_text())
        out["session_r2"] = {t: v.get("r2_by_events") for t, v in r.get("targets", {}).items()}
        out["session_r2_single_visit"] = {t: v.get("r2_single_visit") for t, v in r.get("targets", {}).items()}
    m = FROZEN / "manifest.json"
    if m.exists():
        out["frozen_manifest"] = json.loads(m.read_text())
    return out


def _compare(old: dict, new: dict) -> str:
    rows = ["decision              before (Oct 15)               today", "-" * 72]
    for d in ("section_order", "color_highlight", "landing_department", "category_order", "default_sort"):
        a = old.get("test_2019", {}).get(d, {})
        b = new.get("test_2019", {}).get(d, {})
        f = lambda r: (f"{r.get('gain', float('nan')):+.4f} {'confirmed' if r.get('validated') else 'not confirmed'}"
                       if r else "n/a")
        rows.append(f"{d:<22}{f(a):<30}{f(b)}")
    return "\n".join(rows)


def run(skip_hm: bool = False, snowflake: bool = True, session_data: bool | None = None) -> dict:
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    logs = WORK / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    log_path = logs / f"retrain_{stamp}.log"
    if session_data is None:
        session_data = not (SESSION_WORK / "prefix_events.parquet").exists()
    before = _metrics()
    backup = None
    if FROZEN.exists() and not skip_hm:
        backup = FROZEN.parent / f"frozen_backup_{stamp}"
        shutil.copytree(FROZEN, backup)
    sr = SESSION_WORK / "report.json"
    if sr.exists():
        shutil.copy2(sr, SESSION_WORK / f"report_backup_{stamp}.json")
    steps = _steps(skip_hm, session_data)
    started = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    summary = {"run_id": f"retrain-{stamp}", "started_at": started.isoformat(timespec="seconds"),
               "machine": {"host": platform.node(), "os": platform.platform(), "cpus": os.cpu_count(),
                           "python": platform.python_version()},
               "backup_of_previous_models": str(backup) if backup else None, "steps": []}
    print(f"retrain {summary['run_id']}: {len(steps)} steps, log: {log_path}")
    if backup:
        print(f"previous frozen models (the Oct 15 2019 test) backed up to {backup}")
    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}
    with open(log_path, "a", encoding="utf-8") as log:
        for i, (name, cmd) in enumerate(steps, 1):
            t0 = time.time()
            head = f"[{dt.datetime.now():%H:%M:%S}] step {i}/{len(steps)}: {name}"
            print(head, flush=True)
            log.write(f"\n===== {head}\n$ {' '.join(cmd)}\n")
            log.flush()
            p = subprocess.Popen(cmd, cwd=REPO, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                 encoding="utf-8", errors="replace", env=env)
            for line in p.stdout:
                log.write(line)
                log.flush()
                if line.strip():
                    print(f"    {line.rstrip()[:160]}", flush=True)
            p.wait()
            secs = round(time.time() - t0, 1)
            summary["steps"].append({"step": name, "seconds": secs, "exit": p.returncode})
            print(f"    done in {secs / 60:.1f} min (exit {p.returncode})", flush=True)
            if p.returncode != 0:
                summary["status"] = f"failed at step {i}: {name}"
                break
        else:
            summary["status"] = "ok"
    summary["finished_at"] = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")
    after = _metrics()
    summary["before"], summary["after"] = before, after
    table = _compare(before, after)
    summary["comparison"] = table
    out = WORK / f"retrain_{stamp}.json"
    out.write_text(json.dumps(summary, indent=1, default=str))
    print("\n2019 test, previous models vs today's retrain (same code, data and seeds):\n" + table)
    print(f"\nsummary: {out}\nstatus: {summary['status']}")
    if snowflake and summary["status"] == "ok":
        publish_run(out)
    return summary


def publish_run(summary_path=None):
    """MODEL_RUNS row for the retrain + the H&M homepages, then rescore every known store shopper."""
    import pandas as pd
    from . import bundle, refresh
    from .sf import DB
    if summary_path is None:
        cands = sorted(WORK.glob("retrain_*.json"))
        if not cands:
            raise SystemExit("no retrain summary in server/work: run `python -m server retrain` first")
        summary_path = cands[-1]
    s = json.loads(open(summary_path, encoding="utf-8").read())
    db = DB()
    db.upsert("MODEL_RUNS", pd.DataFrame([{
        "run_id": s["run_id"], "kind": "retrain", "started_at": pd.Timestamp(s["started_at"]),
        "finished_at": pd.Timestamp(s["finished_at"]), "status": s["status"],
        "model_version": (s.get("after", {}).get("frozen_manifest") or {}).get("frozen_at", "?"),
        "details": {k: s[k] for k in ("machine", "steps", "after", "comparison", "backup_of_previous_models")}}]),
        "run_id", variant=("details",))
    print(f"MODEL_RUNS: {s['run_id']} ({s['status']})")
    publish_hm(db)
    users = db.query("SELECT DISTINCT USER_ID FROM EVENTS")["user_id"].tolist()
    if users:
        refresh.refresh_once(db, bundle.load(), users=users)
    db.close()


def publish_hm(db=None):
    """The 100k H&M homepage documents and their tile articles (model/work/export) -> HM_HOMEPAGES / HM_ARTICLES."""
    import pandas as pd
    from .sf import DB
    own = db is None
    db = db or DB()
    ex = REPO / "model" / "work" / "export"
    pages = pd.read_parquet(ex / "homepages_final_compact.parquet")
    arts = pd.read_parquet(ex / "homepage_articles_final.parquet")
    pages = pages.assign(homepage=pages["homepage"].map(json.loads))
    t0 = time.time()
    db.replace("HM_ARTICLES", arts[["article_id", "name", "category", "department", "color", "price_scaled"]])
    db.replace("HM_HOMEPAGES", pages[["customer_key", "stratum", "homepage"]], variant=("homepage",))
    print(f"HM_HOMEPAGES: {len(pages):,} documents, HM_ARTICLES: {len(arts):,} ({time.time() - t0:.0f}s)")
    if own:
        db.close()
