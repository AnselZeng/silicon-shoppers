"""Build pkg.zip for the Snowpark procedures: code packages + duckdb stub + handlers.

    .venv\\Scripts\\python deploy\\pack.py
"""
from __future__ import annotations

import shutil
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
OUT = HERE / "out"

PACKAGES = [
    (REPO / "server", "server"),
    (REPO / "model", "model"),
    (REPO / "session_model", "session_model"),
    (REPO / "src" / "atelier_data", "atelier_data"),
]
MODULES = [
    (HERE / "jobs.py", "jobs.py"),
    (HERE / "snowpark_db.py", "snowpark_db.py"),
]

DUCKDB_STUB = '"""Stub: atelier_data.db imports duckdb at module top, but the proc never connects."""\n\ndef connect(*a, **k):\n    raise RuntimeError("duckdb is not available inside Snowflake procedures")\n\nDuckDBPyConnection = object\n'


def build() -> Path:
    OUT.mkdir(exist_ok=True)
    work = OUT / "pkg"
    shutil.rmtree(work, ignore_errors=True)
    for src, dest in PACKAGES:
        shutil.copytree(src, work / dest,
                        ignore=shutil.ignore_patterns("__pycache__", "work", "tests", "*.pyc"))
    for src, dest in MODULES:
        shutil.copy(src, work / dest)
    (work / "duckdb.py").write_text(DUCKDB_STUB)
    zpath = OUT / "pkg.zip"
    if zpath.exists():
        zpath.unlink()
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(work.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(work))
    print(f"pkg.zip: {zpath} ({zpath.stat().st_size / 1e6:.1f} MB)")
    return zpath


if __name__ == "__main__":
    build()
