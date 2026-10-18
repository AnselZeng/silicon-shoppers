"""python -m session_model <command>   (run from the repo root; see session_model/README.md)

  data      OTTO events -> sampled shoppers, first 40 events, later-event style targets
            (downloads + ingests OTTO with the repo's fusion stages if needed: Kaggle token, ~15 GB disk)
  train     features for 3/5/10/20/40 live events, one LightGBM model per style target, held-out R² table
  export    web/session_model.json + web/fixtures.json for the browser runtime
  all       data -> train -> export
  demo      show how the page adapts as three example visitors click (needs export)
  smoke     the whole pipeline on synthetic OTTO-shaped data in work/smoke (a minute; no download)
"""
from __future__ import annotations

import argparse
import json
import random
import warnings

warnings.filterwarnings("ignore")


def demo(web):
    from .export import decide, predict
    from .features import session_features
    model = json.loads((web / "session_model.json").read_text())
    rnd = random.Random(1)

    def visitor(kind):
        ev, ts, seen = [], 1_700_000_000, []
        for i in range(40):
            if kind == "explorer":          # many different items, quick clicks, rarely carts
                ts += rnd.randint(4, 15); aid = rnd.randint(1, 10_000); typ = 0
            elif kind == "comparer":         # few items, keeps coming back, slow
                ts += rnd.randint(30, 120)
                aid = rnd.choice(seen) if seen and rnd.random() < 0.5 else rnd.randint(1, 10_000); typ = 0
            else:                            # decisive: clicks then carts quickly
                ts += rnd.randint(5, 20); aid = rnd.randint(1, 10_000); typ = 0
                if i % 4 == 3 and seen:
                    aid, typ = seen[-1], 1
            seen.append(aid)
            ev.append((ts, aid, typ))
        return ev

    for kind in ("explorer", "comparer", "decisive"):
        ev = visitor(kind)
        print(f"\n== {kind} visitor ==")
        for n in (3, 10, 20, 40):
            style = predict(model, session_features(ev[:n]))
            d = decide(model, style, n)
            on = {k: v["value"] for k, v in d.items() if v["active"]}
            print(f"  after {n:2d} events: " + ", ".join(f"{k} {v:.2f}" for k, v in style.items()))
            print(f"                   page changes: {on or 'none yet'}")


def main():
    ap = argparse.ArgumentParser(prog="python -m session_model", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["data", "train", "export", "all", "demo", "smoke"])
    ap.add_argument("--events", default=None, help="OTTO events parquet (default: data/ingested/otto_events.parquet)")
    ap.add_argument("--sample", type=int, default=None, help="shoppers to sample (default 200000 or $SESSION_SAMPLE)")
    a = ap.parse_args()

    from pathlib import Path
    from . import config as K
    from . import data, export, train

    sample = a.sample or K.SAMPLE
    if a.cmd == "smoke":
        work, web = K.WORK / "smoke", K.WORK / "smoke" / "web"
        ev = data.synthetic_events(work / "synthetic_events.parquet")
        data.build(ev, work, sample=10**9)
        train.build_samples(work)
        train.print_table(train.train(work))
        export.export(work, web)
        demo(web)
        print(f"\nsmoke OK (synthetic data only; numbers mean nothing). Outputs in {work}")
        return
    if a.cmd in ("data", "all"):
        ev = data.ensure_events(Path(a.events) if a.events else None)
        data.build(ev, K.WORK, sample=sample)
    if a.cmd in ("train", "all"):
        train.build_samples(K.WORK)
        train.print_table(train.train(K.WORK))
    if a.cmd in ("export", "all"):
        export.export(K.WORK, K.WEB)
    if a.cmd == "demo":
        demo(K.WEB)


if __name__ == "__main__":
    main()
