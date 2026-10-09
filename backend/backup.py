"""Consistent SQLite backups; keep fourteen daily copies of each database."""

import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path


def daily_backup(data=Path("/var/lib/gaasd-analytics")):
    backups = data / "backups"
    backups.mkdir(mode=0o700, exist_ok=True)
    for prefix, database in [
        ("analytics", data / "analytics.sqlite3"),
        ("gpu-usage", data / "status/intranet/gpu-usage.sqlite3"),
    ]:
        if prefix == "gpu-usage" and not database.exists():
            continue
        destination = backups / f"{prefix}-{datetime.now(timezone.utc):%Y%m%d}.sqlite3"
        temporary = destination.with_suffix(".sqlite3.tmp")
        with (
            closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)) as source,
            closing(sqlite3.connect(temporary)) as target,
        ):
            source.backup(target)
        temporary.chmod(0o600)
        os.replace(temporary, destination)
        for expired in sorted(backups.glob(f"{prefix}-????????.sqlite3"), reverse=True)[14:]:
            expired.unlink()
    print("Daily analytics and GPU usage backups completed")


if __name__ == "__main__":
    daily_backup()
