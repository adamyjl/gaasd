import { readdir, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getVideos } from "../site/video-catalog.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = process.env.GAASD_PREVIEW_BASE || "/gaasd/review/why-cbdes/";
if (!/^\/(?:[a-zA-Z0-9_-]+\/)+$/.test(base))
  throw new Error(
    "Preview base must be an absolute directory path without dot segments.",
  );
const revision = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const dirty = execFileSync(
  "git",
  ["status", "--porcelain", "--untracked-files=normal"],
  { cwd: root, encoding: "utf8" },
).trim();
const version = `${revision}${dirty ? "-working" : ""}`;
const origin = "https://gaasd.com/";
const previewRoot = path.resolve(root, "preview-dist");
const output = path.resolve(previewRoot, base.slice(1));
if (!output.startsWith(previewRoot + path.sep))
  throw new Error("Unsafe preview output");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["media", "images", "docs"].includes(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sourceFiles(filename)));
    else if (/\.(html|css|js|svg)$/.test(entry.name)) result.push(filename);
  }
  return result;
}
for (const filename of await sourceFiles(path.join(root, "site"))) {
  const relative = path
    .relative(path.join(root, "site"), filename)
    .replaceAll(path.sep, "/");
  let text = await readFile(filename, "utf8");
  if (/data:(?:image|video|audio)|;base64,/i.test(text))
    throw new Error(`Embedded media is prohibited: ${relative}`);
  if (relative === "analytics.js")
    text =
      "// Review builds never collect business analytics.\nexport function initAnalytics() {}\n";
  if (relative.endsWith(".html")) {
    const chinese = relative.startsWith("cn/");
    const homepage = `${base}${chinese ? "cn/" : ""}`;
    text = text.replace(
      /<html /,
      '<html data-preview="true" data-media-base="https://gaasd.com/" ',
    );
    text = text.replace(/<link rel="canonical"[^>]*>/g, "");
    text = text.replace(/<meta property="og:url"[^>]*>/g, "");
    text = text.replace(/(href|src)="([^"]+)"/g, (match, attribute, value) => {
      if (/^(?:https?:|#|mailto:)/.test(value)) return match;
      const local = value.replace(/^\//, "");
      const url = /^(?:media|images)\//.test(local)
        ? origin + local
        : value.startsWith("/")
          ? base + local
          : new URL(value, "https://preview.invalid" + homepage).pathname +
            (value.includes("?") ? "?" + value.split("?")[1] : "");
      return `${attribute}="${url}"`;
    });
    const banner = `<aside class="review-banner" aria-label="Design review"><p><strong>${chinese ? "设计评审预览" : "Design Review Preview"}</strong> · <code>${version}</code> · ${chinese ? "未上线 · 不采集访问及播放事件" : "Not a production release · Analytics off"}</p><nav aria-label="Language"><a href="${base}" data-review-language="en" lang="en" ${chinese ? "" : 'aria-current="page"'}>EN</a><a href="${base}cn/" data-review-language="cn" lang="zh-CN" ${chinese ? 'aria-current="page"' : ""}>中文</a></nav></aside>`;
    if (text.includes('class="site-header"')) {
      text = text.replace(
        "<body>",
        `<body>\n<div class="review-top">${banner}`,
      );
      text = text.replace("</header>", "</header></div>");
    } else text = text.replace("<body>", `<body>\n${banner}`);
    // connect-src blocks fetch/beacon/XHR, including any accidentally reintroduced analytics.
    text = text.replace(
      "</head>",
      `<meta name="robots" content="noindex,nofollow" /><meta name="referrer" content="no-referrer" /><meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' https://gaasd.com; media-src https://gaasd.com; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" /><link rel="stylesheet" href="${base}review-preview.css" /><script type="module" src="${base}review-preview.js"></script></head>`,
    );
  }
  const destination = path.join(output, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, text.replace(/[ \t]+$/gm, ""));
}
const assets = [
  ...new Set([
    ...["en", "cn"].flatMap((language) =>
      getVideos(language, origin).flatMap((video) => [video.src, video.poster]),
    ),
    `${origin}images/public-security-beian.png`,
  ]),
];
await writeFile(
  path.join(output, "preview-info.json"),
  JSON.stringify(
    {
      version,
      revision,
      dirty: Boolean(dirty),
      base,
      assets,
      analytics: false,
      missingResources: [
        "images/why-cbdes-source.jpg",
        "docs/GAASD-Develop.pdf",
      ],
    },
    null,
    2,
  ) + "\n",
);
await writeFile(path.join(output, ".nojekyll"), "");
console.log(
  `Review ${version}: ${output} (${assets.length} public media references)`,
);
