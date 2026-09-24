"""Deploy analytics to the existing Tencent host without replacing its other services."""

import atexit
import hashlib
import json
import os
import pwd
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

release_id = sys.argv[1]
if not re.fullmatch(r"\d{8}T\d{6}", release_id):
    raise SystemExit("Invalid release identifier")
site = Path("/var/www/gaasd-test")
if site.resolve() != site or not (site / "public").is_dir():
    raise SystemExit("Expected the existing GAASD website")
stage = Path(f"/tmp/gaasd-analytics-stage-{release_id}")
stage.mkdir()
archive = Path(f"/tmp/gaasd-analytics-{release_id}.tar")
with tarfile.open(archive) as bundle:
    bundle.extractall(stage, filter="data")


def verify(directory, manifest_name):
    manifest = json.loads((directory / manifest_name).read_text())
    for relative, expected in manifest.items():
        filename = (directory / relative).resolve()
        if not filename.is_relative_to(directory.resolve()):
            raise RuntimeError("Invalid release path")
        content = filename.read_bytes()
        if (
            len(content) != expected["bytes"]
            or hashlib.sha256(content).hexdigest() != expected["sha256"]
        ):
            raise RuntimeError(f"Checksum mismatch: {relative}")
    return len(manifest)


verify(stage, "release-manifest.json")
backup = Path(f"/var/backups/gaasd-analytics-{release_id}")
backup.mkdir(mode=0o700)
nginx_file = Path("/etc/nginx/sites-available/gaasd-test")
nginx_before = nginx_file.read_text()
(backup / "gaasd-nginx.conf").write_text(nginx_before)
previous_site = (site / "public").resolve()
previous_backend = Path("/opt/gaasd-analytics/current").resolve()
guard_paths = [
    Path(name)
    for name in [
        "/etc/gaasd-analytics/config.json",
        "/etc/nginx/sites-available/gaasd-test",
        "/etc/nginx/snippets/gaasd-analytics.conf",
        "/etc/nginx/conf.d/gaasd-analytics-rate.conf",
        "/etc/systemd/system/gaasd-analytics.service",
        "/etc/systemd/system/gaasd-status-collector.service",
        "/etc/systemd/system/gaasd-analytics-backup.service",
        "/etc/systemd/system/gaasd-analytics-backup.timer",
    ]
]
guard_contents = {path: path.read_bytes() if path.exists() else None for path in guard_paths}
committed = False


def rollback_failed_deploy():
    if committed:
        return
    try:
        subprocess.run(
            ["systemctl", "stop", "gaasd-status-collector.service"],
            check=False,
            capture_output=True,
        )
        for path, contents in guard_contents.items():
            if contents is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(contents)
        for current, target in [
            (site / "public", previous_site),
            (Path("/opt/gaasd-analytics/current"), previous_backend),
        ]:
            if target.exists():
                temporary = current.with_name(current.name + "-status-rollback")
                temporary.unlink(missing_ok=True)
                temporary.symlink_to(target, target_is_directory=True)
                os.replace(temporary, current)
        subprocess.run(["systemctl", "daemon-reload"], check=False)
        subprocess.run(["systemctl", "restart", "gaasd-analytics.service"], check=False)
        if guard_contents[Path("/etc/systemd/system/gaasd-status-collector.service")] is not None:
            subprocess.run(["systemctl", "restart", "gaasd-status-collector.service"], check=False)
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=False)
        print("Deployment failed; restored previous site, backend and configuration.")
    except Exception as error:
        print(f"Rollback needs attention: {error}")


atexit.register(rollback_failed_deploy)
app_root = Path("/opt/gaasd-analytics")
app_root.mkdir(exist_ok=True)
app_releases = app_root / "releases"
app_releases.mkdir(exist_ok=True)
app_release = app_releases / release_id
shutil.copytree(stage / "backend", app_release)
static_release = site / "releases" / release_id
shutil.copytree(previous_site, static_release)
shutil.copytree(stage / "public", static_release, dirs_exist_ok=True)
static_count = verify(static_release, "asset-manifest.json")
for directory in [app_release, static_release]:
    for filename in [directory, *directory.rglob("*")]:
        filename.chmod(0o755 if filename.is_dir() else 0o644)

try:
    account = pwd.getpwnam("gaasd-analytics")
except KeyError:
    subprocess.run(
        [
            "useradd",
            "--system",
            "--user-group",
            "--home-dir",
            "/var/lib/gaasd-analytics",
            "--shell",
            "/usr/sbin/nologin",
            "gaasd-analytics",
        ],
        check=True,
    )
    account = pwd.getpwnam("gaasd-analytics")
venv = app_root / "venv"
if not (venv / "bin/python").exists():
    subprocess.run(["python3", "-m", "venv", str(venv)], check=True)
python = str(venv / "bin/python")
subprocess.run(
    [
        python,
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "-r",
        str(app_release / "requirements.txt"),
    ],
    check=True,
)
settings_dir = Path("/etc/gaasd-analytics")
settings_dir.mkdir(mode=0o750, exist_ok=True)
os.chown(settings_dir, 0, account.pw_gid)
config_file = settings_dir / "config.json"
data = Path("/var/lib/gaasd-analytics")
data.mkdir(mode=0o700, exist_ok=True)
os.chown(data, account.pw_uid, account.pw_gid)
database = data / "analytics.sqlite3"
if database.exists():
    with (
        sqlite3.connect(database) as source,
        sqlite3.connect(backup / "analytics.sqlite3") as target,
    ):
        source.backup(target)
if config_file.exists():
    shutil.copy2(config_file, backup / "config.json")
    config = json.loads(config_file.read_text())
else:
    password = secrets.token_urlsafe(24)
    hashed = subprocess.run(
        [
            python,
            "-c",
            "import sys; from werkzeug.security import generate_password_hash; print(generate_password_hash(sys.stdin.read()))",
        ],
        input=password,
        text=True,
        capture_output=True,
        check=True,
    ).stdout.strip()
    config = dict(
        database=str(database),
        username="gaasd-admin",
        password_hash=hashed,
        origins=["https://gaasd.com"],
        trusted_proxy=True,
    )
    credential_file = settings_dir / "admin-credentials.json"
    credential_file.write_text(
        json.dumps(
            dict(
                username=config["username"], password=password, url="https://gaasd.com/statistics"
            ),
            indent=2,
        )
    )
    credential_file.chmod(0o600)
config["geo_directory"] = str(app_root / "current" / "geo-data")
config["status_directory"] = str(data / "status")
status_directory = data / "status"
status_directory.mkdir(mode=0o700, exist_ok=True)
os.chown(status_directory, account.pw_uid, account.pw_gid)
config_file.write_text(json.dumps(config, indent=2))
config_file.chmod(0o640)
os.chown(config_file, 0, account.pw_gid)
next_app = app_root / f"current-next-{release_id}"
next_app.symlink_to(app_release, target_is_directory=True)
old_app = (app_root / "current").resolve() if (app_root / "current").exists() else None
os.replace(next_app, app_root / "current")
logfiles = sorted(Path("/var/log/nginx").glob("gaasd-test.access.log*"))
result = subprocess.run(
    [
        python,
        str(app_release / "import_logs.py"),
        str(config_file),
        *[str(log) for log in logfiles],
    ],
    capture_output=True,
    text=True,
    check=True,
)
print(result.stdout.strip())
subprocess.run([python, str(app_release / "refresh_agents.py"), str(config_file)], check=True)
for filename in data.glob("analytics.sqlite3*"):
    os.chown(filename, account.pw_uid, account.pw_gid)
    filename.chmod(0o600)

service = """[Unit]
Description=GAASD visitor and video analytics
After=network.target

[Service]
User=gaasd-analytics
Group=gaasd-analytics
WorkingDirectory=/opt/gaasd-analytics/current
Environment=GAASD_ANALYTICS_CONFIG=/etc/gaasd-analytics/config.json
ExecStart=/opt/gaasd-analytics/venv/bin/gunicorn --bind 127.0.0.1:4180 --workers 2 --threads 2 --timeout 30 app:create_app()
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/gaasd-analytics

[Install]
WantedBy=multi-user.target
"""
Path("/etc/systemd/system/gaasd-analytics.service").write_text(service)
Path("/etc/systemd/system/gaasd-status-collector.service").write_text("""[Unit]
Description=GAASD read-only server status sampler
After=network.target nginx.service

[Service]
User=gaasd-analytics
Group=gaasd-analytics
WorkingDirectory=/opt/gaasd-analytics/current
ExecStart=/opt/gaasd-analytics/venv/bin/python /opt/gaasd-analytics/current/status_collector.py
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/gaasd-analytics/status
CapabilityBoundingSet=
RestrictSUIDSGID=true
MemoryMax=192M
CPUQuota=20%

[Install]
WantedBy=multi-user.target
""")
Path("/etc/systemd/system/gaasd-analytics-backup.service").write_text("""[Unit]
Description=Back up GAASD analytics database

[Service]
Type=oneshot
User=gaasd-analytics
Group=gaasd-analytics
ExecStart=/opt/gaasd-analytics/venv/bin/python /opt/gaasd-analytics/current/backup.py
UMask=0077
""")
Path("/etc/systemd/system/gaasd-analytics-backup.timer").write_text("""[Unit]
Description=Daily GAASD analytics backup

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true

[Install]
WantedBy=timers.target
""")
subprocess.run(["systemctl", "daemon-reload"], check=True)
subprocess.run(
    ["systemctl", "enable", "--now", "gaasd-analytics.service", "gaasd-analytics-backup.timer"],
    check=True,
)
subprocess.run(["systemctl", "restart", "gaasd-analytics.service"], check=True)
subprocess.run(["systemctl", "enable", "gaasd-status-collector.service"], check=True)
subprocess.run(["systemctl", "restart", "gaasd-status-collector.service"], check=True)
for _attempt in range(20):
    try:
        with urllib.request.urlopen("http://127.0.0.1:4180/internal/health", timeout=3) as response:
            health = json.load(response)
        if health["status"] == "ok" and set(health["geo_versions"]) == {4, 6}:
            break
    except (OSError, ValueError):
        time.sleep(1)
else:
    raise RuntimeError("Analytics backend did not become healthy; frontend was not switched")

for _attempt in range(20):
    try:
        snapshot = json.loads((status_directory / "latest.json").read_text())
        if time.time() - snapshot["generated_at"] < 15 and snapshot["cpu"]["percent"] is not None:
            break
    except (OSError, ValueError, KeyError):
        pass
    time.sleep(1)
else:
    raise RuntimeError("Status sampler not ready; public status route was not enabled")

zones = Path("/etc/nginx/conf.d/gaasd-analytics-rate.conf")
if zones.exists():
    shutil.copy2(zones, backup / "rate.conf")
zones.write_text(
    "limit_req_zone $binary_remote_addr zone=gaasd_events:10m rate=10r/s;\nlimit_req_zone $binary_remote_addr zone=gaasd_stats:10m rate=5r/s;\n"
)
snippet = Path("/etc/nginx/snippets/gaasd-analytics.conf")
if snippet.exists():
    shutil.copy2(snippet, backup / "analytics-snippet.conf")
snippet.write_text("""location = /api/analytics/events {
    limit_req zone=gaasd_events burst=60 nodelay;
    limit_req_status 429;
    client_max_body_size 8k;
    proxy_pass http://127.0.0.1:4180;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 15s;
}
location ^~ /statistics {
    limit_req zone=gaasd_stats burst=30 nodelay;
    limit_req_status 429;
    proxy_pass http://127.0.0.1:4180;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 30s;
}
location ^~ /status {
    limit_req zone=gaasd_stats burst=30 nodelay;
    limit_req_status 429;
    proxy_pass http://127.0.0.1:4180;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 15s;
}
""")
include = "    include /etc/nginx/snippets/gaasd-analytics.conf;"
if include not in nginx_before:
    marker = "    location / { try_files $uri $uri/ =404; }"
    if nginx_before.count(marker) != 1:
        raise RuntimeError("Unexpected existing Nginx configuration")
    nginx_file.write_text(nginx_before.replace(marker, include + "\n" + marker))
try:
    subprocess.run(["nginx", "-t"], check=True)
    next_site = site / f"public-next-{release_id}"
    next_site.symlink_to(static_release, target_is_directory=True)
    os.replace(next_site, site / "public")
    subprocess.run(["systemctl", "reload", "nginx"], check=True)
except BaseException:
    nginx_file.write_text(nginx_before)
    rollback = site / f"public-rollback-{release_id}"
    rollback.symlink_to(previous_site, target_is_directory=True)
    os.replace(rollback, site / "public")
    subprocess.run(["systemctl", "reload", "nginx"], check=False)
    raise
subprocess.run(["systemctl", "start", "gaasd-analytics-backup.service"], check=True)
(backup / "release.json").write_text(
    json.dumps(
        dict(
            previous_site=str(previous_site),
            previous_backend=str(old_app),
            website=str(static_release),
            backend=str(app_release),
        ),
        indent=2,
    )
)
archive.unlink()
committed = True
print(
    json.dumps(
        dict(
            status="deployed",
            website=str(static_release),
            backend=str(app_release),
            backup=str(backup),
            verified_static_files=static_count,
            credentials="/etc/gaasd-analytics/admin-credentials.json",
        ),
        indent=2,
    )
)
