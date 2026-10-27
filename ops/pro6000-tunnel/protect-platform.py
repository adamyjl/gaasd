"""Preserve the installed PRO 6000 kernel/driver; do not install or upgrade packages.

Run as root only when the operator has explicitly requested a fixed platform.
Other software security updates remain enabled. Backups include prior APT holds.
"""

import datetime
import fnmatch
import json
import os
import platform
import re
import shutil
import subprocess
from pathlib import Path

PATTERNS = (
    "base-files",
    "linux-image*",
    "linux-headers*",
    "linux-modules*",
    "linux-generic*",
    "linux-hwe*",
    "linux-oem*",
    "linux-signed*",
    "linux-virtual*",
    "linux-lowlatency*",
    "linux-azure*",
    "linux-aws*",
    "linux-gcp*",
    "linux-tools-[0-9]*",
    "linux-firmware*",
    "nvidia-*",
    "libnvidia-*",
    "xserver-xorg-video-nvidia-*",
    "cuda-drivers*",
)


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def main():
    if os.geteuid() != 0:
        raise SystemExit("Root required")
    os.umask(0o077)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = Path("/var/backups/gaasd-pro6000-platform") / stamp
    backup.mkdir(parents=True, mode=0o700)
    packages = run("dpkg-query", "-W", "-f=${binary:Package}\t${Version}\t${db:Status-Status}\n")
    installed = [line.split("\t") for line in packages.splitlines() if line.endswith("\tinstalled")]
    protected = [
        row[0]
        for row in installed
        if any(fnmatch.fnmatchcase(row[0].split(":")[0], pattern) for pattern in PATTERNS)
    ]
    if not any(name.startswith("linux-image-") for name in protected):
        raise RuntimeError("No packaged kernel found; inspect before protecting")
    record = {
        "kernel": platform.release(),
        "holds_before": run("apt-mark", "showhold").splitlines(),
        "protected_packages": protected,
        "installed_before": installed,
        "files_before": {},
    }
    release = Path("/etc/update-manager/release-upgrades")
    old = release.read_text()
    if not re.search(r"(?m)^Prompt=", old):
        raise RuntimeError("Unexpected release-upgrades format")

    def save_record():
        (backup / "record.json").write_text(json.dumps(record, indent=2) + "\n")

    save_record()

    def save(path, content):
        path = Path(path)
        record["files_before"][str(path)] = path.exists()
        if path.exists():
            target = backup / path.relative_to("/")
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            target.chmod(0o600)
        save_record()
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + ".gaasd-next")
        temporary.write_text(content)
        temporary.chmod(0o644)
        os.replace(temporary, path)

    save(
        "/etc/apt/preferences.d/99-gaasd-pro6000-platform",
        "# Explicit fixed-platform policy; see deployment record before removing.\n"
        + "Package: "
        + " ".join(PATTERNS)
        + "\nPin: version *\nPin-Priority: -1\n",
    )
    # APT config strings use regex; these prefixes also block newly named kernels.
    exclusions = "\n".join(
        '    "' + p + '";'
        for p in (
            "^base-files$",
            "^linux-image",
            "^linux-headers",
            "^linux-modules",
            "^linux-generic",
            "^linux-hwe",
            "^linux-oem",
            "^linux-signed",
            "^linux-virtual",
            "^linux-lowlatency",
            "^linux-azure",
            "^linux-aws",
            "^linux-gcp",
            "^linux-tools-[0-9]",
            "^linux-firmware",
            "^nvidia-",
            "^libnvidia-",
            "^xserver-xorg-video-nvidia-",
            "^cuda-drivers",
        )
    )
    save(
        "/etc/apt/apt.conf.d/99-gaasd-pro6000-platform",
        "// Preserve kernel, firmware and GPU driver; other update policy is unchanged.\n"
        + "Unattended-Upgrade::Package-Blacklist {\n"
        + exclusions
        + "\n};\n"
        + 'Unattended-Upgrade::Automatic-Reboot "false";\n'
        + 'Unattended-Upgrade::Remove-Unused-Kernel-Packages "false";\n',
    )
    save(release, re.sub(r"(?m)^Prompt=.*$", "Prompt=never", old))
    run("apt-mark", "hold", *protected)
    run("apt-config", "dump")
    record["holds_after"] = run("apt-mark", "showhold").splitlines()
    save_record()
    print(
        json.dumps(
            {
                "backup": str(backup),
                "kernel": platform.release(),
                "protected_count": len(protected),
                "release_upgrade": "never",
                "packages_installed_or_upgraded": 0,
            }
        )
    )


if __name__ == "__main__":
    main()
