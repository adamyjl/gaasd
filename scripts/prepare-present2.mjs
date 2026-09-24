import { mkdir, readdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const input = process.argv[2];
if (!input)
  throw new Error(
    "Supply the folder containing numbered English and Chinese videos",
  );
const ffmpeg =
  process.env.GAASD_FFMPEG ||
  path.join(
    root,
    ".tools/python/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe",
  );
const files = await readdir(input);
const names = ["platform", "ai-assist", "nnide", "vla"];
const records = [];
for (const [language, marker] of [
  ["en", "英"],
  ["cn", "中"],
]) {
  const output = path.join(root, "site/media/present2", language);
  await mkdir(output, { recursive: true });
  for (let index = 0; index < names.length; index++) {
    const candidates = files.filter((name) =>
      new RegExp(`^${index + 1}\\. .*${marker}\\.mp4$`).test(name),
    );
    if (candidates.length !== 1)
      throw new Error(`Expected exactly one ${language} video ${index + 1}`);
    const source = path.join(input, candidates[0]);
    const probe = spawnSync(ffmpeg, ["-hide_banner", "-i", source], {
      encoding: "utf8",
      windowsHide: true,
    });
    const duration = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(probe.stderr);
    if (
      !duration ||
      !/Video: h264/.test(probe.stderr) ||
      !/Audio: aac/.test(probe.stderr)
    )
      throw new Error(`Unexpected media format: ${source}`);
    const seconds =
      Number(duration[1]) * 3600 +
      Number(duration[2]) * 60 +
      Number(duration[3]);
    const filename = path.join(output, `${names[index]}.mp4`);
    const remux = spawnSync(
      ffmpeg,
      [
        "-y",
        "-v",
        "warning",
        "-i",
        source,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        filename,
      ],
      { windowsHide: true, stdio: "inherit" },
    );
    if (remux.status !== 0) throw new Error(`Remux failed: ${source}`);
    const data = await readFile(filename);
    let offset = 0,
      moov = -1,
      mdat = -1;
    while (offset + 8 <= data.length) {
      const size = data.readUInt32BE(offset);
      const type = data.toString("ascii", offset + 4, offset + 8);
      if (type === "moov") moov = offset;
      if (type === "mdat") mdat = offset;
      if (size < 8) break;
      offset += size;
    }
    if (moov < 0 || mdat < 0 || moov > mdat)
      throw new Error(`Fast-start verification failed: ${filename}`);
    records.push({
      id: names[index],
      language,
      source: candidates[0],
      duration: seconds,
      src: `media/present2/${language}/${names[index]}.mp4`,
      bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
  }
}
await mkdir(path.join(root, "work"), { recursive: true });
await writeFile(
  path.join(root, "work/present2-media.json"),
  JSON.stringify(records, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    records.map(({ id, language, duration, bytes }) => ({
      id,
      language,
      duration,
      bytes,
    })),
    null,
    2,
  ),
);
