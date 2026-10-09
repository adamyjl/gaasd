// Backend-only overlay: never packages website media, data or credentials.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
const id = process.argv[2];
if (!/^\d{8}T\d{6}$/.test(id || "")) throw new Error("Supply YYYYMMDDTHHMMSS");
const stage = path.resolve("work", `status-${id}`);
await mkdir(stage);
const manifest = {};
for (const name of [
  "app.py",
  "backup.py",
  "gpu_usage.py",
  "status_collector.py",
  "gpu_metrics.py",
  "status_remote.py",
  "status_probe.py",
  "ui/status.html",
  "ui/status.css",
  "ui/status.js",
  "ui/status-gpu-usage.js",
]) {
  const content = await readFile(path.join("backend", name));
  await mkdir(path.dirname(path.join(stage, name)), { recursive: true });
  await writeFile(path.join(stage, name), content);
  manifest[name] = createHash("sha256").update(content).digest("hex");
}
await writeFile(
  path.join(stage, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
const archive = path.resolve("work", `gaasd-status-${id}.tar`);
const result = spawnSync(
  process.platform === "win32" ? "tar.exe" : "tar",
  ["-cf", archive, "-C", stage, "."],
  { stdio: "inherit", windowsHide: true },
);
if (result.status !== 0) throw new Error("Archive failed");
console.log(JSON.stringify({ archive, files: Object.keys(manifest).length }));
