"""One-off low-priority single-thread SHA-256 microbenchmark, ~2 seconds, 1 MiB."""

import hashlib
import json
import os
import platform
import ssl
import statistics
import time

try:
    os.nice(19)
except (AttributeError, OSError):
    pass
block = b"GAASD-benchmark" * 74899
block = block[:1048576]
rates = []
for _ in range(3):
    start = time.perf_counter()
    count = 0
    while time.perf_counter() - start < 0.6:
        hashlib.sha256(block).digest()
        count += 1
    rates.append(round(count * len(block) / 1048576 / (time.perf_counter() - start), 2))
print(
    json.dumps(
        dict(
            sampled_at=time.time(),
            sha256_mib_s=statistics.median(rates),
            samples=rates,
            runtime=platform.python_version() + " / " + ssl.OPENSSL_VERSION,
            method="SHA-256, 1 MiB buffer, single thread, 3 x 0.6 s; median MiB/s; low priority; under current load",
        )
    )
)
