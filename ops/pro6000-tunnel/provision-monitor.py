"""Cloud root: add a dedicated snapshot key and fixed PRO 6000 endpoint.

Argument: trusted workstation Ed25519 host public key file, obtained through
an authenticated administrative connection. Prints only the collection PUBLIC key.
Private key remains on the cloud. Run before installing the remote probe.
"""

import argparse
import json
import os
import pwd
import shutil
import subprocess
import time
from pathlib import Path

PORTS = {"pro6000": 2226, "pro6000-02": 2227, "pro6000-03": 2228, "pro6000-04": 2229}


def main():
    if os.geteuid() != 0:
        raise SystemExit("Cloud root required")
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("public_key", type=Path)
    parser.add_argument("--host", choices=PORTS, default="pro6000")
    args = parser.parse_args()
    host = args.host
    port = PORTS[host]
    public = args.public_key.read_text().strip().split()
    if len(public) < 2 or public[0] != "ssh-ed25519":
        raise ValueError("Expected trusted Ed25519 host public key")
    user = pwd.getpwnam("gaasd-analytics")
    root = Path("/etc/gaasd-analytics/fleet-ssh")
    key = root / f"{host}_ed25519"
    known = root / f"{host}_known_hosts"
    expected = f"[127.0.0.1]:{port} " + " ".join(public[:2]) + "\n"
    if known.exists() and known.read_text() != expected:
        raise ValueError("Existing host key differs; refusing replacement")
    if not key.exists():
        subprocess.run(
            [
                "ssh-keygen",
                "-q",
                "-t",
                "ed25519",
                "-N",
                "",
                "-C",
                f"gaasd-{host}-monitor",
                "-f",
                str(key),
            ],
            check=True,
        )
    known.write_text(expected)
    for path in (key, key.with_suffix(".pub"), known):
        path.chmod(0o600)
        os.chown(path, user.pw_uid, user.pw_gid)
    config = Path("/etc/gaasd-analytics/fleet.json")
    data = json.loads(config.read_text())
    entry = dict(identity_file=str(key), known_hosts=str(known))
    if host in data["hosts"] and data["hosts"][host] != entry:
        raise ValueError("Existing endpoint differs")
    if host not in data["hosts"]:
        backup = config.with_name(f"fleet.before-{host}-" + time.strftime("%Y%m%dT%H%M%S"))
        shutil.copy2(config, backup)
        backup.chmod(0o600)
        data["hosts"][host] = entry
        temporary = config.with_suffix(".next")
        temporary.write_text(json.dumps(data, indent=2) + "\n")
        temporary.chmod(0o600)
        os.chown(temporary, user.pw_uid, user.pw_gid)
        os.replace(temporary, config)
    folder = Path("/var/lib/gaasd-analytics/status") / host
    folder.mkdir(mode=0o700, exist_ok=True)
    os.chown(folder, user.pw_uid, user.pw_gid)
    print(key.with_suffix(".pub").read_text().strip())


if __name__ == "__main__":
    main()
