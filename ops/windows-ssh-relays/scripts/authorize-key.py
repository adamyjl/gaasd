"""Append one public key to the current Linux user's authorized_keys.

Usage: python3 authorize-key.py < workstation.pub
No sudo is needed when run as the target login user. Never accepts a private key.
"""

import base64
import datetime
import os
import shutil
import sys
from pathlib import Path

key = sys.stdin.read().strip()
parts = key.split()
if "\n" in key or "\r" in key or len(parts) < 2 or parts[0] not in ("ssh-ed25519", "ssh-rsa"):
    raise SystemExit("Supply exactly one RSA or Ed25519 public key.")
try:
    blob = base64.b64decode(parts[1], validate=True)
    length = int.from_bytes(blob[:4], "big")
    if blob[4 : 4 + length].decode("ascii") != parts[0]:
        raise ValueError("Key type does not match its payload")
except (ValueError, UnicodeError):
    raise SystemExit("Invalid SSH public key.") from None
ssh_dir = Path.home() / ".ssh"
ssh_dir.mkdir(mode=0o700, exist_ok=True)
auth = ssh_dir / "authorized_keys"
if ssh_dir.is_symlink() or auth.is_symlink():
    raise SystemExit("Refusing symlinked SSH authorization paths.")
existing = auth.read_text() if auth.exists() else ""
already_present = any(parts[1] in line.split() for line in existing.splitlines())
if not already_present:
    if auth.exists():
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = auth.with_name(f"authorized_keys.before-gaasd-{stamp}")
        shutil.copy2(auth, backup)
        os.chmod(backup, 0o600)
    with auth.open("a") as stream:
        stream.write(("\n" if existing and not existing.endswith("\n") else "") + key + "\n")
os.chmod(ssh_dir, 0o700)
os.chmod(auth, 0o600)
print(
    "Public key already authorized."
    if already_present
    else "Public key authorized; existing entries preserved."
)
