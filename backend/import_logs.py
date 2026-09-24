"""One-time import of existing combined logs, explicitly separated from plays."""

import gzip
import hashlib
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from app import VIDEOS, clean_referrer
from database import connect, initialize, insert_visit
from geo import GeoLookup, browser_info

LINE = re.compile(
    r'^(\S+) \S+ \S+ \[([^\]]+)\] "(.*?)" (\d{3}) (\d+|-) "((?:\\.|[^"])*)" "((?:\\.|[^"])*)"'
)


def import_logs(config, filenames, cutoff=None):
    initialize(config["database"])
    cutoff = cutoff or int(time.time())
    geo = GeoLookup(config.get("geo_directory"))
    with connect(config["database"]) as db:
        if db.execute("SELECT 1 FROM meta WHERE key='historical_import_done'").fetchone():
            return {"already_imported": True}
    records = []
    for filename in filenames:
        reader = gzip.open if str(filename).endswith(".gz") else open
        with reader(filename, "rt", encoding="utf-8", errors="replace") as source:
            for line in source:
                match = LINE.match(line)
                if not match:
                    continue
                ip, date, req, status, size, ref, ua = match.groups()
                try:
                    stamp = int(datetime.strptime(date, "%d/%b/%Y:%H:%M:%S %z").timestamp())
                    method, path, _protocol = req.split(" ", 2)
                    path = urlsplit(path).path
                except ValueError:
                    continue
                if stamp >= cutoff or method != "GET" or int(status) not in {200, 206, 304}:
                    continue
                if path not in {"/", "/index.html"} and not (
                    path.startswith("/media/") and path.endswith(".mp4") and path[7:-4] in VIDEOS
                ):
                    continue
                records.append(
                    (
                        stamp,
                        ip,
                        ua[:1000],
                        path,
                        int(status),
                        int(size) if size != "-" else 0,
                        ref,
                        hashlib.sha256(line.encode()).hexdigest(),
                    )
                )
    records.sort(key=lambda record: record[0])
    sessions = {}
    visits = media = 0
    with connect(config["database"]) as db:
        for stamp, ip, ua, path, status, size, ref, digest in records:
            info = browser_info(ua)
            key = (ip, ua)
            previous = sessions.get(key)
            if previous is None or stamp - previous["last"] > 1800:
                previous = dict(session="legacy-" + digest, visit=None, last=stamp)
                sessions[key] = previous
            previous["last"] = stamp
            if path in {"/", "/index.html"}:
                visit_id = "legacy-" + digest
                try:
                    region = geo.lookup(ip)
                except ValueError:
                    continue
                before = db.total_changes
                insert_visit(
                    db,
                    dict(
                        id=visit_id,
                        session_id=previous["session"],
                        started_at=stamp,
                        last_seen=stamp,
                        ip=ip,
                        **region,
                        **info,
                        user_agent=ua,
                        path=path,
                        referrer=clean_referrer(ref),
                        source="nginx",
                    ),
                )
                visits += db.total_changes - before
                previous["visit"] = visit_id
            else:
                before = db.total_changes
                db.execute(
                    "INSERT OR IGNORE INTO legacy_media(id,visit_id,video_id,timestamp,ip,is_bot,status,bytes) VALUES (?,?,?,?,?,?,?,?)",
                    (
                        digest,
                        previous["visit"],
                        path[7:-4],
                        stamp,
                        ip,
                        info["is_bot"],
                        status,
                        size,
                    ),
                )
                media += db.total_changes - before
                if previous["visit"]:
                    db.execute(
                        "UPDATE visits SET last_seen=MAX(last_seen,?) WHERE id=?",
                        (stamp, previous["visit"]),
                    )
        for key, value in {
            "historical_import_done": "1",
            "historical_cutoff": str(cutoff),
            "historical_page_views": str(visits),
            "historical_media_requests": str(media),
            "tracking_started": str(cutoff),
        }.items():
            db.execute("INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)", (key, value))
    return {
        "historical_page_views": visits,
        "historical_media_requests": media,
        "cutoff": cutoff,
    }


if __name__ == "__main__":
    settings = json.loads(Path(sys.argv[1]).read_text())
    print(json.dumps(import_logs(settings, sys.argv[2:]), ensure_ascii=False))
