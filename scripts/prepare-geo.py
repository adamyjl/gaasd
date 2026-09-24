"""Download a pinned official offline IP dataset, including its license."""

import hashlib
import json
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "backend" / "geo-data"
root.mkdir(parents=True, exist_ok=True)
request = urllib.request.Request(
    "https://api.github.com/repos/lionsoul2014/ip2region/commits/master",
    headers={"User-Agent": "GAASD-build"},
)
with urllib.request.urlopen(request, timeout=40) as response:
    revision = json.load(response)["sha"]
manifest = {
    "project": "https://github.com/lionsoul2014/ip2region",
    "revision": revision,
    "files": {},
}
for name in ["data/ip2region_v4.xdb", "data/ip2region_v6.xdb", "LICENSE.md"]:
    url = f"https://raw.githubusercontent.com/lionsoul2014/ip2region/{revision}/{name}"
    destination = root / Path(name).name
    with urllib.request.urlopen(url, timeout=120) as response:
        content = response.read()
    destination.write_bytes(content)
    manifest["files"][destination.name] = {
        "bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "url": url,
    }
    print(f"Downloaded {destination.name}: {len(content)} bytes")
(root / "source.json").write_text(json.dumps(manifest, indent=2) + "\n")
