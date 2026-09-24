"""Consistent SQLite backup; keep fourteen daily copies, retain the live database."""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

data = Path("/var/lib/gaasd-analytics")
backups = data / "backups"
backups.mkdir(mode=0o700, exist_ok=True)
destination = backups / f"analytics-{datetime.now(timezone.utc):%Y%m%d}.sqlite3"
with sqlite3.connect(data / "analytics.sqlite3") as source, sqlite3.connect(destination) as target:
    source.backup(target)
destination.chmod(0o600)
for expired in sorted(backups.glob("analytics-????????.sqlite3"), reverse=True)[14:]:
    expired.unlink()
print("Daily analytics backup completed")
