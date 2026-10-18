"""python -m model <command>   (run from the repo root; see model/README.md)

v2 pipeline (multi-window, no OTTO values, clean 2019 test)
  windows    build 11 monthly training windows + dev + final (features capped at 330 days)   (~20 min)
  train      layout models on the 12 training windows; every candidate setup scored on August  (~20 min)
  items      item ranker on the training windows; August MAP@12 vs baselines; tiles for all shoppers (~15 min)
  freeze     pick the setup per decision on August, fingerprint the model files
  test2019   ONE run on the reserved 2019 window, 100k shoppers outside the cohort (refuses a silent rerun)
  export     one homepage JSON per shopper from the frozen models (~1 min)
  all        windows -> train -> items -> freeze -> export (not test2019: run it yourself, once)
  publish    upload homepages to Supabase (project owner only)

v1 (single July window, kept for comparison)
  v1-history, v1-layouts [--sets ...] [--final], v1-items [--final], v1-ablation
"""
from __future__ import annotations

import argparse
import warnings

warnings.filterwarnings("ignore")

SHIPPED_V1 = "f37_hist"
ABLATION_V1 = "f37_hist,h25,h27,f37,hist,h27_hist,pca4,pca8"


def train_names():
    from . import windows as W
    return [n for n, w in W.plan(W.base_cfg()).items() if w["role"] == "train"]


def choose_and_freeze():
    """Per decision, the setup with the larger August gain (the margins were tuned on training windows only)."""
    import numpy as np
    from atelier_data.config import read_json
    from . import mw, test2019
    res = read_json(mw.OUT / "results.json")["combos"]
    dec_of = {"cat": "category_order", "dept": "landing_department", "sec": "section_order"}
    pick = {}
    for key, dec in dec_of.items():
        best = max({r["combo"][key] for r in res},
                   key=lambda setup: max(r["valid"][dec]["gain"] for r in res if r["combo"][key] == setup))
        pick[key] = best
    row = next(r for r in res if r["combo"] == pick)
    policy = {k: (np.inf if v is None else v) for k, v in row["policy"].items()}
    print(f"chosen on August: {pick}, margins {row['policy']}")
    test2019.freeze(pick, policy, note="setups chosen per decision on August (final); margins tuned on the "
                                       "12 training windows out-of-fold")


def main():
    ap = argparse.ArgumentParser(prog="python -m model", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["windows", "train", "items", "freeze", "test2019", "export", "all", "publish",
                                    "v1-history", "v1-layouts", "v1-items", "v1-ablation"])
    ap.add_argument("--sets", default=SHIPPED_V1, help="v1-layouts: comma-separated feature sets")
    ap.add_argument("--final", action="store_true", help="v1: also score the final window")
    ap.add_argument("--seed", type=int, default=20261015)
    ap.add_argument("--i-know-this-is-a-rerun", dest="rerun", action="store_true",
                    help="test2019: allow a second run (recorded in the report)")
    a = ap.parse_args()

    if a.cmd in ("windows", "all"):
        from . import windows as W
        W.build()
    if a.cmd in ("train", "all"):
        from . import mw
        mw.train(train_names(), "final", a.seed)
    if a.cmd in ("items", "all"):
        from . import items_mw
        items_mw.train(train_names(), "final", a.seed)
        items_mw.export_tiles("final")
    if a.cmd in ("freeze", "all"):
        choose_and_freeze()
    if a.cmd in ("export", "all"):
        from . import export
        export.write_all()
    if a.cmd == "test2019":
        from . import test2019
        test2019.run(rerun=a.rerun)
    if a.cmd == "publish":
        from . import publish
        publish.main()

    # v1 (single window, fused 37 values)
    if a.cmd.startswith("v1-"):
        from . import run
        if a.cmd == "v1-history":
            run.build_history(force=True)
        elif a.cmd == "v1-layouts":
            run.run_layouts(a.sets.split(","), a.final, a.seed)
        elif a.cmd == "v1-items":
            run.run_items(a.seed, a.final)
        elif a.cmd == "v1-ablation":
            run.run_layouts(ABLATION_V1.split(","), True, a.seed)


if __name__ == "__main__":
    main()
