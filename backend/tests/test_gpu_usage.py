import json
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from app import create_app
from backup import daily_backup
from gpu_usage import SHANGHAI, UsageStore, aggregate, report
from status_collector import Sampler
from status_remote import poll
from werkzeug.security import generate_password_hash

GIB = 1024**3


def stamp(value):
    return datetime.fromisoformat(value).replace(tzinfo=SHANGHAI).timestamp()


def sample(at, compute=40, used=20):
    return dict(
        generated_at=at,
        gpu=dict(
            available=True,
            devices=[
                dict(
                    index=i,
                    utilization_percent=compute,
                    memory_used=used * GIB,
                    memory_total=80 * GIB,
                )
                for i in range(8)
            ],
        ),
    )


def test_aggregate_mean_not_sum_and_full_memory_capacity():
    data = sample(stamp("2026-10-09T12:00:00"))
    data["gpu"]["devices"][0]["utilization_percent"] = 80
    row = aggregate(data)
    assert row[2:] == (45, 160 * GIB, 640 * GIB)


@pytest.mark.parametrize(
    "fault", ["missing", "duplicate", "nan", "memory", "negative", "boolean", "unavailable"]
)
def test_partial_invalid_samples_are_gaps(tmp_path, fault):
    data = sample(stamp("2026-10-09T12:00:00"))
    devices = data["gpu"]["devices"]
    if fault == "missing":
        devices.pop()
    if fault == "duplicate":
        devices[0]["index"] = 1
    if fault == "nan":
        devices[0]["utilization_percent"] = float("nan")
    if fault == "memory":
        devices[0]["memory_used"] = 81 * GIB
    if fault == "negative":
        devices[0]["utilization_percent"] = -1
    if fault == "boolean":
        devices[0]["memory_total"] = True
    if fault == "unavailable":
        data["gpu"]["available"] = False
    assert not UsageStore(tmp_path / "usage.db").record(data)
    assert not (tmp_path / "usage.db").exists()


def test_deduplication_survives_restart_and_read_does_not_create_db(tmp_path):
    path = tmp_path / "usage.db"
    now = stamp("2026-10-09T12:00:05")
    empty = report(path, now=now)
    assert empty["ready"] is False and not path.exists()
    assert all(p["avg_compute"] is None for p in empty["periods"])
    assert UsageStore(path).record(sample(now))
    assert not UsageStore(path).record(sample(now + 1, 80))
    result = report(path, count=1, now=now + 2)
    assert result["summary"]["sample_count"] == 1
    assert result["summary"]["avg_compute"] == 40


def test_beijing_midnight_monday_boundary_weighted_summary_and_gaps(tmp_path):
    path = tmp_path / "usage.db"
    store = UsageStore(path)
    store.record(sample(stamp("2026-10-04T23:59:59"), 0, 0))
    store.record(sample(stamp("2026-10-05T00:00:01"), 80, 40))
    store.record(sample(stamp("2026-10-05T00:00:31"), 40, 20))
    now = stamp("2026-10-05T00:00:45")
    days = report(path, count=3, now=now)
    assert [p["sample_count"] for p in days["periods"]] == [0, 1, 2]
    assert [p["avg_compute"] for p in days["periods"]] == [None, 0, 60]
    assert days["summary"]["avg_compute"] == 40
    assert days["summary"]["peak_compute"] == 80
    assert days["summary"]["peak_memory_used_bytes"] == 320 * GIB
    assert days["summary"]["avg_memory_percent"] == 25
    assert days["periods"][-1]["coverage_percent"] == 100
    assert days["periods"][1]["coverage_percent"] == pytest.approx(100 / 2880)
    weeks = report(path, group="week", count=2, now=now)
    assert [p["label"] for p in weeks["periods"]] == ["2026-09-28", "2026-10-05"]
    assert [p["sample_count"] for p in weeks["periods"]] == [1, 2]
    historical = report(path, count=1, through="2026-10-04", now=now)
    assert historical["summary"]["avg_compute"] == 0
    assert historical["summary"]["expected_count"] == 2880
    assert report(path, now=now + 100)["stale"] is True


def test_retention_prunes_only_expired_samples(tmp_path):
    path = tmp_path / "usage.db"
    now = stamp("2026-10-09T12:00:00")
    store = UsageStore(path)
    for age in [401, 399, 0]:
        store.record(sample(now - age * 86400))
    with closing(sqlite3.connect(path)) as db:
        assert db.execute("SELECT COUNT(*) FROM samples").fetchone()[0] == 2


def test_api_auth_validation_empty_and_storage_failure(tmp_path):
    app = create_app(
        dict(
            database=str(tmp_path / "analytics.sqlite3"),
            username="test",
            password_hash=generate_password_hash("password"),
            origins=["https://gaasd.com"],
            status_directory=str(tmp_path),
        )
    )
    client, auth = app.test_client(), ("test", "password")
    for endpoint in ["/status/api/gpu-usage", "/status/assets/status-gpu-usage.js"]:
        assert client.get(endpoint).status_code == 401
        response = client.get(endpoint, auth=auth)
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "no-store"
    assert not (tmp_path / "intranet").exists()
    for query in [
        "group=month",
        "count=0",
        "count=91",
        "group=week&count=53",
        "count=1.5",
        "through=2026-1-01",
        "through=2099-01-01",
        "through=2026-02-30",
        "through=0001-01-01",
    ]:
        assert client.get("/status/api/gpu-usage?" + query, auth=auth).status_code == 400
    (tmp_path / "intranet").mkdir()
    (tmp_path / "intranet/gpu-usage.sqlite3").write_text("corrupt")
    assert client.get("/status/api/gpu-usage", auth=auth).status_code == 503


def test_usage_storage_failure_keeps_successful_live_snapshot(monkeypatch, tmp_path):
    data = sample(stamp("2026-10-09T12:00:00"))
    monkeypatch.setattr("status_remote.fetch_snapshot", lambda _: data)
    sampler = Sampler(tmp_path)
    monkeypatch.setattr(sampler, "publish", lambda d: None)
    usage = UsageStore(tmp_path / "usage.db")

    def fail(_):
        raise sqlite3.OperationalError("disk full")

    monkeypatch.setattr(usage, "record", fail)
    assert poll(sampler, {}, usage)
    assert json.loads((tmp_path / "connection.json").read_text())["ok"] is True


def test_daily_backup_includes_wal_samples_and_retains_14_copies(tmp_path):
    with closing(sqlite3.connect(tmp_path / "analytics.sqlite3")) as db:
        db.execute("CREATE TABLE visits(id)")
    path = tmp_path / "status/intranet/gpu-usage.sqlite3"
    UsageStore(path).record(sample(stamp("2026-10-09T12:00:00")))
    backups = tmp_path / "backups"
    backups.mkdir()
    for i in range(20, 0, -1):
        day = datetime.now() - timedelta(days=i)
        for prefix in ["analytics", "gpu-usage"]:
            (backups / f"{prefix}-{day:%Y%m%d}.sqlite3").touch()
    with closing(sqlite3.connect(path)) as writer:
        writer.execute("INSERT INTO samples VALUES (1,1,0,0,100)")
        writer.commit()
        daily_backup(tmp_path)
    copies = sorted(backups.glob("gpu-usage-*.sqlite3"))
    assert len(copies) == 14
    assert len(list(backups.glob("analytics-*.sqlite3"))) == 14
    with closing(sqlite3.connect(copies[-1])) as db:
        assert db.execute("SELECT COUNT(*) FROM samples").fetchone()[0] == 2


def test_full_backup_snapshots_gpu_db_without_copying_live_wal(monkeypatch, tmp_path):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "scripts"))
    from backup_server import copy_status

    source = tmp_path / "source"
    path = source / "intranet/gpu-usage.sqlite3"
    UsageStore(path).record(sample(stamp("2026-10-09T12:00:00")))
    (source / "latest.json").write_text('{"cpu": 10}')
    with closing(sqlite3.connect(path)) as writer:
        writer.execute("INSERT INTO samples VALUES (1,1,0,0,100)")
        writer.commit()
        result = copy_status(source, tmp_path / "target")
    assert result == dict(integrity="ok", samples=2)
    assert (tmp_path / "target/latest.json").read_text() == '{"cpu": 10}'
    assert list((tmp_path / "target").rglob("*-wal")) == []
    assert list((tmp_path / "target").rglob("*-shm")) == []
