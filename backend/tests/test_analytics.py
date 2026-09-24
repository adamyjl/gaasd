import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from app import create_app
from database import connect
from geo import GeoLookup, browser_info
from import_logs import import_logs
from werkzeug.security import generate_password_hash

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
AUTH = ("admin", "test-password-only")


def test_wechat_version_is_not_confused_with_chromium():
    info = browser_info(UA + " MicroMessenger/8.0.60 WindowsWechat/4.1.0")
    assert info["browser"] == "微信浏览器"
    assert info["browser_version"] == "8.0.60"


@pytest.fixture
def settings(tmp_path):
    return dict(
        database=str(tmp_path / "analytics.sqlite3"),
        username=AUTH[0],
        password_hash=generate_password_hash(AUTH[1]),
        origins=["https://gaasd.com"],
        trusted_proxy=True,
    )


@pytest.fixture
def client(settings):
    return create_app(settings).test_client()


def event(**overrides):
    value = dict(
        kind="page_view",
        visit_id=str(uuid.uuid4()),
        session_id=str(uuid.uuid4()),
        path="/",
        referrer="https://example.com/demo?private=value#token",
    )
    value.update(overrides)
    return value


def post(client, body, **headers):
    return client.post(
        "/api/analytics/events",
        json=body,
        headers={
            "Origin": "https://gaasd.com",
            "User-Agent": UA,
            "X-Real-IP": "203.0.113.25",
            **headers,
        },
    )


def report(client, query=""):
    response = client.get("/statistics/api/report" + query, auth=AUTH)
    assert response.status_code == 200
    return response.json


@pytest.mark.parametrize("path", ["/", "/cn", "/cn/", "/cn/index.html"])
def test_new_video_lengths_and_chinese_paths_are_tracked(client, path):
    body = event(path=path)
    assert post(client, body).status_code == 204
    body.update(
        kind="video",
        video_id="platform",
        phase="progress",
        play_id=str(uuid.uuid4()),
        watched_ms=1000,
        position=207.04,
        coverage=0.1,
    )
    assert post(client, body).status_code == 204
    data = report(client)
    assert data["visits"][0]["path"] == path
    assert data["totals"]["plays"] == 1
    assert (
        next(video for video in data["videos"] if video["id"] == "nnide")["duration_cn"] == 282.63
    )
    csv_data = client.get("/statistics/api/export.csv", auth=AUTH).get_data(as_text=True)
    assert "访问路径" in csv_data and path in csv_data
    body["position"] = 10000
    assert post(client, body).status_code == 400


@pytest.mark.parametrize(
    "path",
    [
        "/statistics",
        "/statistics/",
        "/statistics/api/report",
        "/statistics/api/export.csv",
        "/statistics/assets/dashboard.js",
    ],
)
def test_private_routes_require_authentication(client, path):
    response = client.get(path)
    assert response.status_code == 401
    assert "Basic" in response.headers["WWW-Authenticate"]
    assert response.headers["Cache-Control"] == "no-store"
    assert client.get(path, auth=("攻击者", "wrong")).status_code == 401
    assert client.get(path, auth=AUTH).status_code == 200


def test_ip_timestamp_ua_and_referrer_come_from_controlled_sources(client):
    body = event(ip="8.8.8.8", timestamp=123, user_agent="forged")
    assert post(client, body).status_code == 204
    assert post(client, body).status_code == 204
    data = report(client)
    assert data["totals"]["page_views"] == 1
    row = data["visits"][0]
    assert row["ip"] == "203.0.113.25"
    assert abs(row["started_at"] - time.time()) < 5
    assert row["browser"] == "Chrome"
    assert row["referrer"] == "https://example.com/demo"
    assert row["user_agent"] == UA


@pytest.mark.parametrize(
    "update",
    [
        {"kind": []},
        {"path": {}},
        {"visit_id": "bad"},
        {"kind": "video", "video_id": []},
        {"kind": "video", "phase": []},
        {"kind": "video", "video_id": "unknown"},
        {
            "kind": "video",
            "video_id": "overview",
            "phase": "start",
            "play_id": str(uuid.uuid4()),
            "watched_ms": float("nan"),
            "position": 0,
            "coverage": 0,
        },
    ],
)
def test_invalid_events_are_rejected(client, update):
    assert post(client, event(**update)).status_code == 400


def test_collector_origin_and_body_limits(client):
    assert post(client, event(), Origin="https://attacker.example").status_code == 403
    assert client.post("/api/analytics/events", json=event()).status_code == 403
    assert post(client, event(referrer="a" * 9000)).status_code == 413


def test_cumulative_watch_is_idempotent_and_out_of_order_safe(client):
    body = event(
        kind="video",
        video_id="overview",
        play_id=str(uuid.uuid4()),
        phase="start",
        watched_ms=0,
        position=0,
        coverage=0,
    )
    assert post(client, body).status_code == 204
    body.update(phase="progress", watched_ms=12000, position=25, coverage=0.5)
    assert post(client, body).status_code == 204
    assert post(client, body).status_code == 204
    body.update(watched_ms=3000, position=8, coverage=0.2)
    assert post(client, body).status_code == 204
    data = report(client)
    assert data["totals"]["plays"] == 1
    assert data["totals"]["watched_ms"] == 12000
    assert data["totals"]["completed"] == 0
    body.update(phase="ended", watched_ms=14000, position=28.4, coverage=0.2)
    post(client, body)
    assert report(client)["totals"]["completed"] == 0
    body.update(coverage=0.95)
    post(client, body)
    assert report(client)["totals"]["completed"] == 1


def test_different_visit_cannot_replace_existing_play(client):
    first = event(
        kind="video",
        video_id="platform",
        play_id=str(uuid.uuid4()),
        phase="start",
        watched_ms=0,
        position=0,
        coverage=0,
    )
    post(client, first)
    second = event(
        **{key: value for key, value in first.items() if key not in ["visit_id", "session_id"]}
    )
    assert post(client, second).status_code == 409
    assert report(client)["totals"]["plays"] == 1


def test_filters_bot_detection_export_and_sql_inputs(client, settings):
    normal = event()
    post(client, normal)
    post(client, event(), **{"User-Agent": "GAASD-QA automated test"})
    assert report(client)["totals"]["page_views"] == 1
    assert report(client, "?bots=1")["totals"]["page_views"] == 2
    assert report(client, "?q=203.0.113")["totals"]["page_views"] == 1
    assert report(client, "?q=%27%20OR%201%3D1--")["totals"]["page_views"] == 0
    assert client.get("/statistics/api/report?from=bad", auth=AUTH).status_code == 400
    assert (
        client.get("/statistics/api/report?from=2020-01-01&to=2026-01-01", auth=AUTH).status_code
        == 400
    )
    with connect(settings["database"]) as db:
        db.execute(
            "UPDATE visits SET browser=? WHERE id=?", ('=HYPERLINK("bad")', normal["visit_id"])
        )
    csv = client.get("/statistics/api/export.csv", auth=AUTH)
    assert csv.status_code == 200
    assert csv.data.startswith(b"\xef\xbb\xbf")
    assert "'=HYPERLINK" in csv.data.decode("utf-8-sig")


def test_log_import_is_separate_from_real_playback_and_idempotent(settings, tmp_path):
    stamp = int(time.time()) - 120
    date = datetime.fromtimestamp(stamp, timezone.utc).strftime("%d/%b/%Y:%H:%M:%S %z")
    lines = [
        f'203.0.113.5 - - [{date}] "GET / HTTP/2.0" 200 7900 "-" "{UA}"',
        f'203.0.113.5 - - [{date}] "GET /media/platform.mp4 HTTP/2.0" 206 1000 "https://gaasd.com/" "{UA}"',
    ]
    logfile = tmp_path / "access.log"
    logfile.write_text("\n".join(lines) + "\n")
    result = import_logs(settings, [logfile])
    assert result["historical_page_views"] == 1
    assert result["historical_media_requests"] == 1
    assert import_logs(settings, [logfile])["already_imported"]
    data = report(create_app(settings).test_client())
    assert data["totals"]["page_views"] == 1
    assert data["totals"]["plays"] == 0
    assert data["totals"]["watched_ms"] == 0
    assert data["totals"]["legacy_requests"] == 1
    assert data["visits"][0]["source"] == "nginx"


def test_offline_ipv4_ipv6_data_is_loaded():
    geo = GeoLookup(Path(__file__).resolve().parents[1] / "geo-data")
    assert set(geo.searchers) == {4, 6}
    assert geo.lookup("8.8.8.8")["country"]
    assert geo.lookup("2606:4700:4700::1111")["country"]
    assert geo.lookup("127.0.0.1")["region"] == "本地或保留地址"
