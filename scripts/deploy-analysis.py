"""Root-only versioned backend overlay for /analysis; no public frontend/media change.

Before use, provision fixed workload probes and a 0640 root:gaasd-analytics
/etc/gaasd-analytics/analysis.json. Bundle contains a checksum manifest.
"""

import argparse
import base64
import hashlib
import json
import os
import pwd
import re
import shutil
import subprocess
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True)


def activate(link, target):
    temp = link.with_name("analysis-next")
    temp.symlink_to(target, target_is_directory=True)
    os.replace(temp, link)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("release")
    args = parser.parse_args()
    if os.geteuid() != 0 or not re.fullmatch(r"\d{8}T\d{6}", args.release):
        raise SystemExit("Root and YYYYMMDDTHHMMSS required")
    root = Path("/opt/gaasd-analytics")
    old = (root / "current").resolve(strict=True)
    if old.parent != root / "releases":
        raise ValueError("Unexpected active release")
    required = {
        "app.py",
        "analysis.py",
        "analysis_collector.py",
        "ui/analysis.html",
        "ui/analysis.css",
        "ui/analysis.js",
        "ui/fleet.html",
        "ops/gaasd-analysis.service",
        "ops/gaasd-analysis.timer",
        "ops/nginx.conf",
    }
    stage = Path("/tmp/gaasd-analysis-stage-" + args.release)
    stage.mkdir(mode=0o700)
    with tarfile.open("/tmp/gaasd-analysis-" + args.release + ".tar") as bundle:
        for member in bundle.getmembers():
            if not member.isfile() or member.name not in required | {"manifest.json"}:
                raise ValueError("Unexpected archive member")
        bundle.extractall(stage, filter="data")
    manifest = json.loads((stage / "manifest.json").read_text())
    if set(manifest) != required:
        raise ValueError("Invalid manifest")
    for name, digest in manifest.items():
        if hashlib.sha256((stage / name).read_bytes()).hexdigest() != digest:
            raise ValueError("Checksum mismatch")
    release = root / "releases" / args.release
    backup = Path("/var/backups/gaasd-analysis-" + args.release)
    backup.mkdir(mode=0o700)
    nginx = Path("/etc/nginx/snippets/gaasd-analytics.conf")
    saved_nginx = nginx.read_bytes()
    if b"location = /analysis" in saved_nginx:
        raise ValueError(
            "Existing analysis proxy: use a reviewed backend overlay, not first install"
        )
    (backup / "gaasd-analytics.conf").write_bytes(saved_nginx)
    record = dict(previous_backend=str(old), new_backend=str(release), manifest=manifest)
    (backup / "deployment.json").write_text(json.dumps(record, indent=2))
    shutil.copytree(old, release, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for name in required:
        if not name.startswith("ops/"):
            shutil.copyfile(stage / name, release / name)
    run(str(root / "venv/bin/python"), "-m", "compileall", "-q", str(release))
    user = pwd.getpwnam("gaasd-analytics")
    data = Path("/var/lib/gaasd-analytics/analysis")
    data.mkdir(mode=0o700, exist_ok=True)
    os.chown(data, user.pw_uid, user.pw_gid)
    cfg = Path("/etc/gaasd-analytics/analysis.json")
    if not cfg.is_file() or cfg.stat().st_mode & 0o007:
        raise ValueError("Missing or public analysis configuration")
    switched = False
    installed_units = []
    try:
        activate(root / "current", release)
        switched = True
        run("systemctl", "restart", "gaasd-analytics")
        for _ in range(15):
            try:
                urllib.request.urlopen("http://127.0.0.1:4180/internal/health", timeout=2).close()
                break
            except (OSError, urllib.error.URLError):
                time.sleep(1)
        auth = json.loads(Path("/etc/gaasd-analytics/admin-credentials.json").read_text())
        token = base64.b64encode((auth["username"] + ":" + auth["password"]).encode()).decode()
        for path in (
            "/analysis",
            "/analysis/cpu",
            "/analysis/gpu",
            "/analysis/api/report",
            "/analysis/assets/analysis.js",
            "/analysis/assets/analysis.css",
            "/status1",
        ):
            url = "http://127.0.0.1:4180" + path
            try:
                urllib.request.urlopen(url, timeout=10)
                raise RuntimeError("Unauthenticated access unexpectedly succeeded")
            except urllib.error.HTTPError as error:
                if error.code != 401:
                    raise
            with urllib.request.urlopen(
                urllib.request.Request(url, headers={"Authorization": "Basic " + token}), timeout=10
            ) as response:
                assert response.status == 200
        addition = (stage / "ops/nginx.conf").read_bytes()
        if b"location = /analysis" in saved_nginx:
            raise ValueError("Existing analysis proxy requires manual review")
        nginx.write_bytes(saved_nginx + b"\n" + addition)
        run("nginx", "-t")
        run("systemctl", "reload", "nginx")
        for unit in ("gaasd-analysis.service", "gaasd-analysis.timer"):
            target = Path("/etc/systemd/system") / unit
            if target.exists():
                shutil.copyfile(target, backup / unit)
            installed_units.append(unit)
            shutil.copyfile(stage / "ops" / unit, target)
            target.chmod(0o644)
        run("systemctl", "daemon-reload")
        run("systemctl", "enable", "--now", "gaasd-analysis.timer")
        print(json.dumps(record | dict(backup=str(backup), timer="enabled")))
    except Exception:
        if installed_units:
            subprocess.run(
                ["systemctl", "disable", "--now", "gaasd-analysis.timer"], capture_output=True
            )
            subprocess.run(["systemctl", "stop", "gaasd-analysis.service"], capture_output=True)
            for unit in installed_units:
                target = Path("/etc/systemd/system") / unit
                if (backup / unit).exists():
                    shutil.copyfile(backup / unit, target)
                else:
                    target.unlink(missing_ok=True)
            run("systemctl", "daemon-reload")
        nginx.write_bytes(saved_nginx)
        if switched:
            activate(root / "current", old)
            run("systemctl", "restart", "gaasd-analytics")
        run("nginx", "-t")
        run("systemctl", "reload", "nginx")
        raise


if __name__ == "__main__":
    main()
