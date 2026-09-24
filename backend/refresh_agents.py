"""Reparse existing user agents after a parser update; preserve event data."""

import json
import sys
from pathlib import Path

from database import connect
from geo import browser_info

config = json.loads(Path(sys.argv[1]).read_text())
with connect(config["database"]) as db:
    records = db.execute("SELECT id,user_agent FROM visits").fetchall()
    for record in records:
        info = browser_info(record["user_agent"])
        db.execute(
            "UPDATE visits SET browser=?,browser_version=?,os=?,device=?,is_bot=? WHERE id=?",
            (
                info["browser"],
                info["browser_version"],
                info["os"],
                info["device"],
                info["is_bot"],
                record["id"],
            ),
        )
print(f"Refreshed browser labels for {len(records)} existing visits")
