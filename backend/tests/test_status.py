import json
import time

import pytest
from app import create_app
from status_collector import Sampler, atomic_json, cpu_usage, filesystem_rows, parse_mounts, rate
from werkzeug.security import generate_password_hash

AUTH = ("admin", "test-password-only")


@pytest.fixture
def status_client(tmp_path):
    app = create_app(
        dict(
            database=str(tmp_path / "data.sqlite3"),
            username=AUTH[0],
            password_hash=generate_password_hash(AUTH[1]),
            origins=["https://gaasd.com"],
            status_directory=str(tmp_path),
        )
    )
    return app.test_client(), tmp_path


@pytest.mark.parametrize(
    "path",
    [
        "/status",
        "/status/",
        "/status/assets/status.js",
        "/status/assets/status.css",
        "/status/assets/dashboard.css",
        "/status/api/snapshot",
        "/status/api/history",
    ],
)
def test_status_uses_existing_admin_authentication(status_client, path):
    client, directory = status_client
    for filename in ["latest.json", "history.json"]:
        atomic_json(directory / filename, dict(generated_at=time.time(), points=[]))
    response = client.get(path)
    assert response.status_code == 401
    assert (
        response.headers["WWW-Authenticate"]
        == client.get("/statistics").headers["WWW-Authenticate"]
    )
    assert client.get(path, auth=("admin", "wrong")).status_code == 401
    response = client.get(path, auth=AUTH)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
    assert "noindex" in response.headers["X-Robots-Tag"]


def test_missing_corrupt_and_stale_snapshot_are_not_presented_as_live(status_client):
    client, directory = status_client
    assert client.get("/status/api/snapshot", auth=AUTH).status_code == 503
    (directory / "latest.json").write_text("broken")
    assert client.get("/status/api/snapshot", auth=AUTH).status_code == 503
    atomic_json(directory / "latest.json", dict(generated_at=time.time() - 60, cpu={"percent": 17}))
    data = client.get("/status/api/snapshot", auth=AUTH).json
    assert data["stale"] is True
    assert data["age_seconds"] >= 59
    assert data["cpu"]["percent"] == 17
    assert client.get("/status/assets/app.py", auth=AUTH).status_code == 404


def test_cpu_delta_does_not_double_count_guest_and_separates_iowait():
    old = dict(user=100, system=100, idle=100, iowait=100, guest=50)
    new = dict(user=120, system=110, idle=140, iowait=120, guest=60, steal=10)
    result = cpu_usage(new, {**old, "steal": 0})
    assert result == dict(percent=40, iowait=20, steal=10)
    assert cpu_usage(new, None) is None
    assert cpu_usage(new, new) is None


def test_counter_reset_and_initial_sample_are_unknown():
    assert rate(100, None, 5) is None
    assert rate(100, 200, 5) is None
    assert rate(100, 90, 0) is None
    assert rate(100, 90, 5) == 2


def test_history_survives_restart_and_expires_old_points(tmp_path):
    now = time.time()
    atomic_json(
        tmp_path / "history.json",
        dict(
            generated_at=now,
            points=[dict(timestamp=now - 90000, cpu=10), dict(timestamp=now - 60, cpu=20)],
        ),
    )
    sampler = Sampler(tmp_path)
    assert len(sampler.history) == 1
    assert sampler.history[0]["cpu"] == 20
    assert json.loads((tmp_path / "history.json").read_text())["generated_at"] == now


def test_host_mount_parser_handles_escaped_paths():
    mounts = parse_mounts("/dev/vda2 / ext4 rw 0 0\nserver:/data /remote\\040files nfs4 rw 0 0")
    assert [mount.mountpoint for mount in mounts] == ["/", "/remote files"]
    assert mounts[1].fstype == "nfs4"


def test_remote_capacity_is_not_probed_and_fuse_control_is_excluded(monkeypatch):
    monkeypatch.setattr(
        "status_collector.host_partitions",
        lambda: parse_mounts(
            "cosfs /lhcos-data fuse.cosfs rw 0 0\nfusectl /sys/fs/fuse/connections fusectl rw 0 0"
        ),
    )

    def no_probe(_path):
        raise AssertionError("Do not stat a remote filesystem")

    monkeypatch.setattr("status_collector.psutil.disk_usage", no_probe)
    rows = filesystem_rows()
    assert len(rows) == 1
    assert rows[0]["mount"] == "/lhcos-data"
    assert rows[0]["kind"] == "remote"
    assert "total" not in rows[0]
