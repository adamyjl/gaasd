"""Allow ICMP echo sockets for only the monitoring group, without raw-socket caps."""

import os
import pwd
import subprocess
from pathlib import Path


def main():
    if os.geteuid() != 0:
        raise SystemExit("Root required")
    gid = pwd.getpwnam("gaasd-analytics").pw_gid
    wanted = f"{gid} {gid}"
    current = " ".join(Path("/proc/sys/net/ipv4/ping_group_range").read_text().split())
    target = Path("/etc/sysctl.d/60-gaasd-monitor-ping.conf")
    content = f"# GAASD monitor only; previous kernel default: 1 0\nnet.ipv4.ping_group_range = {wanted}\n"
    if current not in {"1 0", wanted}:
        raise SystemExit("Existing ping policy differs; preserve it and review manually")
    if target.exists() and target.read_text() != content:
        raise SystemExit("Existing configuration differs; preserve it")
    target.write_text(content)
    target.chmod(0o644)
    subprocess.run(["sysctl", "-p", str(target)], check=True)


if __name__ == "__main__":
    main()
