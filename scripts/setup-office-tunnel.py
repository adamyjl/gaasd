"""Root-only provisioning for the fixed office/cloud reverse SSH tunnel.

Upload this script and ops/office-tunnel/* into one directory. Run office-prepare
on the office machine first; transfer only its public key to the cloud. The
cloud host key must be obtained via an already trusted administrative login.
No credentials or private keys are accepted from or returned to this script.
"""

import argparse
import datetime
import json
import os
import pwd
import shutil
import subprocess
from pathlib import Path

ACCOUNT = "gaasd-office-tunnel"
HOME_DIR = Path("/var/lib/gaasd-office-tunnel")
CONF = Path("/etc/gaasd-office-tunnel")
UNIT = "gaasd-office-tunnel.service"


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def ensure_user():
    try:
        user = pwd.getpwnam(ACCOUNT)
    except KeyError:
        run(
            "useradd",
            "--system",
            "--create-home",
            "--home-dir",
            str(HOME_DIR),
            "--shell",
            "/usr/sbin/nologin",
            ACCOUNT,
        )
        user = pwd.getpwnam(ACCOUNT)
    if user.pw_dir != str(HOME_DIR) or user.pw_shell != "/usr/sbin/nologin":
        raise RuntimeError("Unexpected existing tunnel account")
    HOME_DIR.mkdir(mode=0o700, exist_ok=True)
    HOME_DIR.chmod(0o700)
    os.chown(HOME_DIR, user.pw_uid, user.pw_gid)
    return user


def save(path, content, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".gaasd-next")
    temporary.write_text(content)
    temporary.chmod(mode)
    os.replace(temporary, path)


def backup(path):
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    directory = Path("/var/backups/gaasd-office-tunnel") / stamp
    directory.mkdir(parents=True, mode=0o700)
    target = directory / path.name
    shutil.copy2(path, target)
    target.chmod(0o600)
    return target


def main():
    global ACCOUNT, HOME_DIR, CONF, UNIT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=["office", "pro6000", "pro6000-02"], default="office")
    parser.add_argument(
        "phase", choices=["office-prepare", "cloud-authorize", "office-start", "cloud-web"]
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--public-key", type=Path)
    parser.add_argument("--host-key", type=Path)
    args = parser.parse_args()
    if args.profile.startswith("pro6000"):
        if args.phase == "cloud-web":
            raise SystemExit("PRO 6000 uses the existing authenticated status backend")
        ACCOUNT = f"gaasd-{args.profile}-tunnel"
        HOME_DIR = Path("/var/lib") / ACCOUNT
        CONF = Path("/etc") / ACCOUNT
        UNIT = ACCOUNT + ".service"
    marker = "# BEGIN GAASD " + args.profile.upper() + " TUNNEL"

    def template(name):
        text = (args.source / name).read_text()
        if args.profile == "pro6000-02":
            text = text.replace("gaasd-pro6000-tunnel", ACCOUNT)
            text = text.replace("PRO6000 TUNNEL", "PRO6000-02 TUNNEL")
            text = text.replace(":2226", ":2227")
        return text

    if os.geteuid() != 0:
        raise SystemExit("Run as root")
    os.umask(0o077)

    if args.phase == "office-prepare":
        user = ensure_user()
        private = HOME_DIR / "id_ed25519"
        if not private.exists():
            run(
                "ssh-keygen",
                "-q",
                "-t",
                "ed25519",
                "-N",
                "",
                "-C",
                ACCOUNT,
                "-f",
                str(private),
            )
        for path, mode in [(private, 0o600), (private.with_suffix(".pub"), 0o644)]:
            os.chown(path, user.pw_uid, user.pw_gid)
            path.chmod(mode)
        print(private.with_suffix(".pub").read_text().strip())

    elif args.phase == "cloud-authorize":
        if not args.public_key:
            raise RuntimeError("Supply the office public key")
        fingerprint = run("ssh-keygen", "-lf", str(args.public_key), "-E", "sha256")
        key = args.public_key.read_text().strip()
        if not key.startswith("ssh-ed25519 ") or "\n" in key:
            raise RuntimeError("Expected one Ed25519 public key")
        user = ensure_user()
        ssh_dir = HOME_DIR / ".ssh"
        ssh_dir.mkdir(mode=0o700, exist_ok=True)
        os.chown(ssh_dir, user.pw_uid, user.pw_gid)
        authorized = ssh_dir / "authorized_keys"
        ports = {"office": [2222, 18765], "pro6000": [2226], "pro6000-02": [2227]}[args.profile]
        options = ",".join(f'permitlisten="127.0.0.1:{port}"' for port in ports)
        line = "restrict,port-forwarding," + options + " " + key + "\n"
        if authorized.exists() and authorized.read_text() != line:
            raise RuntimeError("Existing tunnel key differs; preserve it for review")
        save(authorized, line, 0o600)
        os.chown(authorized, user.pw_uid, user.pw_gid)
        sshd = Path("/etc/ssh/sshd_config")
        original = sshd.read_text()
        block = template("cloud-sshd-match.conf")
        if marker not in original:
            old = backup(sshd)
            save(sshd, original.rstrip() + "\n\n" + block)
            try:
                run("/usr/sbin/sshd", "-t")
                run("systemctl", "reload", "ssh")
            except BaseException:
                save(sshd, original)
                run("/usr/sbin/sshd", "-t")
                raise
            print("sshd_backup", old)
        else:
            if block.strip() not in original:
                raise RuntimeError("Existing managed SSH block differs")
        print(fingerprint)
        print(run("/usr/sbin/sshd", "-T", "-C", f"user={ACCOUNT},host=office,addr=127.0.0.1"))

    elif args.phase == "office-start":
        ensure_user()
        if not args.host_key:
            raise RuntimeError("Supply the cloud host public key from a trusted login")
        host_key = args.host_key.read_text().strip().split()
        if len(host_key) < 2 or host_key[0] != "ssh-ed25519":
            raise RuntimeError("Unexpected host key format")
        CONF.mkdir(mode=0o755, exist_ok=True)
        CONF.chmod(0o755)
        save(CONF / "known_hosts", "49.232.60.144 " + " ".join(host_key[:2]) + "\n")
        save(CONF / "ssh_config", template("ssh_config"))
        unit = Path("/etc/systemd/system") / UNIT
        if unit.exists():
            backup(unit)
        unit_template = (
            "gaasd-pro6000-tunnel.service" if args.profile.startswith("pro6000") else UNIT
        )
        save(unit, template(unit_template))
        run("systemd-analyze", "verify", str(unit))
        run("systemctl", "daemon-reload")
        run("systemctl", "enable", "--now", UNIT)
        print(run("systemctl", "is-enabled", UNIT))
        print(run("systemctl", "is-active", UNIT))

    elif args.phase == "cloud-web":
        # Refuse to publish a known-broken upstream.
        import urllib.request

        with urllib.request.urlopen("http://127.0.0.1:18765/api/status", timeout=10) as response:
            if response.status != 200 or json.load(response)["hostname"] != "tsari":
                raise RuntimeError("Unexpected office upstream")
        site = Path("/etc/nginx/sites-available/gaasd-test")
        snippet = Path("/etc/nginx/snippets/gaasd-status2.conf")
        old_site = site.read_text()
        old_snippet = snippet.read_text() if snippet.exists() else None
        include = "    include /etc/nginx/snippets/gaasd-status2.conf;"
        marker = "    include /etc/nginx/snippets/gaasd-analytics.conf;"
        if include in old_site:
            updated = old_site
        elif old_site.count(marker) == 1:
            updated = old_site.replace(marker, marker + "\n" + include)
        else:
            raise RuntimeError("Unexpected production Nginx layout")
        saved = backup(site)
        if snippet.exists():
            backup(snippet)
        try:
            save(snippet, (args.source / "nginx-status2.conf").read_text())
            save(site, updated)
            run("nginx", "-t")
            run("systemctl", "reload", "nginx")
        except BaseException:
            save(site, old_site)
            if old_snippet is None:
                snippet.unlink(missing_ok=True)
            else:
                save(snippet, old_snippet)
            run("nginx", "-t")
            run("systemctl", "reload", "nginx")
            raise
        print("nginx_backup", saved)
        print("Published /status2/ with shared status authentication")


if __name__ == "__main__":
    main()
