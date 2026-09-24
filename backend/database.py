import sqlite3
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS visits (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL, started_at INTEGER NOT NULL,
 last_seen INTEGER NOT NULL, ip TEXT NOT NULL, region TEXT NOT NULL,
 country TEXT NOT NULL, province TEXT NOT NULL, city TEXT NOT NULL, isp TEXT NOT NULL,
 browser TEXT NOT NULL, browser_version TEXT NOT NULL, os TEXT NOT NULL,
 device TEXT NOT NULL, user_agent TEXT NOT NULL, is_bot INTEGER NOT NULL,
 path TEXT NOT NULL, referrer TEXT NOT NULL, source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS visits_started ON visits(started_at);
CREATE INDEX IF NOT EXISTS visits_session ON visits(session_id);
CREATE TABLE IF NOT EXISTS plays (
 id TEXT PRIMARY KEY, visit_id TEXT NOT NULL REFERENCES visits(id),
 video_id TEXT NOT NULL, started_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
 watched_ms INTEGER NOT NULL DEFAULT 0, position REAL NOT NULL DEFAULT 0,
 coverage REAL NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS plays_visit ON plays(visit_id);
CREATE INDEX IF NOT EXISTS plays_started ON plays(started_at);
CREATE TABLE IF NOT EXISTS legacy_media (
 id TEXT PRIMARY KEY, visit_id TEXT REFERENCES visits(id),
 video_id TEXT NOT NULL, timestamp INTEGER NOT NULL, ip TEXT NOT NULL,
 is_bot INTEGER NOT NULL, status INTEGER NOT NULL, bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS legacy_visit ON legacy_media(visit_id);
"""


@contextmanager
def connect(filename):
    connection = sqlite3.connect(filename, timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        yield connection
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize(filename):
    Path(filename).parent.mkdir(parents=True, exist_ok=True)
    with connect(filename) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(SCHEMA)


def insert_visit(db, record):
    columns = list(record)
    db.execute(
        f"INSERT OR IGNORE INTO visits ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
        [record[key] for key in columns],
    )
