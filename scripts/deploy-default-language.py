"""Publish the Chinese default homepage and /en/ without re-uploading media.

The archive contains six HTML files, a full asset manifest, backend/app.py and
deployment.json with before/after hashes. Run on the existing host as root.
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import time
from pathlib import Path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def activate(link, target):
    temporary = link.with_name(link.name + "-language-next")
    if temporary.is_symlink():
        temporary.unlink()
    temporary.symlink_to(target, target_is_directory=True)
    os.replace(temporary, link)


def fetch(path):
    return subprocess.check_output(
        [
            "curl",
            "--fail",
            "--silent",
            "--show-error",
            "--max-time",
            "15",
            "-A",
            "GAASD-QA",
            "--resolve",
            "gaasd.com:443:127.0.0.1",
            "https://gaasd.com/" + path,
        ]
    )


def main():
    release_id, archive_hash = sys.argv[1:3]
    if os.geteuid() != 0 or not re.fullmatch(r"\d{8}T\d{6}", release_id):
        raise SystemExit("Root and a valid release ID are required")
    base = Path("/var/www/gaasd-test")
    public = base / "public"
    previous = public.resolve(strict=True)
    app_root = Path("/opt/gaasd-analytics")
    current_app = app_root / "current"
    previous_app = current_app.resolve(strict=True)
    if previous.parent != base / "releases" or previous_app.parent != app_root / "releases":
        raise SystemExit("Unexpected active release paths")
    archive = Path(f"/tmp/gaasd-language-{release_id}.tar")
    if digest(archive.read_bytes()) != archive_hash:
        raise SystemExit("Archive checksum mismatch")
    pages = {
        "index.html",
        "cn/index.html",
        "en/index.html",
        "privacy.html",
        "cn/privacy.html",
        "en/privacy.html",
    }
    with tarfile.open(archive) as bundle:
        members = bundle.getmembers()
        allowed = pages | {"asset-manifest.json", "backend/app.py", "deployment.json"}
        if len(members) != len(allowed) or {m.name for m in members} != allowed:
            raise SystemExit("Unexpected deployment files")
        if not all(m.isfile() for m in members):
            raise SystemExit("Only regular files are allowed")
        updates = {m.name: bundle.extractfile(m).read() for m in members}
    metadata = json.loads(updates.pop("deployment.json"))
    app = updates.pop("backend/app.py")
    old_manifest = (previous / "asset-manifest.json").read_bytes()
    if (
        previous.name != metadata["previous_release"]
        or digest(old_manifest) != metadata["previous_manifest_sha256"]
        or previous_app.name != metadata["previous_backend"]
        or digest((previous_app / "app.py").read_bytes()) != metadata["previous_app_sha256"]
        or digest(app) != metadata["app_sha256"]
    ):
        raise SystemExit("Active release changed or application hash mismatch")
    old = json.loads(old_manifest)
    new = json.loads(updates["asset-manifest.json"])
    changed = {name for name in old.keys() | new.keys() if old.get(name) != new.get(name)}
    if changed != pages or not old.keys() <= new.keys():
        raise SystemExit("Updates exceed the default-language change")
    release = base / "releases" / release_id
    app_release = app_root / "releases" / release_id
    backup = Path(f"/var/backups/gaasd-language-{release_id}")
    backup.mkdir(mode=0o700)
    record = dict(
        previous_site=str(previous),
        previous_backend=str(previous_app),
        frontend=str(release),
        backend=str(app_release),
        changed_files=sorted(changed),
        app_sha256=metadata["app_sha256"],
    )
    (backup / "deployment.json").write_text(json.dumps(record, indent=2))
    shutil.copytree(previous, release, copy_function=os.link)
    for name, payload in updates.items():
        destination = release / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            destination.unlink()  # Break the old release hard link before writing.
        destination.write_bytes(payload)
        destination.chmod(0o644)
    for name, expected in new.items():
        filename = (release / name).resolve(strict=True)
        if not filename.is_relative_to(release):
            raise RuntimeError("Manifest path outside release")
        payload = filename.read_bytes()
        if len(payload) != expected["bytes"] or digest(payload) != expected["sha256"]:
            raise RuntimeError(f"Checksum mismatch: {name}")
    shutil.copytree(
        previous_app, app_release, ignore=shutil.ignore_patterns("__pycache__", "*.pyc")
    )
    (app_release / "app.py").write_bytes(app)
    (app_release / "app.py").chmod(0o644)
    subprocess.run(
        [str(app_root / "venv/bin/python"), "-m", "py_compile", str(app_release / "app.py")],
        check=True,
    )
    subprocess.run(["nginx", "-t"], check=True)
    try:
        activate(current_app, app_release)
        subprocess.run(["systemctl", "restart", "gaasd-analytics"], check=True)
        for attempt in range(10):
            health = subprocess.run(
                [
                    "curl",
                    "--fail",
                    "--silent",
                    "--max-time",
                    "3",
                    "http://127.0.0.1:4180/internal/health",
                ],
                capture_output=True,
            )
            if health.returncode == 0 and json.loads(health.stdout).get("status") == "ok":
                break
            if attempt == 9:
                raise RuntimeError("Backend health check failed")
            time.sleep(1)
        activate(public, release)
        for page in pages:
            if digest(fetch(page)) != new[page]["sha256"]:
                raise RuntimeError(f"Served page mismatch: {page}")
        if digest(fetch("")) != new["index.html"]["sha256"]:
            raise RuntimeError("Default homepage was not updated")
        record.update(verified_files=len(new), media_unchanged=True, origin_checks="passed")
        (backup / "deployment.json").write_text(json.dumps(record, indent=2))
        print(json.dumps(record, indent=2))
    except BaseException:
        activate(public, previous)
        activate(current_app, previous_app)
        subprocess.run(["systemctl", "restart", "gaasd-analytics"], check=True)
        raise


if __name__ == "__main__":
    main()
