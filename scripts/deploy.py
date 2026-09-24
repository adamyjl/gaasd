"""Install a verified static release on the existing GAASD Tencent host."""

import hashlib
import json
import os
import re
import subprocess
import sys
import tarfile
from pathlib import Path

release_id = sys.argv[1]
if not re.fullmatch(r"[0-9]{8}T[0-9]{6}", release_id):
    raise SystemExit("Expected a YYYYMMDDTHHMMSS release identifier")

base = Path("/var/www/gaasd-test")
if base.resolve() != base or not base.is_dir():
    raise SystemExit("Unexpected existing site directory")
archive = Path(f"/tmp/gaasd-release-{release_id}.tar")
releases = base / "releases"
releases.mkdir(exist_ok=True)
release = releases / release_id
release.mkdir()
with tarfile.open(archive) as bundle:
    bundle.extractall(release, filter="data")

manifest_path = release / "asset-manifest.json"
manifest = json.loads(manifest_path.read_text())
if not {"index.html", "app.js", "style.css", "media/overview.mp4"}.issubset(manifest):
    raise SystemExit("Unexpected release file count")
for relative, expected in manifest.items():
    filename = (release / relative).resolve()
    if not filename.is_relative_to(release):
        raise SystemExit("Invalid manifest path")
    payload = filename.read_bytes()
    if len(payload) != expected["bytes"] or hashlib.sha256(payload).hexdigest() != expected["sha256"]:
        raise SystemExit(f"Release verification failed: {relative}")
for filename in [release, *release.rglob("*")]:
    filename.chmod(0o755 if filename.is_dir() else 0o644)
subprocess.run(["nginx", "-t"], check=True)

public = base / "public"
previous = releases / f"previous-{release_id}"
next_link = base / f"public-next-{release_id}"
next_link.symlink_to(release, target_is_directory=True)
if public.is_symlink():
    previous.symlink_to(public.resolve(), target_is_directory=True)
    os.replace(next_link, public)
elif public.is_dir():
    public.rename(previous)
    try:
        os.replace(next_link, public)
    except BaseException:
        previous.rename(public)
        raise
else:
    raise SystemExit("Expected the existing public site")

print(json.dumps({
    "release": str(release),
    "previous": str(previous),
    "public": str(public),
    "verified_files": len(manifest),
    "bytes": sum(entry["bytes"] for entry in manifest.values()),
    "manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
}, indent=2))
archive.unlink()
