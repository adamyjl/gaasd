"""Read-only, bounded NVIDIA telemetry. Unsupported values remain unknown."""

import csv
import math
import subprocess
from pathlib import Path

GPU_FIELDS = (
    "index,uuid,name,pci.bus_id,driver_version,utilization.gpu,utilization.memory,"
    "memory.total,memory.used,memory.free,temperature.gpu,power.draw,power.limit,fan.speed,pstate"
)


def numeric(value, multiplier=1):
    try:
        number = float(value.strip()) * multiplier
        return number if math.isfinite(number) and number >= 0 else None
    except ValueError:
        return None


def parse_gpus(text):
    devices = []
    for row in csv.reader(text.splitlines(), skipinitialspace=True):
        if not row:
            continue
        if len(row) != 15 or not row[1].startswith("GPU-"):
            raise ValueError("Unexpected NVIDIA GPU response")
        devices.append(
            dict(
                index=int(row[0]),
                uuid=row[1],
                name=row[2],
                pci_bus=row[3],
                driver=row[4],
                utilization_percent=numeric(row[5]),
                memory_activity_percent=numeric(row[6]),
                memory_total=numeric(row[7], 1024**2),
                memory_used=numeric(row[8], 1024**2),
                memory_free=numeric(row[9], 1024**2),
                temperature_c=numeric(row[10]),
                power_w=numeric(row[11]),
                power_limit_w=numeric(row[12]),
                fan_percent=numeric(row[13]),
                performance_state=row[14].strip(),
            )
        )
    if len({g["index"] for g in devices}) != len(devices):
        raise ValueError("Duplicate GPU index")
    return sorted(devices, key=lambda g: g["index"])


def query(fields, kind="gpu"):
    result = subprocess.run(
        ["nvidia-smi", f"--query-{kind}={fields}", "--format=csv,noheader,nounits"],
        capture_output=True,
        text=True,
        timeout=5,
        check=True,
    )
    return result.stdout


def collect_gpus():
    try:
        devices = parse_gpus(query(GPU_FIELDS))
    except (OSError, ValueError, subprocess.SubprocessError):
        return dict(
            available=False,
            expected_count=8,
            devices=[],
            processes=[],
            note="GPU 采集暂不可用，请检查 NVIDIA 驱动或采集权限。",
        )
    processes = []
    process_note = None
    try:
        for row in csv.reader(
            query("gpu_uuid,pid,process_name,used_memory", "compute-apps").splitlines(),
            skipinitialspace=True,
        ):
            if not row:
                continue
            if len(row) != 4:
                raise ValueError("Unexpected NVIDIA process response")
            processes.append(
                dict(
                    gpu_uuid=row[0],
                    pid=int(row[1]),
                    name=Path(row[2]).name,
                    memory_used=numeric(row[3], 1024**2),
                )
            )
    except (OSError, ValueError, subprocess.SubprocessError):
        processes = []
        process_note = "GPU 进程信息暂不可用。"
    return dict(
        available=True,
        expected_count=8,
        devices=devices,
        processes=processes,
        process_note=process_note,
        note=None if len(devices) == 8 else f"预期 8 张 GPU，当前读取到 {len(devices)} 张。",
    )
