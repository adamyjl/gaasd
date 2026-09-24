import { mkdir, copyFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const ffmpeg =
  process.env.GAASD_FFMPEG ||
  path.join(
    root,
    ".tools/python/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe",
  );
await access(ffmpeg);
await mkdir(path.join(root, "site/media"), { recursive: true });
await mkdir(path.join(root, "site/images"), { recursive: true });
const original = path.join(root, "GAASD-Tutorial");
const media = path.join(root, "site/media");
const images = path.join(root, "site/images");
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-y", "-v", "warning", ...args], {
      windowsHide: true,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`FFmpeg exited ${code}`)),
    );
  });
}
for (const [file, name] of [
  ["1.png", "platform"],
  ["2.png", "ai-assist"],
  ["3.png", "nnide"],
  ["4.jpg", "vla"],
]) {
  await run([
    "-i",
    path.join(root, file),
    "-vf",
    "scale=800:450:force_original_aspect_ratio=decrease,pad=800:450:(ow-iw)/2:(oh-ih)/2:color=0xeeeeee",
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    "-quality",
    "88",
    path.join(images, `${name}.webp`),
  ]);
}
await run([
  "-ss",
  "20",
  "-i",
  path.join(original, "0. GAASD-Overview.mp4"),
  "-frames:v",
  "1",
  "-vf",
  "scale=1280:720",
  "-c:v",
  "libwebp",
  "-quality",
  "90",
  path.join(images, "overview.webp"),
]);
console.log("Real video poster and four screenshot posters prepared.");
await run([
  "-i",
  path.join(original, "0. GAASD-Overview.mp4"),
  "-map",
  "0:v:0",
  "-map",
  "0:a:0?",
  "-c:v",
  "libx264",
  "-preset",
  "fast",
  "-crf",
  "22",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-b:a",
  "128k",
  "-movflags",
  "+faststart",
  path.join(media, "overview.mp4"),
]);
await run([
  "-i",
  path.join(original, "1. GAASD-Platform.mp4"),
  "-map",
  "0",
  "-c",
  "copy",
  "-movflags",
  "+faststart",
  path.join(media, "platform.mp4"),
]);
for (const [file, name] of [
  ["2. GAASD-AI Assist.mp4", "ai-assist"],
  ["3. GAASD-NNIDE.mp4", "nnide"],
  ["4. GAASD-VLA.mp4", "vla"],
])
  await copyFile(path.join(original, file), path.join(media, `${name}.mp4`));
console.log("Five web videos prepared; original files were preserved.");
