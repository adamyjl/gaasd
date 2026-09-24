"""Verify every file and certificate symlink in a GAASD backup archive."""

import argparse
import json

from backup_common import digest, verify_archive

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("archive")
args = parser.parse_args()
print(
    json.dumps(
        {**verify_archive(args.archive), "sha256": digest(args.archive)},
        ensure_ascii=False,
        indent=2,
    )
)
