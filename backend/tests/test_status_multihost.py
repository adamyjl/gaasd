import json
import subprocess
import time
from types import SimpleNamespace

import pytest
from app import create_app
from gpu_metrics import collect_gpus, numeric, parse_gpus
from status_collector import INTERVAL, Sampler, atomic_json
from status_probe import main as probe_main
from status_remote import fetch_snapshot, poll
from werkzeug.security import generate_password_hash

AUTH = ("admin", "test-only")


@pytest.fixture
def hosts(tmp_path):
    app = create_app(
        dict(
            database=str(tmp_path / "data.sqlite3"),
            username=AUTH[0],
            password_hash=generate_password_hash(AUTH[1]),
            origins=["https://gaasd.com"],
            status_directory=str(tmp_path),
        )
    )
    (tmp_path / "intranet").mkdir()
    for name, directory in [("cloud", tmp_path), ("intranet", tmp_path / "intranet")]:
        atomic_json(directory / "latest.json", dict(generated_at=time.time(), host={"name": name}))
        atomic_json(
            directory / "history.json", dict(generated_at=time.time(), points=[{"server": name}])
        )
    return app.test_client(), tmp_path


def test_hosts_are_authenticated_and_use_separate_snapshots_and_history(hosts):
    client, _ = hosts
    for server in ["cloud", "intranet"]:
        for resource in ["snapshot", "history"]:
            url = f"/status/api/{resource}?server={server}"
            assert client.get(url).status_code == 401
            response = client.get(url, auth=AUTH)
            assert response.status_code == 200
            assert response.json["server"]["id"] == server
            assert response.json["stale"] is False
            if resource == "snapshot":
                assert response.json["host"]["name"] == server
            else:
                assert response.json["points"][0]["server"] == server
    assert client.get("/status/api/snapshot", auth=AUTH).json["server"]["id"] == "cloud"


@pytest.mark.parametrize("server", ["../../etc", "/etc", "https://example.com", "unknown", ""])
def test_unlisted_hosts_cannot_become_paths_or_remote_targets(hosts, server):
    client, _ = hosts
    assert (
        client.get("/status/api/snapshot", query_string={"server": server}, auth=AUTH).status_code
        == 400
    )


def test_offline_internal_host_does_not_fall_back_to_cloud(hosts):
    client, directory = hosts
    atomic_json(directory / "intranet" / "connection.json", dict(ok=False, message="连接中断"))
    data = client.get("/status/api/snapshot?server=intranet", auth=AUTH).json
    assert data["stale"] is True
    assert data["host"]["name"] == "intranet"
    assert data["connection"]["message"] == "连接中断"
    assert client.get("/status/api/snapshot?server=cloud", auth=AUTH).json["stale"] is False
    (directory / "intranet" / "latest.json").unlink()
    assert client.get("/status/api/snapshot?server=intranet", auth=AUTH).status_code == 503


def test_thirty_second_samples_have_a_sensible_stale_threshold(hosts):
    client, directory = hosts
    assert INTERVAL == 30
    for age, stale in [(31, False), (91, True)]:
        atomic_json(directory / "latest.json", dict(generated_at=time.time() - age))
        assert client.get("/status/api/snapshot", auth=AUTH).json["stale"] is stale


def test_gpu_csv_preserves_unknown_values_and_real_free_memory():
    devices = parse_gpus(
        "0, GPU-test, NVIDIA A100-SXM4-80GB, PCI, 550, 0, 3, 81920, 4837, 76201, 40, 52.84, 400, [N/A], P0"
    )
    assert devices[0]["fan_percent"] is None
    assert devices[0]["utilization_percent"] == 0
    assert devices[0]["memory_free"] == 76201 * 1024**2
    assert devices[0]["power_w"] == 52.84
    assert numeric("NaN") is None
    assert numeric("-1") is None
    with pytest.raises(ValueError):
        parse_gpus("unexpected response")


def test_gpu_failures_are_not_fabricated_zero_utilization(monkeypatch):
    def fail(*_):
        raise subprocess.TimeoutExpired("nvidia-smi", 5)

    monkeypatch.setattr("gpu_metrics.query", fail)
    gpu = collect_gpus()
    assert not gpu["available"]
    assert gpu["devices"] == []
    assert gpu["expected_count"] == 8


def test_failed_poll_preserves_last_good_sample_and_marks_connection(tmp_path, monkeypatch):
    sampler = Sampler(tmp_path, profile="intranet")
    old = dict(generated_at=time.time() - 30, host={"name": "internal"})
    atomic_json(tmp_path / "latest.json", old)

    def fail(_):
        raise subprocess.TimeoutExpired("ssh", 22)

    monkeypatch.setattr("status_remote.fetch_snapshot", fail)
    assert poll(sampler, {}) is False
    assert json.loads((tmp_path / "latest.json").read_text()) == old
    assert json.loads((tmp_path / "connection.json").read_text(encoding="utf-8"))["ok"] is False


def test_remote_probe_rejects_arbitrary_commands(monkeypatch):
    monkeypatch.setenv("SSH_ORIGINAL_COMMAND", "id; cat /etc/passwd")
    with pytest.raises(SystemExit, match="Only the status"):
        probe_main()


def test_ssh_uses_fixed_destination_and_strict_host_key_checking(monkeypatch):
    def run(command, **options):
        assert command[-4:] == ["-p", "2202", "aiusr@192.168.2.201", "snapshot"]
        assert "StrictHostKeyChecking=yes" in command
        assert options["timeout"] == 22
        assert "shell" not in options
        return SimpleNamespace(
            stdout=json.dumps(
                dict(
                    generated_at=time.time(),
                    host={},
                    cpu={},
                    memory={},
                    swap={},
                    network=[],
                    gpu={},
                    filesystems=[],
                )
            )
        )

    monkeypatch.setattr("status_remote.subprocess.run", run)
    fetch_snapshot(dict(known_hosts="/test/known_hosts", identity_file="/test/key"))
