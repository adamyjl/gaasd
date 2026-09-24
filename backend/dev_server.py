"""Local test server only. Never used by the production systemd service."""

import os
import sys
from pathlib import Path

from app import create_app
from werkzeug.security import generate_password_hash

root = Path(__file__).resolve().parents[1]
app = create_app(
    {
        "database": str(root / "work" / "analytics-test.sqlite3"),
        "username": "qa",
        "password_hash": generate_password_hash("local-test-only"),
        "origins": ["http://127.0.0.1:4173"],
        "trusted_proxy": True,
        "geo_directory": str(root / "backend" / "geo-data"),
        "status_directory": os.environ.get(
            "GAASD_STATUS_DIRECTORY", str(root / "work" / "status-preview")
        ),
    }
)
if __name__ == "__main__":
    port = int(os.environ.get("GAASD_ANALYTICS_PORT", "4180"))
    if "--check" in sys.argv:
        print("Analytics configuration and IP database verified")
    else:
        app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
