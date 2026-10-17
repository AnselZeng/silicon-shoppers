"""Paths and settings for the laptop server. Secrets come from the repo's .env (gitignored)."""
from __future__ import annotations

import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
WORK = HERE / "work"                          # bundle, local test database, logs, state (gitignored)
APP_DIR = Path(os.environ.get("ATELIER_APP_DIR", REPO.parent / "la-hacks-app"))

# refresh job
REFRESH_EVERY_S = int(os.environ.get("REFRESH_EVERY_S", 120))
TRENDING_MINUTES = int(os.environ.get("TRENDING_MINUTES", 60))
SESSION_LAST_EVENTS = 40                      # the session model was trained on prefixes of up to 40 events


def env() -> dict:
    """KEY=value lines from .env, with real environment variables winning."""
    out = {}
    f = REPO / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    out.update(os.environ)
    return out


def backend() -> str:
    """'snowflake' (default) or 'local' (DuckDB file in server/work, same tables; for testing without an account)."""
    return env().get("ATELIER_DB", "snowflake").lower()
