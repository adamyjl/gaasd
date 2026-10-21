"""Fixed host registry and read-only views of cloud-local monitoring caches."""

import json
import math
import time
from pathlib import Path

HOSTS = {
    "cloud": dict(
        name="清华腾讯云服务器",
        address="49.232.60.144",
        group="中转机器",
        href="/status?server=cloud",
        expected_gpus=0,
    ),
    "intranet": dict(
        name="清华 · 8×A100",
        address="192.168.2.201",
        group="GPU 服务器",
        href="/status?server=intranet",
        expected_gpus=8,
    ),
    "office": dict(
        name="研究院办公室 · Ubuntu 3060 Ti",
        address="192.168.0.37",
        group="开发机器",
        href="/status1/host?server=office",
        expected_gpus=1,
    ),
    "windows": dict(
        name="研究院 Windows 中转机",
        address="DESKTOP-9TOSVU4",
        group="中转机器",
        href="/status3",
        expected_gpus=1,
    ),
    "rtx5090": dict(
        name="研究院 · 8×RTX 5090",
        address="192.168.1.111",
        group="GPU 服务器",
        href="/status4?server=rtx5090",
        expected_gpus=8,
    ),
    "rtx4090": dict(
        name="研究院 · 8×RTX 4090",
        address="192.168.1.19",
        group="GPU 服务器",
        href="/status4?server=rtx4090",
        expected_gpus=8,
    ),
    "pro6000": dict(
        name="清华办公室 · RTX PRO 6000",
        address="ThinkStation P3 Tower Gen 2",
        group="开发机器",
        href="/status5",
        expected_gpus=1,
    ),
}
TARGETS = {
    "office": ("tsari", "127.0.0.1", 2222),
    "windows": ("tsari", "127.0.0.1", 2224),
    "rtx5090": ("user001", "127.0.0.1", 2223),
    "rtx4090": ("centos", "127.0.0.1", 2225),
    "pro6000": ("lenovo", "127.0.0.1", 2226),
}


def directory(root, host):
    if host not in HOSTS:
        raise ValueError("Unknown host")
    return Path(root) if host == "cloud" else Path(root) / host


def read_cached(root, host, history=False, now=None):
    now = time.time() if now is None else now
    folder = directory(root, host)
    data = json.loads(
        (folder / ("history.json" if history else "latest.json")).read_text(encoding="utf-8-sig")
    )
    stamp = data["generated_at"]
    if (
        not isinstance(stamp, (int, float))
        or isinstance(stamp, bool)
        or not math.isfinite(stamp)
        or stamp <= 0
        or stamp > now + 30
    ):
        raise ValueError("Invalid sample time")
    connection = None
    if host != "cloud":
        try:
            connection = json.loads((folder / "connection.json").read_text(encoding="utf-8"))
            if not isinstance(connection, dict):
                connection = None
        except (OSError, ValueError):
            pass
    age = max(0, now - stamp)
    data.update(
        server=dict(id=host, **HOSTS[host]),
        age_seconds=round(age, 1),
        stale=age > (180 if history else 90) or bool(connection and not connection.get("ok")),
        connection=connection,
    )
    return data


def overview(root):
    now = time.time()
    hosts = []
    for key in ("intranet", "rtx4090", "rtx5090", "cloud", "office", "windows", "pro6000"):
        try:
            data = read_cached(root, key, now=now)
            # No process arguments, environment, log contents or credentials.
            hosts.append(
                {
                    field: data.get(field)
                    for field in (
                        "server",
                        "generated_at",
                        "age_seconds",
                        "stale",
                        "connection",
                        "host",
                        "cpu",
                        "memory",
                        "swap",
                        "gpu",
                        "filesystems",
                        "disk_io",
                        "network",
                        "processes",
                        "hardware",
                        "temperatures",
                        "latency",
                    )
                }
            )
        except (OSError, ValueError, KeyError, TypeError):
            hosts.append(
                dict(
                    server=dict(id=key, **HOSTS[key]),
                    stale=True,
                    unavailable=True,
                    message="尚无有效采样；不计入在线资源汇总。",
                )
            )
    try:
        latency = json.loads((Path(root) / "fleet-latency.json").read_text())
    except (OSError, ValueError):
        latency = {}
    for host in hosts:
        if host["server"]["id"] in latency:
            host["latency"] = latency[host["server"]["id"]]
    return dict(generated_at=now, interval_seconds=30, hosts=hosts)
