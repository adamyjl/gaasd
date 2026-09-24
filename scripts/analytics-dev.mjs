import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const python =
  process.env.GAASD_PYTHON ||
  (process.platform === "win32"
    ? `${root}.tools/analytics-venv/Scripts/python.exe`
    : "python3");
const child = spawn(python, ["backend/dev_server.py"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code || 0;
});
process.on("SIGTERM", () => child.kill());
process.on("SIGINT", () => child.kill());
