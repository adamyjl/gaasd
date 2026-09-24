"""Streaming, checksummed backup archives; usable on Windows and Linux (Python 3.12)."""

import hashlib
import io
import json
import os
import posixpath
import tarfile
from pathlib import Path, PurePosixPath


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def safe_name(name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name:
        raise ValueError(f"Unsafe archive path: {name}")
    return path


def create_archive(destination, files, metadata):
    """files maps archive-relative names to local files or relative symlinks."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise FileExistsError(destination)
    manifest = {}
    for name, filename in sorted(files.items()):
        safe_name(name)
        p = Path(filename)
        if p.is_symlink():
            target = os.readlink(p)
            safe_name(posixpath.normpath(posixpath.join(posixpath.dirname(name), target)))
            if PurePosixPath(target).is_absolute():
                raise ValueError(f"Absolute symlink: {name}")
            manifest[name] = {"type": "symlink", "target": target}
        elif p.is_file():
            manifest[name] = {"type": "file", "bytes": p.stat().st_size, "sha256": digest(p)}
        else:
            raise ValueError(f"Unsupported backup entry: {name}")
    payload = json.dumps(
        {"metadata": metadata, "files": manifest}, ensure_ascii=False, indent=2
    ).encode("utf-8")
    partial = destination.with_name(destination.name + ".partial")
    with tarfile.open(partial, "w:gz", compresslevel=1) as bundle:
        info = tarfile.TarInfo("BACKUP-MANIFEST.json")
        info.size = len(payload)
        info.mode = 0o600
        bundle.addfile(info, io.BytesIO(payload))
        for name, record in manifest.items():
            p = Path(files[name])
            info = tarfile.TarInfo(name)
            info.mode = p.lstat().st_mode & 0o777
            info.mtime = int(p.lstat().st_mtime)
            if record["type"] == "symlink":
                info.type = tarfile.SYMTYPE
                info.linkname = record["target"]
                bundle.addfile(info)
            else:
                info.size = record["bytes"]
                with p.open("rb") as stream:
                    bundle.addfile(info, stream)
    partial.chmod(0o600)
    result = verify_archive(partial)
    partial.rename(destination)
    result.update(
        archive=destination.name, sha256=digest(destination), bytes=destination.stat().st_size
    )
    destination.with_name(destination.name + ".sha256").write_text(
        f"{result['sha256']}  {destination.name}\n", encoding="ascii"
    )
    return result


def verify_archive(filename):
    """Read every member; validate hashes and links without touching any live files."""
    seen = set()
    with tarfile.open(filename, "r|gz") as bundle:
        members = iter(bundle)
        first = next(members)
        if first.name != "BACKUP-MANIFEST.json" or not first.isfile():
            raise ValueError("Missing backup manifest")
        document = json.load(bundle.extractfile(first))
        expected = document["files"]
        for item in members:
            safe_name(item.name)
            if item.name in seen or item.name not in expected:
                raise ValueError(f"Unexpected member: {item.name}")
            row = expected[item.name]
            if row["type"] == "symlink":
                if not item.issym() or item.linkname != row["target"]:
                    raise ValueError(f"Link mismatch: {item.name}")
                target = posixpath.normpath(
                    posixpath.join(posixpath.dirname(item.name), item.linkname)
                )
                safe_name(target)
                if target not in expected:
                    raise ValueError(f"Unbacked symlink target: {item.name}")
            else:
                if not item.isfile() or item.size != row["bytes"]:
                    raise ValueError(f"Size mismatch: {item.name}")
                actual = hashlib.file_digest(bundle.extractfile(item), "sha256").hexdigest()
                if actual != row["sha256"]:
                    raise ValueError(f"Checksum mismatch: {item.name}")
            seen.add(item.name)
    if seen != set(expected):
        raise ValueError("Incomplete archive")
    return {"verified": True, "entries": len(seen), "metadata": document["metadata"]}
