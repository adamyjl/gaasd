"""Forced-command SSH endpoint: one read-only sample, no shell or arbitrary arguments."""

import json
import os
import sys
import time

from status_collector import Sampler


def main():
    if os.environ.get("SSH_ORIGINAL_COMMAND") != "snapshot":
        raise SystemExit("Only the status snapshot command is permitted.")
    sampler = Sampler(None, profile="intranet")
    sampler.sample()
    time.sleep(1)
    json.dump(sampler.sample(), sys.stdout, ensure_ascii=False, allow_nan=False)
    print()


if __name__ == "__main__":
    main()
