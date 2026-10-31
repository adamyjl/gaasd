"""Authenticated, read-only performance views; never run inference on HTTP requests."""

import json
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fleet import overview

GPU_SPECS = [
    dict(
        match="A100-SXM4-80GB",
        label="A100 SXM4 80GB",
        fp32=19.5,
        vram=80,
        source="https://www.nvidia.com/en-us/data-center/a100/",
        note="厂商 FP32 CUDA 峰值；HBM2e / NVLink；不能用 FP32 顺序推断混合精度训练速度。",
    ),
    dict(
        match="RTX 5090",
        label="RTX 5090",
        fp32=104.88,
        vram=32,
        source="https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/",
        note="由官方 21,760 CUDA 核 × 2.41 GHz × 2 推算，参考 Boost 峰值。",
    ),
    dict(
        match="RTX 4090",
        label="RTX 4090",
        fp32=82.58,
        vram=24,
        source="https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4090/",
        note="由官方 16,384 CUDA 核 × 2.52 GHz × 2 推算，参考 Boost 峰值。",
    ),
    dict(
        match="RTX PRO 6000 Blackwell Max-Q",
        label="RTX PRO 6000 Max-Q",
        fp32=110,
        vram=96,
        source="https://www.nvidia.com/en-eu/products/workstations/professional-desktop-gpus/rtx-pro-6000-max-q/",
        note="Max-Q 版厂商 FP32 峰值，不能混用 600W 非 Max-Q 规格。",
    ),
    dict(
        match="RTX 3060 Ti",
        label="RTX 3060 Ti",
        fp32=16.25,
        vram=8,
        source="https://www.nvidia.com/en-us/geforce/graphics-cards/30-series/rtx-3060-3060ti/",
        note="参考公版 4,864 CUDA 核 × 1.67 GHz × 2；OEM 频率可不同。",
    ),
    dict(
        match="GTX 1060 3GB",
        label="GTX 1060 3GB",
        fp32=3.94,
        vram=3,
        source="https://www.nvidia.com/content/apac/event/ph/overwatch-campaign/geforce-gtx-1060.html",
        note="参考公版 1,152 CUDA 核 × 1.708 GHz × 2；非 6GB 版。",
    ),
]


def read(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def page_data(status_root, root, report_id=None):
    root = Path(root)
    if report_id is not None and not re.fullmatch(r"\d{10}", report_id):
        raise ValueError("Invalid report identifier")
    report = (
        read(root / "history" / (report_id + ".json")) if report_id else read(root / "latest.json")
    )
    if report_id and report is None:
        raise FileNotFoundError("Report not found")
    inventory = read(root / "inventory.json", {})
    benches = read(root / "cpu-benchmarks.json", {})
    hosts = []
    for item in overview(status_root)["hosts"]:
        key = item["server"]["id"]
        meta = inventory.get(key, {})
        host = item.get("host") or {}
        gpu = (item.get("gpu") or {}).get("devices") or []
        name = gpu[0].get("name", "") if gpu else meta.get("gpu_name", "")
        spec = next((s for s in GPU_SPECS if s["match"] in name), None)
        count = len(gpu) or meta.get("gpu_count", 0)
        hosts.append(
            dict(
                id=key,
                name=item["server"]["name"],
                group=item["server"]["group"],
                href=item["server"]["href"],
                stale=item["stale"],
                sampled_at=item.get("generated_at"),
                cpu_model=(item.get("hardware") or {}).get("cpu_model")
                or meta.get("cpu_model", "未知"),
                logical_cpus=host.get("logical_cpus") or meta.get("logical_cpus"),
                physical_cpus=host.get("physical_cpus") or meta.get("physical_cpus"),
                ram_gib=round(
                    (item.get("memory") or {}).get("total", meta.get("memory_total", 0)) / 2**30, 1
                ),
                gpu_count=count,
                gpu=spec,
                benchmark=benches.get(key),
                gpu_utilization=[d.get("utilization_percent") for d in gpu],
            )
        )
    history = sorted((root / "history").glob("[0-9]*.json"), reverse=True)[:336]
    month = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m")
    usage = read(root / "usage.json", {}).get(
        month, dict(calls=0, input_tokens=0, output_tokens=0, estimated_cny=0)
    )
    return dict(
        generated_at=time.time(),
        hosts=hosts,
        report=report,
        report_stale=not report or time.time() - report.get("generated_at", 0) > 2400,
        history=[p.stem for p in history],
        billing=dict(
            month=month,
            actual=usage,
            model="qwen3.7-plus",
            input_cny_per_million=2,
            output_cny_per_million=8,
            checked_on="2026-10-25",
            source="https://help.aliyun.com/zh/model-studio/model-pricing",
            calls_per_30_days=1440,
            assumed_input_per_call=8000,
            assumed_output_per_call=1800,
            note="北京按量原价估算，不含限时折扣/免费额度/缓存折扣；实际账单以百炼为准。每轮合并三台，不是每台一次。",
        ),
    )
