"""Capture the deployed GAASD website and a consistent SQLite snapshot without stopping services."""

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from backup_common import create_archive, digest

BASE = Path("/var/backups/gaasd-web/full")


def copy(source, destination):
    source, destination = Path(source), Path(destination)
    if not source.exists():
        raise FileNotFoundError(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir():
        shutil.copytree(
            source,
            destination,
            symlinks=True,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
    else:
        shutil.copy2(source, destination)


def command(args):
    return subprocess.check_output(args, text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release_id")
    args = parser.parse_args()
    if not re.fullmatch(r"\d{8}T\d{6}", args.release_id):
        raise ValueError("Use YYYYMMDDTHHMMSS")
    if os.geteuid() != 0:
        raise PermissionError("Run with sudo to include private configuration and certificates")
    os.umask(0o077)
    destination = BASE / args.release_id
    destination.mkdir(parents=True, exist_ok=False)
    BASE.chmod(0o700)
    stage = destination / ".runtime-stage"
    stage.mkdir(mode=0o700)
    public = Path("/var/www/gaasd-test/public").resolve(strict=True)
    backend = Path("/opt/gaasd-analytics/current").resolve(strict=True)
    if not public.is_relative_to("/var/www/gaasd-test/releases") or not backend.is_relative_to(
        "/opt/gaasd-analytics/releases"
    ):
        raise ValueError("Unexpected deployment paths")
    print("Copying the active frontend, backend and private configuration...", flush=True)
    copy(public, stage / "public")
    copy(backend, stage / "backend")
    for source in [
        "/etc/gaasd-analytics",
        "/etc/letsencrypt",
        "/etc/nginx/nginx.conf",
        "/etc/nginx/mime.types",
        "/etc/nginx/conf.d",
        "/etc/nginx/sites-available/gaasd-test",
        "/etc/nginx/sites-available/platform-relay",
        "/etc/nginx/snippets/gaasd-analytics.conf",
        "/etc/nginx/snippets/gaasd-test-preview.conf",
        "/etc/logrotate.d/nginx",
        "/etc/systemd/system/gaasd-analytics.service",
        "/etc/systemd/system/gaasd-status-collector.service",
        "/etc/systemd/system/gaasd-analytics-backup.service",
        "/etc/systemd/system/gaasd-analytics-backup.timer",
    ]:
        copy(source, stage / source.lstrip("/"))
    data = stage / "data"
    data.mkdir(mode=0o700)
    snapshot = data / "analytics.sqlite3"
    with (
        sqlite3.connect(
            "file:/var/lib/gaasd-analytics/analytics.sqlite3?mode=ro", uri=True
        ) as live,
        sqlite3.connect(snapshot) as out,
    ):
        live.backup(out)
        integrity = out.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError("SQLite backup failed integrity_check")
        counts = {
            table: out.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("visits", "plays", "legacy_media", "meta")
        }
    snapshot.chmod(0o600)
    copy("/var/lib/gaasd-analytics/status", data / "status")
    copy("/var/lib/gaasd-analytics/backups", data / "daily-backups")
    for p in (data / "status").glob("*.json"):
        json.loads(p.read_text())
    logs = stage / "logs/nginx"
    logs.mkdir(parents=True, mode=0o700)
    for p in Path("/var/log/nginx").glob("gaasd-test.*"):
        if p.is_file():
            copy(p, logs / p.name)
    inventory = stage / "inventory"
    inventory.mkdir()
    for name, cmd in {
        "pip-freeze.txt": ["/opt/gaasd-analytics/venv/bin/pip", "freeze"],
        "services.txt": [
            "systemctl",
            "cat",
            "gaasd-analytics.service",
            "gaasd-status-collector.service",
            "gaasd-analytics-backup.service",
            "gaasd-analytics-backup.timer",
            "certbot.timer",
        ],
        "timers.txt": ["systemctl", "list-timers", "--all", "--no-pager"],
        "nginx-test.txt": ["nginx", "-t"],
    }.items():
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        (inventory / name).write_text(result.stdout + result.stderr)
    (inventory / "nginx-enabled.json").write_text(
        json.dumps(
            {
                p.name: os.readlink(p) if p.is_symlink() else "regular file"
                for p in Path("/etc/nginx/sites-enabled").iterdir()
            },
            indent=2,
        )
    )
    (inventory / "operating-system.txt").write_text(
        Path("/etc/os-release").read_text() + "\n" + command(["uname", "-a"])
    )
    metadata = {
        "kind": "GAASD server runtime and private data",
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "frontend_release": str(public),
        "backend_release": str(backend),
        "sqlite_integrity": integrity,
        "database_rows": counts,
        "frontend_manifest_sha256": digest(public / "asset-manifest.json"),
        "sensitive": "Includes administrator credentials, IP analytics, ACME account keys and TLS private keys. Keep outside public web roots.",
        "consistency": "SQLite online backup API; immutable deployment copies; status and log files copied while services continue running.",
        "excluded": "Other application source/data, SSH keys, OS image, package binaries, old deployment releases and temporary upload archives.",
    }
    (stage / "runtime-info.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2))
    files = {
        "runtime/" + p.relative_to(stage).as_posix(): p
        for p in stage.rglob("*")
        if p.is_file() or p.is_symlink()
    }
    archive = destination / f"GAASD-Runtime-{args.release_id}.tar.gz"
    print(f"Archiving and verifying {len(files)} runtime entries...", flush=True)
    result = create_archive(archive, files, metadata)
    (destination / "runtime-receipt.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2)
    )
    # Only remove the exact staging directory created by this invocation.
    if stage.resolve().parent != destination.resolve() or stage.name != ".runtime-stage":
        raise ValueError("Unexpected staging cleanup path")
    shutil.rmtree(stage)
    print(
        json.dumps({"directory": str(destination), **result}, ensure_ascii=False, indent=2),
        flush=True,
    )


if __name__ == "__main__":
    main()
