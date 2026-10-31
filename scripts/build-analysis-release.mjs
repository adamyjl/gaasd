// Versioned analysis overlay: text code only, never credentials or runtime data.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
const id = process.argv[2];
if (!/^\d{8}T\d{6}$/.test(id || "")) throw new Error("Supply YYYYMMDDTHHMMSS");
const stage = path.resolve("work", `analysis-${id}`);
await mkdir(stage);
const manifest = {};
for (const name of [
  "app.py",
  "analysis.py",
  "analysis_collector.py",
  "ui/analysis.html",
  "ui/analysis.css",
  "ui/analysis.js",
  "ui/fleet.html",
  "ops/gaasd-analysis.service",
  "ops/gaasd-analysis.timer",
  "ops/nginx.conf",
]) {
  const source = name.startsWith("ops/")
    ? path.join("ops/analysis", name.slice(4))
    : path.join("backend", name);
  const bytes = await readFile(source);
  await mkdir(path.dirname(path.join(stage, name)), { recursive: true });
  await writeFile(path.join(stage, name), bytes);
  manifest[name] = createHash("sha256").update(bytes).digest("hex");
}
await writeFile(
  path.join(stage, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
const archive = path.resolve("work", `gaasd-analysis-${id}.tar`);
const result = spawnSync(
  process.platform === "win32" ? "tar.exe" : "tar",
  ["-cf", archive, "-C", stage, ...Object.keys(manifest), "manifest.json"],
  { stdio: "inherit", windowsHide: true },
);
if (result.status !== 0) throw new Error("Archive failed");
console.log(JSON.stringify({ archive, files: Object.keys(manifest).length }));
