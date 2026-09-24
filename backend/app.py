"""First-party page and video analytics, protected reporting, and CSV export."""

import csv
import hashlib
import hmac
import io
import ipaddress
import json
import math
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

from database import connect, initialize, insert_visit
from flask import Flask, Response, abort, jsonify, request, send_from_directory
from geo import GeoLookup, browser_info
from werkzeug.security import check_password_hash

SHANGHAI = timezone(timedelta(hours=8))
VIDEOS = {
    "overview": ("GAASD 总览", 28.4),
    "platform": ("平台与功能软件", 207.04),
    "ai-assist": ("AI 辅助开发", 193.98),
    "nnide": ("神经网络开发", 296.33),
    "vla": ("VLM / VLA 开发", 274.73),
}
IDENTIFIER = re.compile(r"^[a-zA-Z0-9_-]{16,80}$")


def clean_referrer(value):
    if not isinstance(value, str):
        return ""
    try:
        parsed = urlsplit(value[:1000])
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return ""
        return f"{parsed.scheme}://{parsed.hostname}{parsed.path}"[:500]
    except ValueError:
        return ""


def create_app(overrides=None):
    app = Flask(__name__, static_folder=None)
    config_path = os.environ.get("GAASD_ANALYTICS_CONFIG", "/etc/gaasd-analytics/config.json")
    config = json.loads(Path(config_path).read_text()) if Path(config_path).exists() else {}
    config.update(overrides or {})
    for key in ["database", "username", "password_hash", "origins"]:
        if not config.get(key):
            raise RuntimeError(f"Missing analytics setting: {key}")
    initialize(config["database"])
    app.config.update(MAX_CONTENT_LENGTH=8192, ANALYTICS=config)
    geo = GeoLookup(config.get("geo_directory"))
    verified_credential = None
    ui = Path(__file__).parent / "ui"

    @app.before_request
    def protect_admin():
        nonlocal verified_credential
        if not request.path.startswith(("/statistics", "/status")):
            return None
        auth = request.authorization
        if (
            auth
            and auth.type == "basic"
            and hmac.compare_digest((auth.username or "").encode(), config["username"].encode())
            and len(auth.password or "") <= 512
        ):
            password = auth.password or ""
            digest = hashlib.sha256(password.encode()).digest()
            if (
                verified_credential is not None and hmac.compare_digest(digest, verified_credential)
            ) or check_password_hash(config["password_hash"], password):
                verified_credential = digest
                return None
        return Response(
            "需要管理员账号登录。",
            401,
            {"WWW-Authenticate": 'Basic realm="GAASD Statistics", charset="UTF-8"'},
            content_type="text/plain; charset=utf-8",
        )

    @app.after_request
    def headers(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        if request.path.startswith(("/statistics", "/status")):
            response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
            response.headers["Referrer-Policy"] = "same-origin"
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
            )
        return response

    @app.errorhandler(400)
    @app.errorhandler(413)
    def bad_request(error):
        return jsonify(error="请求参数无效"), error.code

    def client_ip():
        candidate = request.remote_addr or "0.0.0.0"
        if config.get("trusted_proxy") and candidate in {"127.0.0.1", "::1"}:
            candidate = request.headers.get("X-Real-IP", candidate)
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            abort(400)

    @app.post("/api/analytics/events")
    def collect():
        if request.headers.get("Origin") not in config["origins"]:
            return jsonify(error="Invalid origin"), 403
        body = request.get_json(silent=True)
        if (
            not isinstance(body, dict)
            or not isinstance(body.get("kind"), str)
            or body.get("kind") not in {"page_view", "video"}
        ):
            abort(400)
        for key in ["visit_id", "session_id"]:
            if not isinstance(body.get(key), str) or not IDENTIFIER.fullmatch(body[key]):
                abort(400)
        if not isinstance(body.get("path"), str) or body.get("path") not in {
            "/",
            "/index.html",
            "/gaasd-test/",
            "/cn",
            "/cn/",
            "/cn/index.html",
        }:
            abort(400)
        if body["kind"] == "video":
            if (
                not isinstance(body.get("video_id"), str)
                or not isinstance(body.get("phase"), str)
                or body.get("video_id") not in VIDEOS
                or body.get("phase")
                not in {
                    "start",
                    "progress",
                    "pause",
                    "close",
                    "ended",
                }
            ):
                abort(400)
            if not isinstance(body.get("play_id"), str) or not IDENTIFIER.fullmatch(
                body["play_id"]
            ):
                abort(400)
            for key in ["watched_ms", "position", "coverage"]:
                value = body.get(key)
                if (
                    not isinstance(value, (float, int))
                    or isinstance(value, bool)
                    or not math.isfinite(value)
                    or value < 0
                ):
                    abort(400)
            if (
                body["coverage"] > 1
                or body["watched_ms"] > 86400000
                or body["position"] > VIDEOS[body["video_id"]][1] + 2
            ):
                abort(400)
        now = int(time.time())
        ip = client_ip()
        ua = request.headers.get("User-Agent", "")[:1000]
        with connect(config["database"]) as db:
            insert_visit(
                db,
                dict(
                    id=body["visit_id"],
                    session_id=body["session_id"],
                    started_at=now,
                    last_seen=now,
                    ip=ip,
                    **geo.lookup(ip),
                    **browser_info(ua),
                    user_agent=ua,
                    path=body["path"],
                    referrer=clean_referrer(body.get("referrer")),
                    source="client",
                ),
            )
            visit = db.execute("SELECT * FROM visits WHERE id=?", (body["visit_id"],)).fetchone()
            if visit["session_id"] != body["session_id"] or visit["source"] != "client":
                return jsonify(error="Conflicting visit"), 409
            db.execute(
                "UPDATE visits SET last_seen=MAX(last_seen,?) WHERE id=?",
                (now, body["visit_id"]),
            )
            if body["kind"] == "video":
                existing = db.execute(
                    "SELECT * FROM plays WHERE id=?", (body["play_id"],)
                ).fetchone()
                if existing and (
                    existing["visit_id"] != body["visit_id"]
                    or existing["video_id"] != body["video_id"]
                ):
                    return jsonify(error="Conflicting play"), 409
                started = existing["started_at"] if existing else now
                watched = min(int(body["watched_ms"]), (now - started + 30) * 1000)
                completed = int(body["phase"] == "ended" and body["coverage"] >= 0.9)
                db.execute(
                    """INSERT INTO plays(id,visit_id,video_id,started_at,last_seen,watched_ms,position,coverage,completed)
                    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                    last_seen=MAX(last_seen,excluded.last_seen), watched_ms=MAX(watched_ms,excluded.watched_ms),
                    position=MAX(position,excluded.position), coverage=MAX(coverage,excluded.coverage),
                    completed=MAX(completed,excluded.completed)""",
                    (
                        body["play_id"],
                        body["visit_id"],
                        body["video_id"],
                        started,
                        now,
                        watched,
                        body["position"],
                        body["coverage"],
                        completed,
                    ),
                )
        return Response(status=204)

    @app.get("/statistics")
    @app.get("/statistics/")
    def dashboard():
        return send_from_directory(ui, "index.html")

    @app.get("/statistics/assets/<path:filename>")
    def ui_asset(filename):
        if filename not in {"dashboard.js", "dashboard.css"}:
            abort(404)
        return send_from_directory(ui, filename)

    @app.get("/status")
    @app.get("/status/")
    def server_status():
        return send_from_directory(ui, "status.html")

    @app.get("/status/assets/<path:filename>")
    def status_asset(filename):
        if filename not in {"status.js", "status.css", "dashboard.css"}:
            abort(404)
        return send_from_directory(ui, filename)

    @app.get("/status/api/snapshot")
    @app.get("/status/api/history")
    def status_data():
        directory = Path(config.get("status_directory", "/var/lib/gaasd-analytics/status"))
        name = "history.json" if request.path.endswith("/history") else "latest.json"
        try:
            data = json.loads((directory / name).read_text(encoding="utf-8"))
            age = max(0, time.time() - data["generated_at"])
        except (OSError, ValueError, KeyError, TypeError):
            return jsonify(error="状态采集尚未就绪，请稍后刷新。", stale=True), 503
        return jsonify(
            **data, age_seconds=round(age, 1), stale=age > (150 if name == "history.json" else 20)
        )

    def filters():
        today = datetime.now(SHANGHAI).date()
        try:
            start = datetime.strptime(
                request.args.get("from", str(today - timedelta(days=6))), "%Y-%m-%d"
            ).replace(tzinfo=SHANGHAI)
            end = datetime.strptime(request.args.get("to", str(today)), "%Y-%m-%d").replace(
                tzinfo=SHANGHAI
            ) + timedelta(days=1)
            page = int(request.args.get("page", 1))
            size = int(request.args.get("size", 30))
        except (ValueError, TypeError):
            abort(400)
        if (
            end <= start
            or (end - start).days > 366
            or page < 1
            or page > 100000
            or size < 1
            or size > 100
        ):
            abort(400)
        where = ["v.started_at >= ?", "v.started_at < ?"]
        args = [int(start.timestamp()), int(end.timestamp())]
        if request.args.get("bots", "0") != "1":
            where.append("v.is_bot=0")
        source = request.args.get("source", "all")
        if source not in {"all", "client", "nginx"}:
            abort(400)
        if source != "all":
            where.append("v.source=?")
            args.append(source)
        query = request.args.get("q", "").strip()
        if len(query) > 120:
            abort(400)
        if query:
            where.append("(v.ip LIKE ? OR v.region LIKE ? OR v.browser LIKE ?)")
            args.extend([f"%{query}%"] * 3)
        video = request.args.get("video", "")
        if video:
            if video not in VIDEOS:
                abort(400)
            where.append(
                "(EXISTS(SELECT 1 FROM plays p WHERE p.visit_id=v.id AND p.video_id=?) OR EXISTS(SELECT 1 FROM legacy_media l WHERE l.visit_id=v.id AND l.video_id=?))"
            )
            args.extend([video, video])
        return " AND ".join(where), args, start, end, page, size

    def visit_rows(db, where, args, limit, offset):
        rows = [
            dict(row)
            for row in db.execute(
                f"SELECT v.* FROM visits v WHERE {where} ORDER BY v.started_at DESC,v.id DESC LIMIT ? OFFSET ?",
                [*args, limit, offset],
            )
        ]
        if not rows:
            return rows
        ids = [row["id"] for row in rows]
        placeholders = ",".join("?" for _ in ids)
        plays = {}
        for row in db.execute(
            f"SELECT visit_id, video_id, COUNT(*) plays, SUM(watched_ms) watched_ms, MAX(coverage) coverage, SUM(completed) completed FROM plays WHERE visit_id IN ({placeholders}) GROUP BY visit_id,video_id",
            ids,
        ):
            plays.setdefault(row["visit_id"], []).append(dict(row))
        legacy = {}
        for row in db.execute(
            f"SELECT visit_id,video_id,COUNT(*) requests FROM legacy_media WHERE visit_id IN ({placeholders}) GROUP BY visit_id,video_id",
            ids,
        ):
            legacy.setdefault(row["visit_id"], []).append(dict(row))
        for row in rows:
            row["videos"] = plays.get(row["id"], [])
            row["legacy_videos"] = legacy.get(row["id"], [])
        return rows

    @app.get("/statistics/api/report")
    def report():
        where, args, start, end, page, size = filters()
        with connect(config["database"]) as db:
            totals = dict(
                db.execute(
                    f"SELECT COUNT(*) page_views,COUNT(DISTINCT session_id) sessions,COUNT(DISTINCT ip) ips,SUM(source='nginx') historical_visits FROM visits v WHERE {where}",
                    args,
                ).fetchone()
            )
            totals.update(
                dict(
                    db.execute(
                        f"SELECT COUNT(*) plays,COALESCE(SUM(p.watched_ms),0) watched_ms,COALESCE(SUM(p.completed),0) completed FROM plays p JOIN visits v ON v.id=p.visit_id WHERE {where}",
                        args,
                    ).fetchone()
                )
            )
            totals["legacy_requests"] = db.execute(
                f"SELECT COUNT(*) FROM legacy_media l JOIN visits v ON v.id=l.visit_id WHERE {where}",
                args,
            ).fetchone()[0]
            raw_days = {
                row["day"]: dict(row)
                for row in db.execute(
                    f"SELECT strftime('%Y-%m-%d',started_at,'unixepoch','+8 hours') day,COUNT(*) page_views,COUNT(DISTINCT ip) ips FROM visits v WHERE {where} GROUP BY day",
                    args,
                )
            }
            timeline = []
            current = start
            while current < end:
                day = current.strftime("%Y-%m-%d")
                timeline.append(raw_days.get(day, dict(day=day, page_views=0, ips=0)))
                current += timedelta(days=1)
            raw_videos = {
                row["video_id"]: dict(row)
                for row in db.execute(
                    f"SELECT p.video_id,COUNT(*) plays,COUNT(DISTINCT v.ip) ips,SUM(p.watched_ms) watched_ms,SUM(p.completed) completed FROM plays p JOIN visits v ON v.id=p.visit_id WHERE {where} GROUP BY p.video_id",
                    args,
                )
            }
            raw_legacy = {
                row["video_id"]: row["requests"]
                for row in db.execute(
                    f"SELECT l.video_id,COUNT(*) requests FROM legacy_media l JOIN visits v ON v.id=l.visit_id WHERE {where} GROUP BY l.video_id",
                    args,
                )
            }
            video_stats = [
                dict(
                    id=key,
                    title=title,
                    duration=duration,
                    duration_cn=282.63 if key == "nnide" else duration,
                    **raw_videos.get(key, dict(plays=0, ips=0, watched_ms=0, completed=0)),
                    legacy_requests=raw_legacy.get(key, 0),
                )
                for key, (title, duration) in VIDEOS.items()
            ]
            regions = [
                dict(row)
                for row in db.execute(
                    f"SELECT region name,COUNT(*) count FROM visits v WHERE {where} GROUP BY region ORDER BY count DESC LIMIT 8",
                    args,
                )
            ]
            browsers = [
                dict(row)
                for row in db.execute(
                    f"SELECT browser name,COUNT(*) count FROM visits v WHERE {where} GROUP BY browser ORDER BY count DESC LIMIT 8",
                    args,
                )
            ]
            rows = visit_rows(db, where, args, size, (page - 1) * size)
            meta = dict(db.execute("SELECT key,value FROM meta"))
        return jsonify(
            totals=totals,
            timeline=timeline,
            videos=video_stats,
            regions=regions,
            browsers=browsers,
            visits=rows,
            page=page,
            size=size,
            meta=meta,
            generated_at=int(time.time()),
        )

    @app.get("/statistics/api/export.csv")
    def export():
        where, args, *_rest = filters()
        with connect(config["database"]) as db:
            rows = visit_rows(db, where, args, 10000, 0)
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "访问时间（北京时间）",
                "IP",
                "大致地区",
                "运营商",
                "浏览器",
                "系统",
                "设备",
                "来源",
                "来源页面",
                "访问路径",
                "实际播放视频",
                "累计观看秒数",
                "历史视频资源请求",
                "自动流量",
            ]
        )

        def safe(value):
            value = str(value)
            return (
                "'" + value if value.startswith(("=", "+", "-", "@", "\t", "\r", "\n")) else value
            )

        for row in rows:
            writer.writerow(
                [
                    safe(value)
                    for value in [
                        datetime.fromtimestamp(row["started_at"], SHANGHAI).isoformat(),
                        row["ip"],
                        row["region"],
                        row["isp"],
                        row["browser"] + " " + row["browser_version"],
                        row["os"],
                        row["device"],
                        row["source"],
                        row["referrer"],
                        row["path"],
                        " / ".join(VIDEOS[v["video_id"]][0] for v in row["videos"]),
                        round(sum(v["watched_ms"] for v in row["videos"]) / 1000, 1),
                        " / ".join(
                            f"{VIDEOS[v['video_id']][0]} ({v['requests']})"
                            for v in row["legacy_videos"]
                        ),
                        row["is_bot"],
                    ]
                ]
            )
        return Response(
            "\ufeff" + output.getvalue(),
            content_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="gaasd-visits.csv"'},
        )

    @app.get("/internal/health")
    def health():
        with connect(config["database"]) as db:
            db.execute("SELECT 1").fetchone()
        return jsonify(status="ok", service="gaasd-analytics", geo_versions=list(geo.searchers))

    return app
