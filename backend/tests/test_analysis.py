import json
import time

import pytest
from analysis import page_data
from analysis_collector import record_usage, validate
from app import create_app
from werkzeug.security import generate_password_hash
from workload_probe import command_summary, safe_text


@pytest.fixture
def client(tmp_path):
    return create_app(
        dict(
            database=str(tmp_path / "visits.sqlite3"),
            username="qa",
            password_hash=generate_password_hash("test-only"),
            origins=["https://gaasd.com"],
            status_directory=str(tmp_path / "status"),
            analysis_directory=str(tmp_path / "analysis"),
        )
    ).test_client()


@pytest.mark.parametrize(
    "path",
    [
        "/analysis",
        "/analysis/",
        "/analysis/cpu",
        "/analysis/gpu",
        "/analysis/api/report",
        "/analysis/assets/analysis.js",
        "/analysis/assets/analysis.css",
    ],
)
def test_every_analysis_resource_uses_existing_auth(client, path):
    response = client.get(path)
    assert response.status_code == 401
    assert "GAASD Statistics" in response.headers["WWW-Authenticate"]
    assert client.get(path, auth=("qa", "wrong")).status_code == 401
    response = client.get(path, auth=("qa", "test-only"))
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert "script-src 'self'" in response.headers["Content-Security-Policy"]


def test_no_inference_write_route_or_arbitrary_asset(client):
    assert client.post("/analysis/api/report", auth=("qa", "test-only")).status_code == 405
    assert client.get("/analysis/assets/app.py", auth=("qa", "test-only")).status_code == 404
    assert (
        client.get("/analysis/api/report?id=../../config", auth=("qa", "test-only")).status_code
        == 400
    )
    assert (
        client.get("/analysis/api/report?id=1700000000", auth=("qa", "test-only")).status_code
        == 404
    )


def test_safe_command_allowlist():
    args = [
        "/env/python",
        "train.py",
        "--api-key",
        "sk-supersecret",
        "--token=foo",
        "--cfg_file",
        "cfgs/model.yaml",
        "--epochs",
        "40",
        "--unknown",
        "private prompt",
        "-c",
        'os.remove("anything")',
    ]
    result = " ".join(command_summary(args))
    assert "model.yaml" in result and "epochs=40" in result
    assert (
        "secret" not in result
        and "token" not in result
        and "private" not in result
        and "remove" not in result
    )
    assert "user:pass" not in safe_text("https://user:pass@example.org")


def test_validate_rejects_missing_duplicate_and_nontext_hosts():
    rows = [
        dict(id=h, tasks="任务", gpu_mapping="0", assessment="未知", confidence="low")
        for h in ("intranet", "rtx4090", "rtx5090")
    ]
    assert len(validate(dict(hosts=rows))) == 3
    with pytest.raises(ValueError):
        validate(dict(hosts=rows[:2]))
    with pytest.raises(ValueError):
        validate(dict(hosts=[rows[0]] * 3))
    rows[0]["tasks"] = {"html": "<script>"}
    with pytest.raises(ValueError):
        validate(dict(hosts=rows))


def test_usage_math_includes_three_hosts_in_one_call(tmp_path):
    cfg = dict(input_cny_per_million=2, output_cny_per_million=8)
    result = record_usage(
        tmp_path, cfg, dict(usage=dict(prompt_tokens=8000, completion_tokens=1800)), time.time()
    )
    assert result["estimated_cny"] == 0.0304
    ledger = json.loads((tmp_path / "usage.json").read_text())
    entry = next(iter(ledger.values()))
    assert entry["calls"] == 1 and entry["input_tokens"] == 8000
    assert result["estimated_cny"] * 1440 == pytest.approx(43.776)


def test_offline_inventory_and_old_report_are_not_fresh(tmp_path):
    status = tmp_path / "status"
    status.mkdir()
    root = tmp_path / "analysis"
    root.mkdir()
    (root / "inventory.json").write_text(
        json.dumps(
            {
                "cloud": {"logical_cpus": 2, "cpu_model": "AMD EPYC 64-core host"},
                "pro6000": {
                    "gpu_name": "NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition",
                    "gpu_count": 1,
                },
            }
        )
    )
    (root / "latest.json").write_text(json.dumps(dict(generated_at=time.time() - 4000, hosts=[])))
    result = page_data(status, root)
    assert result["report_stale"]
    cloud = next(h for h in result["hosts"] if h["id"] == "cloud")
    assert cloud["logical_cpus"] == 2
    pro = next(h for h in result["hosts"] if h["id"] == "pro6000")
    assert pro["stale"] and pro["gpu"]["fp32"] == 110 and pro["benchmark"] is None
