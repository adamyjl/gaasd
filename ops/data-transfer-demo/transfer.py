#!/usr/bin/python3
"""Bounded, on-demand A100 <-> RTX 5090 rsync transfer. No daemon or sudo."""

import argparse
import fcntl
import json
import os
import re
import shlex
import subprocess
from pathlib import Path


def dataset_name(value):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,95}", value):
        raise argparse.ArgumentTypeError("Use a dataset name, not a path (letters/digits/._-).")
    return value


def nonnegative(value):
    number = int(value)
    if number < 0:
        raise argparse.ArgumentTypeError("Must be >= 0; 0 explicitly disables the rate limit.")
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("push", "pull", "list"))
    parser.add_argument("dataset", nargs="?", type=dataset_name)
    parser.add_argument("--bwlimit", type=nonnegative, default=128, help="KiB/s, default 128")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--config", type=Path, default=Path.home() / ".config/gaasd-data-demo/client.json"
    )
    args = parser.parse_args()
    if args.action != "list" and args.dataset is None:
        parser.error("push/pull requires a dataset name")
    config = json.loads(args.config.read_text())
    root = Path(config["data_root"]).resolve(strict=True)
    ssh_config = Path(config["ssh_config"]).resolve(strict=True)
    # One transfer per client: keep demo load bounded and prevent partial-file races.
    lock = (root / ".transfer.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        parser.error("Another transfer is active. Wait for it to finish.")
    command = [
        "/usr/bin/ionice",
        "-c",
        "3",
        "/usr/bin/nice",
        "-n",
        "10",
        "/usr/bin/rsync",
        "-rt",
        "--checksum",
        "--partial-dir=.rsync-partial",
        "--timeout=90",
        "--info=stats2,progress2",
        "--bwlimit=" + str(args.bwlimit),
        "-e",
        "/usr/bin/ssh -F " + shlex.quote(str(ssh_config)),
    ]
    if args.dry_run:
        command.append("--dry-run")
    if args.action == "list":
        command.extend(["--list-only", "--", "gaasd-data-5090:./"])
    else:
        parent = root / ("outbox" if args.action == "push" else "inbox")
        local = parent / args.dataset
        if parent.is_symlink() or parent.resolve() != parent:
            parser.error("The data directory must not be a symlink")
        if local.is_symlink() or local.resolve().parent != parent:
            parser.error("Dataset must stay inside its inbox/outbox")
        if args.action == "push":
            if not local.is_dir():
                parser.error("Create the dataset under " + str(parent))
            # Deliberately do not follow or transfer symlinks, device files, or sockets.
            for base, dirs, files in os.walk(local):
                for name in dirs + files:
                    item = Path(base) / name
                    if item.is_symlink() or not (item.is_dir() or item.is_file()):
                        parser.error("Only regular files and directories allowed: " + str(item))
            command.extend(["--", str(local) + "/", "gaasd-data-5090:inbox/" + args.dataset + "/"])
        else:
            local.mkdir(mode=0o700, exist_ok=True)
            command.extend(["--", "gaasd-data-5090:outbox/" + args.dataset + "/", str(local) + "/"])
    # No compression, --delete, in-place writes, shell=True, or broad administrative keys.
    result = subprocess.run(command, check=False)
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
