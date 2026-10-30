import json
import subprocess
import time
from types import SimpleNamespace

import pytest
from app import create_app
from fleet import HOSTS, TARGETS, overview, read_cached
from fleet_collector import fetch_snapshot, poll
from gpu_usage import UsageStore
from status_collector import Sampler, atomic_json
from werkzeug.security import generate_password_hash

AUTH = ("fleet-test", "test-only")


@pytest.fixture
def fleet(tmp_path):
    app = create_app(
        dict(
            database=str(tmp_path / "db.sqlite3"),
            username=AUTH[0],
            password_hash=generate_password_hash(AUTH[1]),
            origins=["https://gaasd.com"],
            status_directory=str(tmp_path),
        )
    )
    for index, (name, host) in enumerate(HOSTS.items()):
        directory = tmp_path if name == "cloud" else tmp_path / name
        directory.mkdir(exist_ok=True)
        snapshot = dict(
            generated_at=time.time(),
            host={"name": name},
            cpu={"percent": index * 10},
            memory={"percent": 10},
            swap={"percent": 0},
            network=[],
            filesystems=[],
            processes={},
            gpu={
                "available": True,
                "devices": [
                    dict(
                        index=i, utilization_percent=index * 10, memory_used=100, memory_total=1000
                    )
                    for i in range(host["expected_gpus"])
                ],
            },
        )
        atomic_json(directory / "latest.json", snapshot)
        atomic_json(
            directory / "history.json",
            dict(generated_at=time.time(), points=[{"server": name, "timestamp": time.time()}]),
        )
        if host["expected_gpus"] == 8:
            UsageStore(directory / "gpu-usage.sqlite3").record(snapshot)
    return app.test_client(), tmp_path


@pytest.mark.parametrize(
    "url",
    [
        "/status1",
        "/status3",
        "/status4",
        "/status5",
        "/status5/",
        "/status5/api/snapshot",
        "/status5/api/history",
        "/status5?server=pro6000-02",
        "/status5/api/snapshot?server=pro6000-02",
        "/status5/api/history?server=pro6000-02",
        "/status1/host?server=office",
        "/status1/api/overview",
        "/status3/api/snapshot",
        "/status3/api/history",
        "/status4/api/snapshot",
        "/status4/api/history",
        "/status4/api/gpu-usage",
        "/status/assets/fleet.js",
        "/status/assets/fleet.css",
    ],
)
def test_all_fleet_resources_share_existing_auth(fleet, url):
    client, _ = fleet
    denied = client.get(url)
    assert denied.status_code == 401
    assert "GAASD Statistics" in denied.headers["WWW-Authenticate"]
    assert client.get(url, auth=("fleet-test", "wrong")).status_code == 401
    response = client.get(url, auth=AUTH)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert "noindex" in response.headers["X-Robots-Tag"]
    assert client.post(url, auth=AUTH).status_code == 405


def test_histories_gpu_databases_and_choices_are_isolated(fleet):
    client, _ = fleet
    for name, prefix in [
        ("windows", "status3"),
        ("rtx5090", "status4"),
        ("rtx4090", "status4"),
        ("pro6000", "status5"),
        ("pro6000-02", "status5"),
    ]:
        data = client.get(f"/{prefix}/api/snapshot?server={name}", auth=AUTH).json
        assert data["host"]["name"] == name
        history = client.get(f"/{prefix}/api/history?server={name}", auth=AUTH).json
        assert history["points"][0]["server"] == name
    reports = [
        client.get(f"/status4/api/gpu-usage?server={name}", auth=AUTH).json
        for name in ("rtx4090", "rtx5090", "intranet")
    ]
    assert len({row["summary"]["avg_compute"] for row in reports}) == 3
    for page, included, excluded in [
        ("/status3", 'value="windows"', 'value="rtx4090"'),
        ("/status4", 'value="rtx4090"', 'value="windows"'),
        ("/status5", 'value="pro6000"', 'value="windows"'),
        ("/status5", 'value="pro6000-02"', 'value="windows"'),
    ]:
        html = client.get(page, auth=AUTH).text
        assert included in html and excluded not in html


@pytest.mark.parametrize("server", ["../rtx4090", "/etc", "https://example.com", "unknown", ""])
def test_request_cannot_select_paths_or_ssh_hosts(fleet, server):
    client, _ = fleet
    assert (
        client.get("/status4/api/snapshot", query_string={"server": server}, auth=AUTH).status_code
        == 400
    )
    assert (
        client.get("/status4/api/gpu-usage", query_string={"server": server}, auth=AUTH).status_code
        == 400
    )


def test_missing_offline_and_stale_hosts_are_not_fabricated(fleet):
    client, root = fleet
    (root / "windows/latest.json").unlink()
    atomic_json(root / "rtx4090/connection.json", dict(ok=False, checked_at=time.time()))
    old = json.loads((root / "rtx5090/latest.json").read_text())
    old["generated_at"] = time.time() - 120
    atomic_json(root / "rtx5090/latest.json", old)
    hosts = {
        host["server"]["id"]: host
        for host in client.get("/status1/api/overview", auth=AUTH).json["hosts"]
    }
    assert len(hosts) == len(HOSTS)
    assert hosts["windows"]["unavailable"]
    assert hosts["rtx4090"]["stale"] and hosts["rtx5090"]["stale"]
    assert not hosts["cloud"]["stale"]
    assert hosts["rtx4090"]["host"]["name"] == "rtx4090"


def test_pro6000_default_and_offline_state(fleet):
    client, root = fleet
    sample = client.get("/status5/api/snapshot", auth=AUTH).json
    assert sample["server"]["id"] == "pro6000"
    assert len(sample["gpu"]["devices"]) == 1
    assert client.get("/status5/api/history", auth=AUTH).json["points"][0]["server"] == "pro6000"
    (root / "pro6000/latest.json").unlink()
    assert client.get("/status5/api/snapshot", auth=AUTH).status_code == 503
    hosts = client.get("/status1/api/overview", auth=AUTH).json["hosts"]
    assert next(host for host in hosts if host["server"]["id"] == "pro6000")["unavailable"]
    second = client.get("/status5/api/snapshot?server=pro6000-02", auth=AUTH).json
    assert second["server"]["id"] == "pro6000-02"
    assert second["server"]["group"] == "开发机器"
    assert not second["stale"]
    assert TARGETS["pro6000"][-1] == 2226
    assert TARGETS["pro6000-02"][-1] == 2227
    assert len({host["server"]["href"] for host in hosts}) == len(hosts)


@pytest.mark.parametrize("stamp", [float("nan"), float("inf"), True, 0, "now"])
def test_invalid_timestamps_cannot_look_online(fleet, stamp):
    _, root = fleet
    (root / "windows/latest.json").write_text(json.dumps(dict(generated_at=stamp)))
    with pytest.raises(ValueError):
        read_cached(root, "windows")
    assert next(host for host in overview(root)["hosts"] if host["server"]["id"] == "windows")[
        "unavailable"
    ]


def test_failure_preserves_snapshot_and_does_not_add_zero_gpu_sample(fleet, monkeypatch):
    _, root = fleet
    before = (root / "rtx4090/latest.json").read_bytes()
    monkeypatch.setattr(
        "fleet_collector.fetch_snapshot",
        lambda *_: (_ for _ in ()).throw(subprocess.TimeoutExpired("ssh", 26)),
    )
    assert not poll("rtx4090", Sampler(root / "rtx4090"), {})
    assert (root / "rtx4090/latest.json").read_bytes() == before
    assert not json.loads((root / "rtx4090/connection.json").read_text(encoding="utf-8"))["ok"]


@pytest.mark.parametrize("name", list(TARGETS))
def test_only_fixed_targets_and_forced_snapshot_command(name, monkeypatch):
    def run(command, **options):
        user, host, port = TARGETS[name]
        assert command[-4:] == ["-p", str(port), f"{user}@{host}", "snapshot"]
        assert "StrictHostKeyChecking=yes" in command and "shell" not in options
        assert options["timeout"] == 26
        return SimpleNamespace(
            stdout=json.dumps(
                dict(
                    generated_at=time.time(),
                    host={},
                    cpu={},
                    memory={},
                    swap={},
                    filesystems=[],
                    network=[],
                    processes={},
                    gpu={},
                )
            )
        )

    monkeypatch.setattr("fleet_collector.subprocess.run", run)
    assert (
        "collection_ms"
        in fetch_snapshot(name, dict(known_hosts="known", identity_file="key"))["latency"]
    )
