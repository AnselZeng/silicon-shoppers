"""The one clean test: frozen models on the reserved 2019 window (2019-08-26 to 2019-09-22), scored on 100k
shoppers outside the cohort (25k per history group, salted hash). Nothing about these shoppers or this window
was used for training, tuning or choosing.

    python -m model freeze      # after choosing on August: fingerprints every model file
    python -m model test2019    # builds the 2019 inputs + labels, scores ONCE, writes reports

The test refuses to run if the frozen files changed since `freeze`, and refuses a second run (the marker file
model/work/frozen/TEST_2019_DONE) unless --i-know-this-is-a-rerun is given, so tuning against 2019 is visible.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import pickle
import sys

import lightgbm as lgb
import numpy as np
import pandas as pd

from atelier_data import evaluate
from atelier_data.config import read_json, write_json

from . import common as C
from . import items_mw, mw
from . import windows as W

FROZEN = C.WORK / "frozen"
MARKER = FROZEN / "TEST_2019_DONE"
ARTIFACTS = ["models.pkl", "item_ranker.txt", "choice.json"]


def _sha(p) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def freeze(combo: dict, policy: dict, note: str = ""):
    """Copy the chosen artifacts into model/work/frozen and record their fingerprints."""
    FROZEN.mkdir(parents=True, exist_ok=True)
    (FROZEN / "models.pkl").write_bytes((mw.OUT / "models.pkl").read_bytes())
    (FROZEN / "item_ranker.txt").write_bytes((mw.OUT / "item_ranker.txt").read_bytes())
    write_json(FROZEN / "choice.json", {"combo": combo, "policy": {k: (None if not np.isfinite(v) else v)
                                                                   for k, v in policy.items()}, "note": note})
    manifest = {"frozen_at": dt.datetime.now().isoformat(timespec="seconds"),
                "sha256": {a: _sha(FROZEN / a) for a in ARTIFACTS}}
    write_json(FROZEN / "manifest.json", manifest)
    print(f"frozen: {manifest}")
    return manifest


def run(rerun: bool = False):
    man = read_json(FROZEN / "manifest.json")
    for a, h in man["sha256"].items():
        if _sha(FROZEN / a) != h:
            sys.exit(f"{a} changed since freeze: refreeze deliberately before testing")
    if MARKER.exists() and not rerun:
        sys.exit(f"The 2019 test already ran ({MARKER.read_text().strip()}). A rerun after changes is tuning on the "
                 "test; pass --i-know-this-is-a-rerun to do it anyway (it will be recorded).")
    W.build(["reserved"], include_reserved_targets=True)
    rc = W.run_cfg()
    con = W.db.connect(rc)
    vocab = read_json(rc.paths.processed / "vocabularies.json")
    frozen = evaluate.load_frozen(rc)
    choice = read_json(FROZEN / "choice.json")
    combo = choice["combo"]
    policy = {k: (np.inf if v is None else v) for k, v in choice["policy"].items()}
    with open(FROZEN / "models.pkl", "rb") as fh:
        pk = pickle.load(fh)
    w = mw.Win(rc, con, vocab, frozen, "reserved")
    S = mw.predict_scores(pk["models"], w, pk["cols"], vocab, frozen, rc)
    picks = {"cat": S[f"cat:{combo['cat']}"], "dept": S[f"dept:{combo['dept']}"], "sec": S[f"sec:{combo['sec']}"],
             "sort": S["sort:regress"], "mc": S["mc:offset"]}
    L = mw.layout(picks, w, vocab, rc, policy)
    res = evaluate.score_cut(con, rc, "reserved", frozen, vocab, w.prof, L)
    res.pop("_T")
    out = {"window": W.plan(W.base_cfg())["reserved"], "shoppers": int(len(w.users)),
           "layout": mw.summarize(res)}
    ranker = lgb.Booster(model_file=str(FROZEN / "item_ranker.txt"))
    out["items"] = items_mw.score_window(con, rc, vocab, "reserved", ranker, ranker.feature_name())
    out["frozen_manifest"] = man
    out["rerun"] = bool(rerun)
    write_json(FROZEN / "test_2019.json", out)
    write_json(C.WORK / "mw" / "eval_reserved_full.json", res)
    MARKER.write_text(f"ran {dt.datetime.now().isoformat(timespec='seconds')}{' (RERUN)' if rerun else ''}\n")
    print(json.dumps({k: v for k, v in out.items() if k != "frozen_manifest"}, indent=1, default=str))
    return out
