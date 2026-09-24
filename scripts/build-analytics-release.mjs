import { mkdir, readFile, readdir, cp, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const release = process.argv[2];
if (!/^\d{8}T\d{6}$/.test(release || ""))
  throw new Error("Supply a YYYYMMDDTHHMMSS release identifier");
const stage = path.join(root, "work", `analytics-${release}`);
await mkdir(stage);
await mkdir(path.join(stage, "public"));
await mkdir(path.join(stage, "backend"));
const frontend = JSON.parse(
  await readFile(path.join(root, "dist/asset-manifest.json"), "utf8"),
);
for (const name of [...Object.keys(frontend), "asset-manifest.json"]) {
  if (
    (name.startsWith("media/") && !name.startsWith("media/present2/")) ||
    (name.startsWith("images/") && !name.startsWith("images/en/"))
  )
    continue;
  await mkdir(path.dirname(path.join(stage, "public", name)), {
    recursive: true,
  });
  await cp(path.join(root, "dist", name), path.join(stage, "public", name), {
    recursive: true,
  });
}
for (const name of [
  "app.py",
  "database.py",
  "geo.py",
  "import_logs.py",
  "refresh_agents.py",
  "backup.py",
  "status_collector.py",
  "requirements.txt",
  "ui",
  "geo-data",
])
  await cp(
    path.join(root, "backend", name),
    path.join(stage, "backend", name),
    { recursive: true },
  );
async function files(directory) {
  const list = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) list.push(...(await files(name)));
    else list.push(name);
  }
  return list;
}
const manifest = {};
for (const filename of await files(stage)) {
  const content = await readFile(filename);
  manifest[path.relative(stage, filename).split(path.sep).join("/")] = {
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}
await writeFile(
  path.join(stage, "release-manifest.json"),
  JSON.stringify(manifest, null, 2),
);
const archive = path.join(root, "work", `gaasd-analytics-${release}.tar`);
const result = spawnSync(
  process.platform === "win32" ? "tar.exe" : "tar",
  ["-cf", archive, "-C", stage, "."],
  { windowsHide: true, stdio: "inherit" },
);
if (result.status !== 0) throw new Error("Archive creation failed");
console.log(
  JSON.stringify(
    {
      archive,
      files: Object.keys(manifest).length,
      bytes: Object.values(manifest).reduce((sum, file) => sum + file.bytes, 0),
    },
    null,
    2,
  ),
);
