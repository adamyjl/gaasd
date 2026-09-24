import http from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const arg = (key, fallback) => {
  const index = process.argv.indexOf(key);
  return index < 0 ? fallback : process.argv[index + 1];
};
const root = path.resolve(project, arg("--dir", "site"));
const port = Number(arg("--port", "4173"));
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
};
const server = http.createServer(async (request, response) => {
  try {
    const endpoint = new URL(request.url, "http://localhost");
    if (
      endpoint.pathname.startsWith("/statistics") ||
      endpoint.pathname.startsWith("/status") ||
      endpoint.pathname === "/api/analytics/events"
    ) {
      const upstream = http.request(
        new URL(
          request.url,
          process.env.GAASD_ANALYTICS_UPSTREAM || "http://127.0.0.1:4180",
        ),
        {
          method: request.method,
          headers: {
            ...request.headers,
            "x-real-ip": request.socket.remoteAddress || "127.0.0.1",
          },
        },
        (incoming) => {
          response.writeHead(incoming.statusCode || 502, incoming.headers);
          incoming.pipe(response);
        },
      );
      upstream.on("error", () => {
        if (!response.headersSent)
          response.writeHead(503, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({ error: "Analytics preview is not running" }),
        );
      });
      request.pipe(upstream);
      return;
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    if (pathname === "/healthz") {
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ status: "ok", service: "gaasd-test" }));
      return;
    }
    const filename = path.resolve(
      root,
      "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname),
    );
    const relative = path.relative(root, filename);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      response.writeHead(403).end();
      return;
    }
    const info = await stat(filename);
    if (info.isDirectory() && !pathname.endsWith("/")) {
      response
        .writeHead(301, { Location: `${pathname}/${endpoint.search}` })
        .end();
      return;
    }
    if (!info.isFile()) {
      response.writeHead(404).end();
      return;
    }
    const headers = {
      "Content-Type":
        types[path.extname(filename)] || "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    };
    let start = 0;
    let end = info.size - 1;
    let status = 200;
    if (request.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (!match || (!match[1] && !match[2])) {
        response
          .writeHead(416, { "Content-Range": `bytes */${info.size}` })
          .end();
        return;
      }
      start = match[1]
        ? Number(match[1])
        : Math.max(0, info.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      if (start > end || start >= info.size) {
        response
          .writeHead(416, { "Content-Range": `bytes */${info.size}` })
          .end();
        return;
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
    }
    headers["Content-Length"] = end - start + 1;
    response.writeHead(status, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    const stream = createReadStream(filename, { start, end });
    stream.on("error", () => response.destroy());
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  } catch (error) {
    if (!response.headersSent)
      response.writeHead(error.code === "ENOENT" ? 404 : 400);
    response.end();
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`GAASD preview: http://127.0.0.1:${port}`),
);
