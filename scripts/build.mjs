import {
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { videos, getVideos } from "../site/video-catalog.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const site = path.join(root, "site");
const dist = path.join(root, "dist");
// Each locale owns its HTML copy; shared CSS and JS retain the same layout.
for (const [entry, language, lines] of [
  [
    "index.html",
    "en",
    [
      "Layered Software Decoupling.",
      "Cross-Domain Reuse & Refactoring.",
      "AI-Augmented Visual Development.",
    ],
  ],
  ["cn/index.html", "zh-CN", ["分层解耦拆解", "跨域共用重构", "图形化AI赋能"]],
]) {
  const html = await readFile(path.join(site, entry), "utf8");
  if (!html.includes(`lang="${language}"`))
    throw new Error(`Wrong page language: ${entry}`);
  for (const line of lines) {
    const literal = line
      .replaceAll("&", "&amp;")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`<span>\\s*${literal}\\s*</span\\s*>`).test(html))
      throw new Error(`Missing headline in ${entry}: ${line}`);
  }
  for (const filing of ["京ICP备2026057773号", "京公网安备11010802050298号"]) {
    if (!html.includes(filing)) throw new Error(`Missing filing in ${entry}`);
  }
}
if (videos.length !== 5 || new Set(videos.map((video) => video.id)).size !== 5)
  throw new Error("Expected five distinct videos.");
for (const video of [...videos, ...getVideos("cn")]) {
  for (const asset of [video.src, video.poster]) {
    if (!(await stat(path.join(site, asset.replace(/^\//, "")))).isFile())
      throw new Error(`Missing media: ${asset}`);
  }
}
await mkdir(dist, { recursive: true });
await cp(site, dist, { recursive: true, force: true });
async function files(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await files(filename)));
    else if (entry.name !== "asset-manifest.json") results.push(filename);
  }
  return results;
}
const manifest = {};
for (const filename of await files(dist)) {
  const bytes = await readFile(filename);
  manifest[path.relative(dist, filename).split(path.sep).join("/")] = {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
await writeFile(
  path.join(dist, "asset-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `Production build complete: ${Object.keys(manifest).length} files in ${dist}`,
);
