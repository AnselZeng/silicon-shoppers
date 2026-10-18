"""Paths and settings for the laptop server. Secrets come from the repo's .env (gitignored)."""
from __future__ import annotations

import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
WORK = HERE / "work"                          # bundle, local test database, logs, state (gitignored)
def _app_dir() -> Path:
    v = os.environ.get("ATELIER_APP_DIR")
    if v:
        return Path(v)
    for cand in (REPO.parent / "frontend", REPO.parent / "silicon-shoppers" / "frontend", REPO.parent / "la-hacks-app"):
        if (cand / "lib" / "store" / "catalog.ts").exists():
            return cand
    return REPO.parent / "la-hacks-app"


APP_DIR = _app_dir()   # the store app; set ATELIER_APP_DIR in .env to point elsewhere

# refresh job
REFRESH_EVERY_S = int(os.environ.get("REFRESH_EVERY_S", 120))
TRENDING_MINUTES = int(os.environ.get("TRENDING_MINUTES", 60))
SESSION_LAST_EVENTS = 40                      # the session model was trained on prefixes of up to 40 events


def env() -> dict:
    """KEY=value lines from .env, with real environment variables winning."""
    out = {}
    f = REPO / ".env"
    if f.exists():
        raw = f.read_bytes()
        # Notepad may save UTF-16 or UTF-8 with a BOM
        text = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8-sig", errors="replace")
        for line in text.splitlines():
            line = line.strip()
            if line.lower().startswith("export "):
                line = line[7:]
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    # real environment variables win, but an empty one doesn't wipe a value from .env
    out.update({k: v for k, v in os.environ.items() if v != "" or k not in out})
    return out


def backend() -> str:
    """'snowflake' (default) or 'local' (DuckDB file in server/work, same tables; for testing without an account)."""
    return env().get("ATELIER_DB", "snowflake").lower()
