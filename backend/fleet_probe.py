"""One bounded read-only Linux sample, available only to a forced SSH key."""

import argparse
import json
import os
import re
import subprocess
import sys
import time

from status_collector import Sampler


def cloud_ping():
    result = dict(kind="icmp", direction="本机 → 腾讯云公网", checked_at=time.time(), rtt_ms=None)
    try:
        ping = subprocess.run(
            ["ping", "-n", "-c", "2", "-W", "2", "49.232.60.144"],
            capture_output=True,
            text=True,
            timeout=5,
            env={**os.environ, "LC_ALL": "C"},
        )
        match = re.search(r"=\s*[\d.]+/([\d.]+)/", ping.stdout)
        if ping.returncode == 0 and match:
            result["rtt_ms"] = float(match[1])
    except (OSError, subprocess.SubprocessError):
        pass
    return result


def main():
    if os.environ.get("SSH_ORIGINAL_COMMAND") == "workloads":
        from workload_probe import sample

        print(json.dumps(sample(), ensure_ascii=True, allow_nan=False))
        return
    parser = argparse.ArgumentParser()
    parser.add_argument("--gpus", type=int, choices=(1, 8), default=8)
    args = parser.parse_args()
    if os.environ.get("SSH_ORIGINAL_COMMAND") != "snapshot":
        raise SystemExit("Only snapshot is permitted.")
    sampler = Sampler(None, profile="intranet")
    sampler.sample()
    time.sleep(1)
    data = sampler.sample()
    gpu = data.get("gpu") or {}
    gpu["expected_count"] = args.gpus
    if gpu.get("available"):
        gpu["note"] = None if len(gpu["devices"]) == args.gpus else "GPU 数量与登记配置不一致。"
    data["latency"] = cloud_ping()
    json.dump(data, sys.stdout, ensure_ascii=True, allow_nan=False)
    print()


if __name__ == "__main__":
    main()
