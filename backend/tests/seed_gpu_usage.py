"""Synthetic local-browser history only; never invoked by production collectors."""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gpu_usage import UsageStore  # noqa: E402

root = Path(__file__).resolve().parents[2] / "work/status-test-fixtures/intranet"
path = root / "gpu-usage.sqlite3"
# The fixture path is fixed to ignored work/, never a production data path.
for name in [path, path.with_name(path.name + "-wal"), path.with_name(path.name + "-shm")]:
    name.unlink(missing_ok=True)
store = UsageStore(path)
data = json.loads((root / "latest.json").read_text(encoding="utf-8"))
for day in range(13, -1, -1):
    if day == 3:
        continue
    for offset in [60, 30, 0]:
        data["generated_at"] = time.time() - day * 86400 - offset
        for device in data["gpu"]["devices"]:
            device["utilization_percent"] = 20 + (13 - day) * 5
            device["memory_used"] = (12 + day * 2) * 1024**3
        store.record(data)
