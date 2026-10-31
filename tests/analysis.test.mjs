import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
const live = Boolean(process.env.GAASD_TEST_URL);
const credentials = process.env.GAASD_STATISTICS_CREDENTIALS
  ? JSON.parse(await readFile(process.env.GAASD_STATISTICS_CREDENTIALS, "utf8"))
  : { username: "qa", password: "local-test-only" };
test.use({ httpCredentials: { ...credentials, send: "always" } });
test.beforeEach(async () => {
  // Respect the existing production rate limiter; do not relax it for QA.
  if (live) await delay(7000);
});
test.beforeAll(async () => {
  if (live) return;
  const root = "work/analysis-preview";
  await mkdir(`${root}/history`, { recursive: true });
  const now = Math.floor(Date.now() / 1000),
    id = String(Math.floor(now / 1800) * 1800);
  const report = {
    id,
    generated_at: now,
    next_run_at: now + 1800,
    model: "qwen3.7-plus",
    status: "ok",
    hosts: ["intranet", "rtx4090", "rtx5090"].map((id) => ({
      id,
      collection_ok: true,
      analysis_at: now,
      evidence: {
        sampled_at: now,
        window_seconds: 6,
        devices: [],
        processes: [{ pid: 42, command: ["train.py"] }],
      },
      analysis: {
        tasks: "测试样例：自动驾驶模型训练",
        gpu_mapping: "GPU 0–3 运行任务，4–7 无计算进程",
        assessment: "测试日志显示迭代推进。零利用率不等同于卡死。",
        confidence: "medium",
      },
    })),
  };
  await writeFile(`${root}/latest.json`, JSON.stringify(report));
  await writeFile(`${root}/history/${id}.json`, JSON.stringify(report));
  await writeFile(
    `${root}/cpu-benchmarks.json`,
    JSON.stringify({
      cloud: { sha256_mib_s: 100, sampled_at: now, runtime: "test fixture" },
      intranet: { sha256_mib_s: 800, sampled_at: now, runtime: "test fixture" },
    }),
  );
});
test("protected pages, charts, history, mobile layout and safe AI text", async ({
  page,
  browser,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const base = process.env.GAASD_TEST_URL || "http://127.0.0.1:4174";
  const anon = await browser.newContext({ httpCredentials: undefined });
  for (const path of [
    "/analysis",
    "/analysis/cpu",
    "/analysis/gpu",
    "/analysis/api/report",
    "/analysis/assets/analysis.js",
    "/analysis/assets/analysis.css",
  ]) {
    const response = await anon.request.get(base + path);
    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toContain(
      "GAASD Statistics",
    );
  }
  await anon.close();
  await page.goto("/analysis");
  await expect(page.locator(".task-card")).toHaveCount(3);
  await expect(page.locator(".machine")).toHaveCount(7);
  await expect(page.locator("#cpu-speed meter").first()).toBeVisible();
  await expect(page.locator("#gpu-flops meter").first()).toBeVisible();
  await expect(page.locator("#cost")).toContainText("1,440");
  const raw = await (
    await page.request.get(base + "/analysis/api/report")
  ).json();
  expect(JSON.stringify(raw)).not.toMatch(/api_key|Bearer |sk-[a-zA-Z0-9]{20}/);
  if (live) {
    expect(raw.report.status).toBe("ok");
    expect(raw.report.hosts.every((h) => h.collection_ok)).toBe(true);
  }
  const before = await page
    .locator("#gpu-flops meter")
    .evaluateAll((nodes) => nodes.map((n) => n.value));
  await page.locator("#gpu-scope").selectOption("single");
  const after = await page
    .locator("#gpu-flops meter")
    .evaluateAll((nodes) => nodes.map((n) => n.value));
  expect(Math.max(...after)).toBeLessThan(Math.max(...before));
  await page.locator("#gpu-scope").selectOption("total");
  await page.locator(".task-card summary").first().click();
  await expect(page.locator(".task-card pre").first()).toBeVisible();
  await page.locator(".task-card summary").first().click();
  if (raw.history.length) {
    await page.locator("#history").selectOption(raw.history[0]);
    await expect(page.locator("#report-meta")).toContainText("历史记录");
    await page.locator("#history").selectOption("");
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await mkdir("work/analysis-screenshots", { recursive: true });
  await page.screenshot({
    path: `work/analysis-screenshots/${live ? "live" : "local"}-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "CPU 性能与容量", exact: true }).click();
  await expect(page.locator("#gpu-section")).toBeHidden();
  await expect(page.locator("#cpu-section")).toBeVisible();
  await page.reload();
  await expect(page.locator(".task-card")).toHaveCount(3);
  await page.getByRole("link", { name: "GPU 算力与显存", exact: true }).click();
  await expect(page.locator("#cpu-section")).toBeHidden();
  await expect(page.locator("#gpu-section")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("AI markup is inert text and stale results are clearly marked", async ({
  page,
}) => {
  test.skip(
    live,
    "Synthetic failure/XSS response injection is validated locally; live checks use real API data.",
  );
  await page.route("**/analysis/api/report", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.report_stale = true;
    data.report.error = "AI 服务不可用，保留旧分析";
    if (data.report?.hosts[0]) {
      data.report.hosts[0].collection_ok = false;
      data.report.hosts[0].analysis.tasks =
        '<img src=x onerror="window.hacked=true">';
    }
    await route.fulfill({ response, json: data });
  });
  await page.goto("/analysis");
  await expect(page.locator("#notice")).toContainText("已过期");
  await expect(page.locator(".task-card").first()).toContainText("<img src=x");
  await expect(page.locator(".task-card img")).toHaveCount(0);
  await expect(page.locator(".task-card .stale").first()).toBeVisible();
});
