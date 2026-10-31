import { mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setInterval, clearInterval } from "node:timers";
import { sample } from "../tests/status-fixtures.mjs";

const root = resolve("work/status-test-fixtures");
await mkdir(join(root, "intranet"), { recursive: true });
async function update() {
  for (const host of [
    "cloud",
    "intranet",
    "office",
    "windows",
    "rtx4090",
    "rtx5090",
    "pro6000",
    "pro6000-02",
    "pro6000-03",
    "pro6000-04",
  ]) {
    const internal = host !== "cloud";
    const folder = host === "cloud" ? root : join(root, host);
    await mkdir(folder, { recursive: true });
    const data = sample(internal);
    if (["office", "windows"].includes(host) || host.startsWith("pro6000")) {
      data.gpu.devices = data.gpu.devices.slice(0, 1);
      data.gpu.expected_count = 1;
      data.cpu.cores = data.cpu.cores.slice(0, 8);
      data.host.logical_cpus = 8;
      data.hardware = { cpu_model: "Synthetic CPU", disks: [] };
      if (host.startsWith("pro6000")) {
        data.host.name = host;
        data.gpu.devices[0].name =
          "NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition";
      }
    }
    for (const [name, value] of Object.entries({
      latest: data,
      history: {
        generated_at: data.generated_at,
        points: [
          {
            timestamp: data.generated_at,
            cpu: 12,
            memory: 25,
            swap: 0,
            rx: 0,
            tx: 0,
            gpu: internal ? 35 : null,
            gpu_memory: internal ? 1.25 : null,
          },
        ],
      },
    })) {
      const target = join(folder, `${name}.json`);
      await writeFile(`${target}.tmp`, JSON.stringify(value));
      await rename(`${target}.tmp`, target);
    }
  }
}
await update();
const seed = spawnSync(
  process.env.GAASD_PYTHON ||
    (process.platform === "win32"
      ? resolve(".tools/analytics-venv/Scripts/python.exe")
      : "python3"),
  ["backend/tests/seed_gpu_usage.py"],
  { stdio: "inherit", windowsHide: true },
);
if (seed.status !== 0) throw new Error("GPU usage fixture setup failed");
const timer = setInterval(
  () =>
    update().catch((error) => {
      console.error(error);
      process.exit(1);
    }),
  30000,
);
const child = spawn(process.execPath, ["scripts/analytics-dev.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    GAASD_ANALYTICS_PORT: "4182",
    GAASD_STATUS_DIRECTORY: root,
  },
});
child.on("exit", (code) => {
  clearInterval(timer);
  process.exit(code || 0);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(timer);
    child.kill(signal);
  });
