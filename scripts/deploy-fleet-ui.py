"""Apply only the three fleet UI files from a verified build:status archive.

Run as root with release_id and a baseline JSON of ui/fleet.* SHA-256 hashes.
Backs up before replacement; does not restart collectors or change authentication.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tarfile
import time

FILES = ("ui/fleet.css", "ui/fleet.html", "ui/fleet.js")


def digest(content):
    return hashlib.sha256(content).hexdigest()


def replace(target, content, suffix, metadata):
    temporary = target.with_name(target.name + suffix)
    with temporary.open("xb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, metadata.st_mode & 0o777)
    os.chown(temporary, metadata.st_uid, metadata.st_gid)
    os.replace(temporary, target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release_id")
    parser.add_argument("baseline")
    args = parser.parse_args()
    if os.geteuid() != 0 or not re.fullmatch(r"\d{8}T\d{6}", args.release_id):
        raise SystemExit("Root and YYYYMMDDTHHMMSS required")
    current = Path("/opt/gaasd-analytics/current").resolve(strict=True)
    if current.parent != Path("/opt/gaasd-analytics/releases"):
        raise SystemExit("Unexpected active release")
    expected_before = json.loads(Path(args.baseline).read_text())
    before, metadata, after = {}, {}, {}
    for name in FILES:
        target = current / name
        if target.is_symlink():
            raise SystemExit("Refuse to replace symlink")
        before[name], metadata[name] = target.read_bytes(), target.stat()
        if digest(before[name]) != expected_before[name]:
            raise SystemExit(f"Active file changed since review: {name}")
    with tarfile.open(f"/tmp/gaasd-status-{args.release_id}.tar") as archive:
        entries = {}
        for entry in archive.getmembers():
            name = entry.name.removeprefix("./")
            if name in (*FILES, "manifest.json"):
                if name in entries or not entry.isfile() or entry.size > 2_000_000:
                    raise SystemExit("Invalid UI archive entry")
                entries[name] = archive.extractfile(entry).read()
        manifest = json.loads(entries["manifest.json"])
        for name in FILES:
            after[name] = entries[name]
            if digest(after[name]) != manifest[name]:
                raise SystemExit(f"Checksum failed: {name}")
    backup = Path(f"/var/backups/gaasd-fleet-ui-{args.release_id}")
    backup.mkdir(mode=0o700)
    for name in FILES:
        (backup / name).parent.mkdir(exist_ok=True)
        shutil.copy2(current / name, backup / name)
    record = dict(
        active_release=str(current), changed_at=time.time(),
        before={name: digest(content) for name, content in before.items()},
        after={name: digest(content) for name, content in after.items()},
    )
    (backup / "deployment.json").write_text(json.dumps(record, indent=2))
    try:
        for name in FILES:
            replace(current / name, after[name], f".{args.release_id}.next", metadata[name])
        assert all(digest((current / name).read_bytes()) == digest(after[name]) for name in FILES)
    except BaseException:
        for name in FILES:
            replace(current / name, before[name], f".{args.release_id}.rollback", metadata[name])
        raise
    print(json.dumps(dict(backup=str(backup), **record), indent=2))


if __name__ == "__main__":
    main()
