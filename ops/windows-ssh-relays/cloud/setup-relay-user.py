"""Provision one restricted reverse-forward account; PUBLIC key comes from stdin."""

import argparse
import base64
import os
import pwd
import struct
import subprocess
import sys
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("relay", choices=("linux", "windows", "rtx4090"))
args = parser.parse_args()
username, port = {
    "linux": ("gaasd-tsari-relay", 2223),
    "windows": ("gaasd-windows-relay", 2224),
    "rtx4090": ("gaasd-4090-relay", 2225),
}[args.relay]
if os.geteuid() != 0:
    parser.error("Run as root.")
key = sys.stdin.read().strip()
parts = key.split()
if "\n" in key or "\r" in key or len(parts) < 2 or parts[0] != "ssh-ed25519":
    parser.error("Supply one Ed25519 public key, never a private key.")
try:
    blob = base64.b64decode(parts[1], validate=True)
    if blob[:4] != struct.pack(">I", 11) or blob[4:15] != b"ssh-ed25519":
        raise ValueError("Invalid key type")
    if blob[15:19] != struct.pack(">I", 32) or len(blob) != 51:
        raise ValueError("Invalid Ed25519 key size")
except (ValueError, IndexError):
    parser.error("Invalid Ed25519 public key.")
subprocess.run(["/usr/sbin/sshd", "-t"], check=True)
home = Path("/var/lib") / username
try:
    account = pwd.getpwnam(username)
    if account.pw_dir != str(home) or account.pw_shell != "/usr/sbin/nologin":
        parser.error("Existing account differs; refusing to change it.")
except KeyError:
    if home.exists() or home.is_symlink():
        parser.error("Account home already exists; refusing to reuse it.")
    subprocess.run(
        [
            "useradd",
            "--system",
            "--user-group",
            "--create-home",
            "--home-dir",
            str(home),
            "--shell",
            "/usr/sbin/nologin",
            username,
        ],
        check=True,
    )
    account = pwd.getpwnam(username)
ssh_dir = home / ".ssh"
auth_file = ssh_dir / "authorized_keys"
if any(path.is_symlink() for path in (home, ssh_dir, auth_file)):
    parser.error("Refusing symbolic links.")
ssh_dir.mkdir(mode=0o700, exist_ok=True)
entry = (
    f'restrict,port-forwarding,permitlisten="127.0.0.1:{port}",'
    'permitopen="relay-disabled.invalid:1",command="/bin/false" ' + key + "\n"
)
if auth_file.exists() and auth_file.read_text() != entry:
    parser.error("Existing authorization differs; review it manually. Nothing overwritten.")
auth_file.write_text(entry)
for path, mode in ((home, 0o750), (ssh_dir, 0o700), (auth_file, 0o600)):
    os.chown(path, account.pw_uid, account.pw_gid)
    os.chmod(path, mode)
print(f"{username}: restricted reverse listener 127.0.0.1:{port} is authorized.")
print("No SSH/Nginx/VPN configuration changes or service reloads.")
