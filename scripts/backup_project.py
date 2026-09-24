"""Create a standalone source/media backup, omitting dependencies and transient work."""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from backup_common import create_archive

ROOT = Path(__file__).resolve().parents[1]
DIRECTORIES = ("site", "backend", "scripts", "tests", "docs", "GAASD-Tutorial")
EXCLUDED = {"__pycache__", ".pytest_cache", ".ruff_cache"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    files = {}
    for p in ROOT.iterdir():
        if p.is_file() and (
            p.suffix.lower() in {".md", ".mjs", ".json", ".toml", ".png", ".jpg", ".pdf"}
            or p.name == ".gitignore"
        ):
            files[f"project/{p.name}"] = p
    for directory in DIRECTORIES:
        for p in (ROOT / directory).rglob("*"):
            if p.is_file() and not EXCLUDED.intersection(p.relative_to(ROOT).parts):
                if p.is_symlink():
                    raise ValueError(f"Unexpected source symlink: {p}")
                files["project/" + p.relative_to(ROOT).as_posix()] = p
    if (ROOT / "dist/asset-manifest.json").exists():
        files["project/release-asset-manifest.json"] = ROOT / "dist/asset-manifest.json"
    print(f"Archiving {len(files)} project files...", flush=True)
    result = create_archive(
        args.output,
        files,
        {
            "kind": "GAASD project source and media",
            "created_at_utc": datetime.now(timezone.utc).isoformat(),
            "source_root": str(ROOT),
            "excludes": [
                "node_modules",
                ".tools",
                "dist (except asset manifest)",
                "work",
                "test reports",
                "Python caches",
            ],
            "restore": "Extract into a new directory; project/ contains the complete source and runtime media. See project/README.md and project/BACKUP.md.",
        },
    )
    args.output.with_name(args.output.name + ".json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
