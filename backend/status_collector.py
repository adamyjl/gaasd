"""Single unprivileged host sampler. No web requests execute host commands."""

import argparse
import json
import os
import platform
import re
import socket
import ssl
import subprocess
import time
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

import psutil

INTERVAL = 5
SERVICES = [
    "nginx.service",
    "ssh.service",
    "gaasd-analytics.service",
    "gaasd-status-collector.service",
    "gaasd-analytics-backup.timer",
    "certbot.timer",
]


def rate(current, previous, elapsed):
    if previous is None or elapsed <= 0 or current < previous:
        return None
    return round((current - previous) / elapsed, 6)


def cpu_usage(current, previous):
    if previous is None:
        return None
    delta = {
        key: max(0, value - previous.get(key, value))
        for key, value in current.items()
        if key not in {"guest", "guest_nice"}
    }
    total = sum(delta.values())
    if total <= 0:
        return None
    return {
        "percent": round(100 * (total - delta.get("idle", 0) - delta.get("iowait", 0)) / total, 1),
        "iowait": round(100 * delta.get("iowait", 0) / total, 1),
        "steal": round(100 * delta.get("steal", 0) / total, 1),
    }


def atomic_json(path, data):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    temp.chmod(0o600)
    os.replace(temp, path)


def parse_mounts(text):
    def unescape(value):
        return re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), value)

    return [
        SimpleNamespace(device=unescape(parts[0]), mountpoint=unescape(parts[1]), fstype=parts[2])
        for line in text.splitlines()
        if len(parts := line.split()) >= 3
    ]


def host_partitions():
    # PID 1 stays in the host namespace; systemd hardening adds private bind mounts.
    try:
        return parse_mounts(Path("/proc/1/mounts").read_text())
    except OSError:
        return psutil.disk_partitions(all=True)


def filesystem_rows():
    rows, seen = [], set()
    for part in host_partitions():
        remote = part.fstype == "fuse" or part.fstype.startswith(("fuse.", "nfs", "cifs", "smb"))
        if part.mountpoint in seen or not (
            part.device.startswith("/dev/") or remote or part.fstype in {"tmpfs", "overlay"}
        ):
            continue
        if part.device.startswith("/dev/loop"):
            continue
        seen.add(part.mountpoint)
        row = dict(
            device=part.device,
            mount=part.mountpoint,
            filesystem=part.fstype,
            kind="remote" if remote else "memory" if part.fstype == "tmpfs" else "local",
        )
        if remote:
            row["note"] = "远程挂载；不计入本机磁盘，不主动探测容量"
        else:
            try:
                row.update(psutil.disk_usage(part.mountpoint)._asdict())
                stat = os.statvfs(part.mountpoint)
                row.update(
                    inodes_total=stat.f_files,
                    inodes_free=stat.f_favail,
                    inode_percent=round(100 * (stat.f_files - stat.f_favail) / stat.f_files, 1)
                    if stat.f_files
                    else None,
                )
            except (OSError, AttributeError):
                row["note"] = "当前权限下无法读取容量"
        rows.append(row)
    return sorted(rows, key=lambda row: (row["mount"] != "/", row["kind"], row["mount"]))


def pressure():
    result = {}
    for resource in ["cpu", "memory", "io"]:
        try:
            result[resource] = {
                line.split()[0]: {
                    key: float(value)
                    for key, value in (item.split("=") for item in line.split()[1:])
                    if key != "total"
                }
                for line in Path(f"/proc/pressure/{resource}").read_text().splitlines()
            }
        except (OSError, ValueError):
            result[resource] = None
    return result


def tcp_summary():
    counts, ports = Counter(), set()
    names = {"01": "established", "0A": "listen", "06": "time_wait", "08": "close_wait"}
    available = False
    for name in ["tcp", "tcp6"]:
        try:
            for line in Path(f"/proc/net/{name}").read_text().splitlines()[1:]:
                fields = line.split()
                counts[names.get(fields[3], "other")] += 1
                if fields[3] == "0A":
                    ports.add(int(fields[1].split(":")[1], 16))
            available = True
        except (OSError, ValueError, IndexError):
            pass
    return dict(states=dict(counts), listen_ports=sorted(ports)) if available else None


def service_rows():
    try:
        result = subprocess.run(
            [
                "systemctl",
                "show",
                *SERVICES,
                "--no-pager",
                "--property=Id,ActiveState,SubState,UnitFileState,Result,NextElapseUSecRealtime",
            ],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
        if result.returncode:
            return []
        return [
            dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
            for block in result.stdout.strip().split("\n\n")
        ]
    except (OSError, subprocess.TimeoutExpired):
        return []


def certificate():
    try:
        with socket.create_connection(("127.0.0.1", 443), timeout=2) as connection:
            with ssl.create_default_context().wrap_socket(
                connection, server_hostname="gaasd.com"
            ) as secure:
                cert = secure.getpeercert()
        expires = ssl.cert_time_to_seconds(cert["notAfter"])
        return dict(valid=True, expires_at=expires, days_left=int((expires - time.time()) / 86400))
    except (OSError, ValueError, KeyError):
        return dict(valid=False, note="本机 HTTPS 证书校验未通过或连接不可用")


def slow_details():
    try:
        backups = list(Path("/var/lib/gaasd-analytics/backups").glob("analytics-*.sqlite3"))
        latest = max(backups, key=lambda item: item.stat().st_mtime) if backups else None
        backup = (
            dict(
                updated_at=latest.stat().st_mtime, bytes=latest.stat().st_size, copies=len(backups)
            )
            if latest
            else None
        )
    except OSError:
        backup = None
    try:
        sensors = {
            name: [item._asdict() for item in values]
            for name, values in psutil.sensors_temperatures().items()
        }
    except (AttributeError, OSError):
        sensors = {}
    return dict(
        checked_at=time.time(),
        services=service_rows(),
        certificate=certificate(),
        backup=backup,
        temperatures=sensors,
    )


class Sampler:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.previous = None
        self.details = {}
        self.bucket = []
        self.history = []
        try:
            self.history = json.loads(
                (self.directory / "history.json").read_text(encoding="utf-8")
            )["points"]
        except (OSError, ValueError, KeyError):
            pass
        self.history = [
            row for row in self.history if time.time() - 86400 <= row["timestamp"] <= time.time()
        ]
        self.last_history = 0
        self.started_at = time.time()

    def sample(self):
        now, mono = time.time(), time.monotonic()
        previous = self.previous or {}
        elapsed = mono - previous.get("mono", mono)
        cores = [core._asdict() for core in psutil.cpu_times(percpu=True)]
        old_cores = previous.get("cores", [])
        cpu = [
            dict(
                index=index,
                **(
                    cpu_usage(core, old_cores[index] if index < len(old_cores) else None)
                    or dict(percent=None, iowait=None, steal=None)
                ),
            )
            for index, core in enumerate(cores)
        ]
        cpu_percent = (
            round(sum(row["percent"] for row in cpu) / len(cpu), 1)
            if cpu and all(row["percent"] is not None for row in cpu)
            else None
        )
        net = {name: value._asdict() for name, value in psutil.net_io_counters(pernic=True).items()}
        nic_stats = psutil.net_if_stats()
        nic_addrs = psutil.net_if_addrs()
        network = []
        for name, counters in net.items():
            old = previous.get("net", {}).get(name, {})
            nic = nic_stats.get(name)
            network.append(
                dict(
                    name=name,
                    is_up=nic.isup if nic else None,
                    mtu=nic.mtu if nic else None,
                    addresses=[
                        a.address
                        for a in nic_addrs.get(name, [])
                        if a.family in {socket.AF_INET, socket.AF_INET6}
                    ],
                    rx_rate=rate(counters["bytes_recv"], old.get("bytes_recv"), elapsed),
                    tx_rate=rate(counters["bytes_sent"], old.get("bytes_sent"), elapsed),
                    **counters,
                )
            )
        disks = {
            name: value._asdict()
            for name, value in (psutil.disk_io_counters(perdisk=True) or {}).items()
            if Path(f"/sys/block/{name}").exists() and not name.startswith(("loop", "ram"))
        }
        disk_io = []
        for name, counters in disks.items():
            old = previous.get("disks", {}).get(name, {})
            busy = rate(counters.get("busy_time", 0), old.get("busy_time"), elapsed)
            disk_io.append(
                dict(
                    name=name,
                    read_rate=rate(counters["read_bytes"], old.get("read_bytes"), elapsed),
                    write_rate=rate(counters["write_bytes"], old.get("write_bytes"), elapsed),
                    read_iops=rate(counters["read_count"], old.get("read_count"), elapsed),
                    write_iops=rate(counters["write_count"], old.get("write_count"), elapsed),
                    busy_percent=min(100, busy / 10) if busy is not None else None,
                )
            )
        proc_values, processes, states = {}, [], Counter()
        for proc in psutil.process_iter(
            ["pid", "name", "status", "memory_info", "cpu_times", "create_time"], ad_value=None
        ):
            info = proc.info
            states[info["status"] or "unknown"] += 1
            if info["cpu_times"] is None or info["memory_info"] is None:
                continue
            identity = (info["pid"], info["create_time"])
            value = info["cpu_times"].user + info["cpu_times"].system
            proc_values[identity] = value
            usage = rate(value, previous.get("processes", {}).get(identity), elapsed)
            processes.append(
                dict(
                    pid=info["pid"],
                    name=info["name"] or "未知进程",
                    state=info["status"],
                    rss=info["memory_info"].rss,
                    cpu_percent=min(100, round(usage * 100 / max(len(cores), 1), 1))
                    if usage is not None
                    else None,
                )
            )
        top_cpu = sorted(processes, key=lambda p: p["cpu_percent"] or 0, reverse=True)[:8]
        top_memory = sorted(processes, key=lambda p: p["rss"], reverse=True)[:8]
        top = {p["pid"]: p for p in top_cpu + top_memory}
        memory = psutil.virtual_memory()._asdict()
        memory["in_use"] = memory["total"] - memory["available"]
        swap = psutil.swap_memory()._asdict()
        swap["in_rate"] = rate(swap["sin"], previous.get("swap", {}).get("sin"), elapsed)
        swap["out_rate"] = rate(swap["sout"], previous.get("swap", {}).get("sout"), elapsed)
        if now - self.details.get("checked_at", 0) >= 60:
            self.details = slow_details()
        try:
            distro = platform.freedesktop_os_release().get("PRETTY_NAME", platform.system())
        except (OSError, AttributeError):
            distro = platform.platform()
        try:
            frequency = psutil.cpu_freq()
        except (OSError, NotImplementedError):
            frequency = None
        try:
            fd = [int(value) for value in Path("/proc/sys/fs/file-nr").read_text().split()]
            files = dict(open=fd[0] - fd[1], limit=fd[2])
        except (OSError, ValueError):
            files = None
        snapshot = dict(
            generated_at=now,
            sample_seconds=round(elapsed, 2),
            interval_seconds=INTERVAL,
            collector_started_at=self.started_at,
            host=dict(
                name=socket.gethostname(),
                os=distro,
                kernel=platform.release(),
                architecture=platform.machine(),
                boot_time=psutil.boot_time(),
                uptime_seconds=int(now - psutil.boot_time()),
                logical_cpus=len(cores),
                physical_cpus=psutil.cpu_count(logical=False),
                frequency_mhz=frequency.current if frequency and frequency.current else None,
            ),
            cpu=dict(
                percent=cpu_percent,
                cores=cpu,
                load=list(os.getloadavg()) if hasattr(os, "getloadavg") else None,
            ),
            memory=memory,
            swap=swap,
            filesystems=filesystem_rows(),
            disk_io=disk_io,
            network=network,
            processes=dict(
                total=sum(states.values()),
                visible=len(processes),
                states=dict(states),
                top=list(top.values()),
            ),
            pressure=pressure(),
            tcp=tcp_summary(),
            files=files,
            **self.details,
        )
        self.previous = dict(
            mono=mono, cores=cores, net=net, disks=disks, processes=proc_values, swap=swap
        )
        atomic_json(self.directory / "latest.json", snapshot)
        if cpu_percent is not None:
            self.bucket.append(
                dict(
                    timestamp=now,
                    cpu=cpu_percent,
                    memory=memory["percent"],
                    swap=swap["percent"],
                    rx=sum(n["rx_rate"] or 0 for n in network if n["name"] != "lo"),
                    tx=sum(n["tx_rate"] or 0 for n in network if n["name"] != "lo"),
                )
            )
        if self.bucket and now - self.last_history >= 60:
            point = {
                key: round(sum(p[key] for p in self.bucket) / len(self.bucket), 2)
                for key in ["cpu", "memory", "swap", "rx", "tx"]
            }
            point["timestamp"] = now
            self.history.append(point)
            self.history = [row for row in self.history if now - 86400 <= row["timestamp"] <= now][
                -1440:
            ]
            atomic_json(
                self.directory / "history.json",
                dict(generated_at=now, aggregation_seconds=60, points=self.history),
            )
            self.last_history = now
            self.bucket.clear()
        return snapshot


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", default="/var/lib/gaasd-analytics/status")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    sampler = Sampler(args.directory)
    while True:
        started = time.monotonic()
        try:
            sampler.sample()
        except Exception as error:
            print(f"Status sample failed: {type(error).__name__}: {error}", flush=True)
            if args.once:
                raise
        if args.once:
            return
        time.sleep(max(0.25, INTERVAL - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
