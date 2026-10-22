"""Run as the target Linux login user; read a public-key/manifest JSON on stdin.

Stage this script, the three probe modules and the pinned psutil wheel together.
No root access, listening service, application-environment change or private key.
"""

import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path


def main():
    spec = json.load(sys.stdin)
    public = spec["public_key"].strip()
    if not re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/]{68}(?: [^\r\n]+)?", public):
        raise ValueError("An Ed25519 PUBLIC key is required")
    gpus = spec["gpus"]
    if gpus not in (1, 8):
        raise ValueError("Invalid GPU count")
    stage = Path(__file__).resolve().parent
    files = {"fleet_probe.py", "status_collector.py", "gpu_metrics.py"}
    for name in files | {spec["wheel"]}:
        if "/" in name or "\\" in name:
            raise ValueError("Unexpected filename")
        if hashlib.sha256((stage / name).read_bytes()).hexdigest() != spec["hashes"][name]:
            raise ValueError("Checksum mismatch")
    root = Path.home() / ".local/share/gaasd-fleet"
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    version = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
    release = root / "releases" / version
    release.mkdir(parents=True, mode=0o700)
    env = root / "venv"
    if not env.exists():
        subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(env)], check=True)
    python = str(env / "bin/python")
    # Wheel is a pinned binary package: no compiler/network/application pip changes.
    site = Path(
        subprocess.check_output(
            [python, "-c", "import sysconfig;print(sysconfig.get_path('platlib'))"], text=True
        ).strip()
    )
    with zipfile.ZipFile(stage / spec["wheel"]) as wheel:
        for name in wheel.namelist():
            path = (site / name).resolve()
            if os.path.commonpath([str(path), str(site.resolve())]) != str(site.resolve()):
                raise ValueError("Wheel path escape")
        wheel.extractall(site)
    subprocess.run([python, "-c", "import psutil;assert psutil.__version__=='7.2.2'"], check=True)
    for name in files:
        shutil.copyfile(stage / name, release / name)
    current = root / "current"
    previous = str(current.resolve()) if current.exists() else None
    temporary = root / "current.next"
    temporary.symlink_to(release)
    os.replace(temporary, current)
    command = f"{python} {current}/fleet_probe.py --gpus {gpus}"
    entry = f'restrict,command="{command}" {public}\n'
    ssh = Path.home() / ".ssh"
    ssh.mkdir(mode=0o700, exist_ok=True)
    auth = ssh / "authorized_keys"
    if ssh.is_symlink() or auth.is_symlink():
        raise ValueError("Refuse symbolic SSH paths")
    with auth.open("a+b") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        handle.seek(0)
        original = handle.read()
        blob = public.split()[1].encode()
        if blob not in original:
            backup = ssh / f"authorized_keys.before-fleet-{version}"
            backup.write_bytes(original)
            backup.chmod(0o600)
            handle.write(
                (b"\n" if original and not original.endswith(b"\n") else b"") + entry.encode()
            )
            handle.flush()
            os.fsync(handle.fileno())
        elif entry.encode().strip() not in original:
            raise ValueError("Key exists with different restrictions")
    ssh.chmod(0o700)
    auth.chmod(0o600)
    print(
        json.dumps(
            dict(
                release=str(release),
                previous=previous,
                gpus=gpus,
                authorization="restricted snapshot key",
            )
        )
    )


if __name__ == "__main__":
    main()
