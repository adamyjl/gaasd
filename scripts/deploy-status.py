"""Root-only backend overlay deployment; preserves frontend, database and credentials.

First provision the restricted SSH probe as documented in STATUS.md. Upload the
build-status-release archive to /tmp, then run: sudo python3 deploy-status.py ID.
The retained backend release and deployment record provide a rollback target.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True)


def activate(link, target):
    temporary = link.with_name(link.name + "-status-next")
    if temporary.is_symlink():
        temporary.unlink()
    temporary.symlink_to(target, target_is_directory=True)
    os.replace(temporary, link)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release_id")
    parser.add_argument(
        "--allow-unavailable",
        action="append",
        default=[],
        choices=["office", "windows", "rtx4090", "rtx5090"],
        help="Explicitly record an already unavailable old host; new PRO 6000 remains mandatory",
    )
    args = parser.parse_args()
    release_id = args.release_id
    if os.geteuid() != 0 or not re.fullmatch(r"\d{8}T\d{6}", release_id):
        raise SystemExit("Root and YYYYMMDDTHHMMSS release identifier required")
    root = Path("/opt/gaasd-analytics")
    current = root / "current"
    previous = current.resolve(strict=True)
    if previous.parent != root / "releases":
        raise SystemExit("Unexpected backend location")
    if not Path("/etc/gaasd-analytics/status-remote.json").is_file():
        raise SystemExit("Provision restricted internal SSH collection first")
    if not Path("/etc/gaasd-analytics/fleet.json").is_file():
        raise SystemExit("Provision the restricted fleet endpoints first")
    unavailable = set(args.allow_unavailable)
    baseline = {}
    for host in unavailable:
        folder = Path("/var/lib/gaasd-analytics/status") / host
        sample = json.loads((folder / "latest.json").read_text())
        connection = json.loads((folder / "connection.json").read_text())
        # An exception is only allowed when an existing collector already recorded
        # a failed connection and the retained snapshot predates this deployment.
        if connection.get("ok") is not False or time.time() - sample["generated_at"] < 90:
            raise SystemExit(f"{host} is not a proven pre-existing outage")
        baseline[host] = dict(sample_time=sample["generated_at"], connection=connection)
    frontend = Path("/var/www/gaasd-test/public").resolve(strict=True)
    expected = {
        "app.py",
        "backup.py",
        "gpu_usage.py",
        "status_collector.py",
        "gpu_metrics.py",
        "status_remote.py",
        "status_probe.py",
        "fleet.py",
        "fleet_probe.py",
        "fleet_collector.py",
        "ui/status.html",
        "ui/status.css",
        "ui/status.js",
        "ui/status-gpu-usage.js",
        "ui/fleet.html",
        "ui/fleet.js",
        "ui/fleet.css",
    }
    stage = Path(f"/tmp/gaasd-status-stage-{release_id}")
    stage.mkdir(mode=0o700)
    with tarfile.open(f"/tmp/gaasd-status-{release_id}.tar") as bundle:
        for member in bundle.getmembers():
            name = member.name.removeprefix("./")
            if member.isdir() and name in {".", "", "ui"}:
                continue
            if not member.isfile() or name not in expected | {"manifest.json"}:
                raise RuntimeError("Unexpected archive entry")
        bundle.extractall(stage, filter="data")
    manifest = json.loads((stage / "manifest.json").read_text())
    if set(manifest) != expected:
        raise RuntimeError("Unexpected release manifest")
    for name, digest in manifest.items():
        if hashlib.sha256((stage / name).read_bytes()).hexdigest() != digest:
            raise RuntimeError(f"Checksum failed: {name}")
    release = root / "releases" / release_id
    backup = Path(f"/var/backups/gaasd-status-{release_id}")
    backup.mkdir(mode=0o700)
    service = Path("/etc/systemd/system/gaasd-status-intranet.service")
    previous_unit = service.read_bytes() if service.exists() else None
    fleet_service = Path("/etc/systemd/system/gaasd-status-fleet.service")
    previous_fleet_unit = fleet_service.read_bytes() if fleet_service.exists() else None
    fleet_was_enabled = (
        subprocess.run(
            ["systemctl", "is-enabled", fleet_service.name], capture_output=True
        ).returncode
        == 0
    )
    was_enabled = (
        subprocess.run(["systemctl", "is-enabled", service.name], capture_output=True).returncode
        == 0
    )
    record = dict(
        previous_backend=str(previous),
        frontend=str(frontend),
        release=str(release),
        remote_service_previously_enabled=was_enabled,
        manifest=manifest,
        preexisting_unavailable=baseline,
    )
    (backup / "deployment.json").write_text(json.dumps(record, indent=2))
    if previous_unit is not None:
        (backup / service.name).write_bytes(previous_unit)
    if previous_fleet_unit is not None:
        (backup / fleet_service.name).write_bytes(previous_fleet_unit)
    # Previous release is retained intact; only the selected source files change.
    shutil.copytree(previous, release, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for name in expected:
        shutil.copyfile(stage / name, release / name)
        (release / name).chmod(0o644)
    run(str(root / "venv/bin/python"), "-m", "compileall", "-q", str(release))
    activated = False
    try:
        service.write_text("""[Unit]
Description=GAASD internal server read-only status collector
After=network-online.target openvpn-client@platform.service
Wants=network-online.target

[Service]
Type=simple
User=gaasd-analytics
Group=gaasd-analytics
WorkingDirectory=/opt/gaasd-analytics/current
ExecStart=/opt/gaasd-analytics/venv/bin/python /opt/gaasd-analytics/current/status_remote.py
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/gaasd-analytics/status/intranet
CapabilityBoundingSet=
RestrictSUIDSGID=true
MemoryMax=192M
CPUQuota=20%

[Install]
WantedBy=multi-user.target
""")
        service.chmod(0o644)
        fleet_service.write_text("""[Unit]
Description=GAASD fleet monitoring and GPU history
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=gaasd-analytics
Group=gaasd-analytics
WorkingDirectory=/opt/gaasd-analytics/current
ExecStart=/opt/gaasd-analytics/venv/bin/python /opt/gaasd-analytics/current/fleet_collector.py
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/gaasd-analytics/status
CapabilityBoundingSet=
RestrictSUIDSGID=true
MemoryMax=256M
CPUQuota=40%

[Install]
WantedBy=multi-user.target
""")
        fleet_service.chmod(0o644)
        activate(current, release)
        activated = True
        run("systemctl", "daemon-reload")
        run("systemctl", "restart", "gaasd-analytics", "gaasd-status-collector")
        run("systemctl", "enable", "--now", service.name)
        run("systemctl", "restart", service.name)
        run("systemctl", "enable", "--now", fleet_service.name)
        run("systemctl", "restart", fleet_service.name)
        for attempt in range(30):
            try:
                with urllib.request.urlopen(
                    "http://127.0.0.1:4180/internal/health", timeout=3
                ) as response:
                    assert response.status == 200
                data = []
                for suffix in ["", "intranet/"]:
                    file = Path("/var/lib/gaasd-analytics/status") / suffix / "latest.json"
                    snapshot = json.loads(file.read_text())
                    assert snapshot["interval_seconds"] == 30
                    assert snapshot["generated_at"] > started
                    assert snapshot["cpu"]["percent"] is not None
                    data.append(snapshot)
                assert len(data[1]["gpu"]["devices"]) == 8
                connection = json.loads(
                    Path("/var/lib/gaasd-analytics/status/intranet/connection.json").read_text()
                )
                assert connection["ok"] is True
                with sqlite3.connect(
                    "file:/var/lib/gaasd-analytics/status/intranet/gpu-usage.sqlite3?mode=ro",
                    uri=True,
                ) as db:
                    assert db.execute("SELECT MAX(timestamp) FROM samples").fetchone()[0] > started
                for host, expected_gpus in [
                    ("office", 1),
                    ("windows", 1),
                    ("rtx5090", 8),
                    ("rtx4090", 8),
                    ("pro6000", 1),
                ]:
                    folder = Path("/var/lib/gaasd-analytics/status") / host
                    sample = json.loads((folder / "latest.json").read_text())
                    connection = json.loads((folder / "connection.json").read_text())
                    if host in unavailable and not connection.get("ok"):
                        assert connection["checked_at"] > started
                        assert sample["generated_at"] == baseline[host]["sample_time"]
                        continue
                    assert time.time() - sample["generated_at"] < 90
                    assert sample["cpu"]["percent"] is not None
                    assert len(sample["gpu"]["devices"]) == expected_gpus
                    assert connection["ok"] and connection["checked_at"] > started
                    if expected_gpus == 8:
                        with sqlite3.connect(
                            f"file:{folder}/gpu-usage.sqlite3?mode=ro", uri=True
                        ) as db:
                            assert (
                                db.execute("SELECT MAX(timestamp) FROM samples").fetchone()[0]
                                > started - 30
                            )
                break
            except (AssertionError, OSError, ValueError, KeyError, sqlite3.Error) as error:
                if attempt == 29:
                    raise RuntimeError("New collector health checks failed") from error
                time.sleep(2)
        assert Path("/var/www/gaasd-test/public").resolve() == frontend
        record.update(
            verified_at=time.time(),
            cloud_cores=len(data[0]["cpu"]["cores"]),
            internal_cores=len(data[1]["cpu"]["cores"]),
            gpus=len(data[1]["gpu"]["devices"]),
        )
        (backup / "deployment.json").write_text(json.dumps(record, indent=2))
        print(json.dumps(record, indent=2))
    except BaseException:
        if activated:
            run("systemctl", "stop", fleet_service.name)
            run("systemctl", "stop", service.name)
            activate(current, previous)
        if previous_unit is None:
            subprocess.run(["systemctl", "disable", service.name], capture_output=True)
            service.unlink(missing_ok=True)
        else:
            service.write_bytes(previous_unit)
        if previous_fleet_unit is None:
            subprocess.run(["systemctl", "disable", fleet_service.name], capture_output=True)
            fleet_service.unlink(missing_ok=True)
        else:
            fleet_service.write_bytes(previous_fleet_unit)
        run("systemctl", "daemon-reload")
        run("systemctl", "restart", "gaasd-analytics", "gaasd-status-collector")
        if previous_unit is not None and was_enabled:
            run("systemctl", "start", service.name)
        if previous_fleet_unit is not None and fleet_was_enabled:
            run("systemctl", "start", fleet_service.name)
        print("Restored previous backend and service configuration", file=sys.stderr)
        raise


if __name__ == "__main__":
    started = time.time()
    main()
