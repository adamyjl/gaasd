"""Poll the fixed internal host over OpenVPN; HTTP handlers only read cached JSON."""

import argparse
import json
import sqlite3
import subprocess
import time
from pathlib import Path

from gpu_usage import UsageStore
from status_collector import INTERVAL, Sampler, atomic_json


def fetch_snapshot(config):
    result = subprocess.run(
        [
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
            "ConnectTimeout=6",
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
            "2202",
            "aiusr@192.168.2.201",
            "snapshot",
        ],
        capture_output=True,
        text=True,
        timeout=22,
        check=True,
    )
    if len(result.stdout) > 2_000_000:
        raise ValueError("Oversized status sample")
    data = json.loads(result.stdout)
    if not isinstance(data, dict) or not 0 <= time.time() - data["generated_at"] < 90:
        raise ValueError("Invalid or expired remote sample")
    for field in ["host", "cpu", "memory", "swap", "network", "gpu", "filesystems"]:
        if field not in data:
            raise ValueError("Incomplete remote sample")
    return data


def poll(sampler, config, usage=None):
    try:
        data = fetch_snapshot(config)
        sampler.publish(data)
        atomic_json(
            sampler.directory / "connection.json",
            dict(ok=True, checked_at=time.time(), message=None),
        )
        if usage is not None:
            try:
                usage.record(data)
            except (OSError, ValueError, TypeError, sqlite3.Error) as error:
                # A storage fault must not misreport healthy SSH/live collection.
                print(f"GPU usage persistence failed: {type(error).__name__}", flush=True)
        return True
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        # Do not replace a valid sample with fabricated zeros or reset its timestamp.
        atomic_json(
            sampler.directory / "connection.json",
            dict(
                ok=False,
                checked_at=time.time(),
                message="内网采集连接中断，请检查 OpenVPN、SSH 或内网服务器；显示最后一次成功采样。",
            ),
        )
        print(f"Internal status poll failed: {type(error).__name__}", flush=True)
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="/etc/gaasd-analytics/status-remote.json")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    sampler = Sampler(config["directory"], profile="intranet")
    usage = UsageStore(sampler.directory / "gpu-usage.sqlite3")
    while True:
        started = time.monotonic()
        ok = poll(sampler, config, usage)
        if args.once:
            raise SystemExit(0 if ok else 1)
        time.sleep(max(1, INTERVAL - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
