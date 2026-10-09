"""Durable, bounded 8-GPU observations; calendar reports only read SQLite.

Utilization is the mean of eight device percentages, not a FLOPS measurement.
Missing/partial device samples are gaps. One observation per 30-second slot
prevents restart duplicates; coverage counts slots, not billable GPU hours.
"""

import math
import sqlite3
import time
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

INTERVAL = 30
RETENTION_DAYS = 400
GPU_COUNT = 8
SHANGHAI = timezone(timedelta(hours=8))


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def aggregate(snapshot):
    gpu = snapshot.get("gpu") or {}
    devices = gpu.get("devices") or []
    stamp = snapshot.get("generated_at")
    if not gpu.get("available") or len(devices) != GPU_COUNT or not finite(stamp) or stamp <= 0:
        return None
    if {item.get("index") for item in devices} != set(range(GPU_COUNT)):
        return None
    for item in devices:
        compute, used, total = (
            item.get(key) for key in ("utilization_percent", "memory_used", "memory_total")
        )
        if not all(finite(value) for value in (compute, used, total)):
            return None
        if not 0 <= compute <= 100 or not 0 <= used <= total or total <= 0:
            return None
    return (
        int(stamp // INTERVAL),
        stamp,
        sum(item["utilization_percent"] for item in devices) / GPU_COUNT,
        sum(item["memory_used"] for item in devices),
        sum(item["memory_total"] for item in devices),
    )


class UsageStore:
    def __init__(self, path):
        self.path = Path(path)
        self.pruned_day = None

    def record(self, snapshot):
        row = aggregate(snapshot)
        if row is None:
            return False
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=3)) as db, db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS samples (
                slot INTEGER PRIMARY KEY, timestamp REAL NOT NULL,
                compute REAL NOT NULL, memory_used INTEGER NOT NULL,
                memory_total INTEGER NOT NULL)""")
            inserted = db.execute("INSERT OR IGNORE INTO samples VALUES (?,?,?,?,?)", row).rowcount
            day = int(row[1] // 86400)
            if self.pruned_day != day:
                cutoff = int((row[1] - RETENTION_DAYS * 86400) // INTERVAL)
                db.execute("DELETE FROM samples WHERE slot < ?", (cutoff,))
        self.pruned_day = day
        return bool(inserted)


def calendar_range(group, count, through, now):
    if group not in {"day", "week"}:
        raise ValueError("Invalid grouping")
    count = int(count)
    if not 1 <= count <= (90 if group == "day" else 52):
        raise ValueError("Invalid range")
    today = datetime.fromtimestamp(now, SHANGHAI).date()
    end_date = datetime.strptime(through, "%Y-%m-%d").date() if through else today
    if (
        str(end_date) != (through or str(today))
        or not datetime(2020, 1, 1).date() <= end_date <= today
    ):
        raise ValueError("Invalid end date")
    final = datetime.combine(end_date, datetime.min.time(), SHANGHAI)
    days = 1 if group == "day" else 7
    if group == "week":
        final -= timedelta(days=final.weekday())
    start = final - timedelta(days=(count - 1) * days)
    return count, start, days * 86400


METRICS = """COUNT(*) AS sample_count, AVG(compute) AS avg_compute,
MAX(compute) AS peak_compute, AVG(memory_used) AS avg_memory_used_bytes,
MAX(memory_used) AS peak_memory_used_bytes, AVG(memory_total) AS avg_capacity_bytes,
AVG(100.0 * memory_used / memory_total) AS avg_memory_percent,
MAX(100.0 * memory_used / memory_total) AS peak_memory_percent"""


def bucket(row, start, end, now):
    values = (
        dict(row)
        if row
        else dict(
            sample_count=0,
            avg_compute=None,
            peak_compute=None,
            avg_memory_used_bytes=None,
            peak_memory_used_bytes=None,
            avg_capacity_bytes=None,
            avg_memory_percent=None,
            peak_memory_percent=None,
        )
    )
    values.pop("bucket", None)
    # Include the current slot in expected observations; missing slots stay missing.
    expected = max(0, math.ceil((min(end, now) - start) / INTERVAL))
    values.update(
        start=start,
        end=end,
        ongoing=start <= now < end,
        label=datetime.fromtimestamp(start, SHANGHAI).strftime("%Y-%m-%d"),
        expected_count=expected,
        coverage_percent=min(100, values["sample_count"] / expected * 100) if expected else 0,
    )
    return values


def report(path, group="day", count=14, through=None, now=None):
    now = time.time() if now is None else now
    count, start_date, period = calendar_range(group, count, through, now)
    start = int(start_date.timestamp())
    end = start + count * period
    rows, summary, first, last = {}, None, None, None
    path = Path(path)
    if path.is_file():
        with closing(
            sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=3)
        ) as db:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA query_only=ON")
            # A read transaction keeps metadata, buckets and totals consistent.
            db.execute("BEGIN")
            bounds = (start // INTERVAL, math.ceil(min(end, now) / INTERVAL))
            rows = {
                row["bucket"]: row
                for row in db.execute(
                    f"SELECT (slot-?)/? AS bucket, {METRICS} FROM samples "
                    "WHERE slot >= ? AND slot < ? GROUP BY bucket ORDER BY bucket",
                    (start // INTERVAL, period // INTERVAL, *bounds),
                )
            }
            summary = db.execute(
                f"SELECT {METRICS} FROM samples WHERE slot >= ? AND slot < ?", bounds
            ).fetchone()
            first_row = db.execute("SELECT timestamp FROM samples ORDER BY slot LIMIT 1").fetchone()
            last_row = db.execute(
                "SELECT timestamp FROM samples ORDER BY slot DESC LIMIT 1"
            ).fetchone()
            first = first_row[0] if first_row else None
            last = last_row[0] if last_row else None
    return dict(
        group=group,
        count=count,
        timezone="Asia/Shanghai",
        interval_seconds=INTERVAL,
        retention_days=RETENTION_DAYS,
        expected_gpus=GPU_COUNT,
        generated_at=now,
        first_sample_at=first,
        last_sample_at=last,
        ready=last is not None,
        stale=last is None or now - last > 90,
        summary=bucket(summary, start, end, now),
        periods=[
            bucket(rows.get(i), start + i * period, start + (i + 1) * period, now)
            for i in range(count)
        ],
    )
