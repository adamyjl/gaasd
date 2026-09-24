import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const checkout = process.argv[2] && path.resolve(process.argv[2]);
if (!checkout || checkout === path.resolve(root))
  throw new Error("Pass a separate preview-pages checkout.");
const git = (...args) =>
  execFileSync("git", args, { cwd: checkout, encoding: "utf8" }).trim();
if (git("branch", "--show-current") !== "preview-pages")
  throw new Error("Expected preview-pages branch");
if (
  git("remote", "get-url", "origin") !== "https://github.com/adamyjl/gaasd.git"
)
  throw new Error("Unexpected publication repository");
if (git("status", "--porcelain"))
  throw new Error("Publication checkout must be clean");
const source = path.resolve(root, "preview-dist/gaasd/review/why-cbdes");
const info = JSON.parse(
  await readFile(path.join(source, "preview-info.json"), "utf8"),
);
const revision = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (
  info.dirty ||
  dirty ||
  info.revision !== revision ||
  info.base !== "/gaasd/review/why-cbdes/"
)
  throw new Error("Commit source and rebuild the preview before staging it");
const target = path.resolve(checkout, "review/why-cbdes");
if (!target.startsWith(checkout + path.sep))
  throw new Error("Unsafe publication path");
// Replace only this review directory; leave other published paths and configuration intact.
await rm(target, { recursive: true, force: true });
await mkdir(path.dirname(target), { recursive: true });
await cp(source, target, { recursive: true });
await writeFile(path.join(checkout, ".nojekyll"), "");
try {
  await access(path.join(checkout, "index.html"));
} catch {
  await writeFile(
    path.join(checkout, "index.html"),
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><title>GAASD design reviews</title><a href="review/why-cbdes/">Why CBDES — English</a> · <a href="review/why-cbdes/cn/">中文</a></html>\n',
  );
}
console.log(
  `Staged review ${revision} in ${target}; inspect, commit and push preview-pages.`,
);
