"""Parallel bounded polling of fixed SSH endpoints; no web-facing shell."""

import argparse
import json
import math
import os
import re
import sqlite3
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fleet import HOSTS, TARGETS
from gpu_usage import UsageStore
from status_collector import INTERVAL, Sampler, atomic_json


def fetch_snapshot(host, config):
    user, address, port = TARGETS[host]
    command = [
        "ssh",
        "-F",
        "/dev/null",
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "ConnectTimeout=5",
        "-o",
        "ServerAliveInterval=5",
        "-o",
        "ServerAliveCountMax=1",
        "-o",
        "LogLevel=ERROR",
        "-o",
        f"UserKnownHostsFile={config['known_hosts']}",
        "-i",
        config["identity_file"],
        "-p",
        str(port),
        f"{user}@{address}",
        "snapshot",
    ]
    started = time.monotonic()
    result = subprocess.run(command, capture_output=True, text=True, timeout=26, check=True)
    if len(result.stdout) > 2_000_000:
        raise ValueError("Oversized sample")
    data = json.loads(result.stdout.lstrip("\ufeff"))
    stamp = data.get("generated_at") if isinstance(data, dict) else None
    if (
        not isinstance(stamp, (int, float))
        or isinstance(stamp, bool)
        or not math.isfinite(stamp)
        or not -30 <= time.time() - stamp < 90
    ):
        raise ValueError("Expired/invalid sample")
    for field in ("host", "cpu", "memory", "swap", "filesystems", "network", "processes", "gpu"):
        if field not in data:
            raise ValueError("Incomplete sample")
    data.setdefault("latency", {})
    data["latency"]["collection_ms"] = round((time.monotonic() - started) * 1000, 1)
    data["latency"]["collection_note"] = "腾讯云经 SSH 读取采样耗时，含握手与采集，不是 ICMP ping"
    return data


def poll(host, sampler, config):
    try:
        data = fetch_snapshot(host, config)
        sampler.publish(data)
        atomic_json(
            sampler.directory / "connection.json",
            dict(ok=True, checked_at=time.time(), message=None),
        )
        if HOSTS[host]["expected_gpus"] == 8:
            try:
                UsageStore(sampler.directory / "gpu-usage.sqlite3").record(data)
            except (OSError, ValueError, TypeError, sqlite3.Error) as error:
                print(f"{host}: history persistence {type(error).__name__}", flush=True)
        return True
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        atomic_json(
            sampler.directory / "connection.json",
            dict(
                ok=False,
                checked_at=time.time(),
                message="采集连接中断或采样过期，请检查目标机器、Windows 中转与 SSH；保留最后成功样本。",
            ),
        )
        print(f"{host}: {type(error).__name__}", flush=True)
        return False


def vpn_ping(root):
    data = {
        "cloud": dict(
            kind="local", direction="采集基准：腾讯云本机", rtt_ms=None, checked_at=time.time()
        ),
        "intranet": dict(
            kind="icmp", direction="腾讯云 → A100（OpenVPN）", rtt_ms=None, checked_at=time.time()
        ),
    }
    try:
        result = subprocess.run(
            ["ping", "-n", "-c", "2", "-W", "2", "192.168.2.201"],
            capture_output=True,
            text=True,
            timeout=5,
            env={**os.environ, "LC_ALL": "C"},
        )
        match = re.search(r"=\s*[\d.]+/([\d.]+)/", result.stdout)
        if result.returncode == 0 and match:
            data["intranet"]["rtt_ms"] = float(match[1])
    except (OSError, subprocess.SubprocessError):
        pass
    atomic_json(root / "fleet-latency.json", data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="/etc/gaasd-analytics/fleet.json")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    root = Path(config["directory"])
    samplers = {host: Sampler(root / host, profile="intranet") for host in TARGETS}
    with ThreadPoolExecutor(max_workers=len(TARGETS) + 1) as pool:
        while True:
            started = time.monotonic()
            futures = [
                pool.submit(poll, host, sampler, config["hosts"][host])
                for host, sampler in samplers.items()
            ]
            ping = pool.submit(vpn_ping, root)
            ok = all([future.result() for future in futures])
            ping.result()
            if args.once:
                raise SystemExit(0 if ok else 1)
            time.sleep(max(1, INTERVAL - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
