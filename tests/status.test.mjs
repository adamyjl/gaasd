import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const credentials = process.env.GAASD_STATISTICS_CREDENTIALS
  ? JSON.parse(await readFile(process.env.GAASD_STATISTICS_CREDENTIALS, "utf8"))
  : { username: "qa", password: "local-test-only" };
test.use({ httpCredentials: { ...credentials, send: "always" } });
test.beforeEach(async () => {
  // Respect the existing public Nginx limit between automated viewport runs.
  if (process.env.GAASD_TEST_URL) await delay(6000);
});

test("status uses statistics login, renders real host metrics and responsive layout", async ({
  page,
  context,
  browser,
}, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const publicContext = await browser.newContext({
    httpCredentials: undefined,
  });
  const url = process.env.GAASD_TEST_URL || "http://127.0.0.1:4174";
  for (const path of [
    "/status",
    "/status/api/snapshot",
    "/status/api/snapshot?server=intranet",
    "/status/api/history?server=intranet",
    "/status/assets/status.js",
    "/status/assets/status-gpu-usage.js",
    "/status/api/gpu-usage",
  ]) {
    const response = await publicContext.request.get(url + path);
    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toContain(
      "GAASD Statistics",
    );
  }
  await publicContext.close();
  await page.goto("/status");
  await expect(page.locator("#cpu-cores .core-card")).toHaveCount(2);
  await expect(page.locator("#summary-metrics article")).toHaveCount(6);
  await expect(page.locator("#host-summary")).toContainText("Ubuntu");
  await expect(page.locator("#memory-detail")).toContainText("Swap");
  await expect(page.locator("#filesystems")).toContainText("远程挂载");
  await expect(page.locator("#services")).toContainText("Nginx");
  expect(await page.locator("#processes tr").count()).toBeGreaterThan(0);
  await page.getByRole("button", { name: "24 小时", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "24 小时", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator("#process-sort").selectOption("memory");
  const rss = await page
    .locator("#processes tr:first-child td:last-child")
    .innerText();
  expect(rss).toMatch(/MiB|GiB|KiB/);
  await page.locator("#pause").click();
  await expect(page.locator("#live-state")).toHaveText("已暂停");
  await expect(page.locator("#interval")).toHaveValue("30");
  expect(
    await page
      .locator("#interval option")
      .evaluateAll((options) => options.map((option) => option.value)),
  ).toEqual(["30", "60", "600"]);
  await page.locator("#interval").selectOption("60");
  await page.locator("#refresh-status").click();
  await expect(page.locator("#refresh-status")).toBeEnabled();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await mkdir("work/status-screenshots", { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `work/status-screenshots/${info.project.name}.png`,
    fullPage: true,
  });
  await page.screenshot({
    path: `work/status-screenshots/${info.project.name}-viewport.png`,
  });
  await page.locator("#server-select").selectOption("intranet");
  await expect(page.locator("#gpu-cards .gpu-card")).toHaveCount(8);
  await expect(page.locator("#gpu-summary")).toContainText("8 / 8");
  await expect(page.locator("#gpu-live-summary article")).toHaveCount(4);
  await expect(page.locator("#gpu-live-summary")).toContainText("640 GiB");
  await expect(page.locator("#cpu-cores .core-card")).toHaveCount(112);
  await expect(page.locator("#host-summary")).toContainText("192.168.2.201");
  await expect(page.locator("#maintenance")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: `work/status-screenshots/${info.project.name}-intranet.png`,
    fullPage: true,
  });
  await page
    .locator("#gpu-panel")
    .evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.screenshot({
    path: `work/status-screenshots/${info.project.name}-gpu.png`,
  });
  await page.reload();
  await expect(page.locator("#server-select")).toHaveValue("intranet");
  await expect(page.locator("#interval")).toHaveValue("60");
  await expect(page.locator("#gpu-cards .gpu-card")).toHaveCount(8);
  await page.locator("#server-select").selectOption("cloud");
  await expect(page.locator("#cpu-cores .core-card")).toHaveCount(2);
  await expect(page.locator("#gpu-panel")).toBeHidden();
  await expect(page.locator("#gpu-usage-panel")).toBeHidden();
  await page.getByRole("link", { name: "访问统计 ↗" }).click();
  await expect(page.locator("h1")).toHaveText("访问与视频统计");
  await expect
    .poll(
      async () =>
        (await context.request.get(url + "/statistics/api/report")).status(),
      { intervals: [1000, 2000, 5000], timeout: 12000 },
    )
    .toBe(200);
  expect(errors).toEqual([]);
});

test("GPU daily and weekly reports show actual aggregates, missing history and responsive layout", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const dailyResponse = page.waitForResponse((response) =>
    response.url().includes("/status/api/gpu-usage?group=day"),
  );
  await page.goto("/status?server=intranet");
  const response = await dailyResponse;
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.ready).toBe(true);
  expect(data.summary.sample_count).toBeGreaterThan(0);
  expect(data.summary.avg_compute).toBeGreaterThanOrEqual(0);
  expect(data.summary.avg_compute).toBeLessThanOrEqual(100);
  expect(data.summary.avg_capacity_bytes).toBe(640 * 1024 ** 3);
  await expect(page.locator("#gpu-usage-results")).toBeVisible();
  await expect(page.locator("#gpu-usage-rows tr")).toHaveCount(14);
  await expect(page.locator("#gpu-usage-summary article")).toHaveCount(4);
  await expect(page.locator("#gpu-usage-coverage")).toContainText("采样覆盖率");
  await expect(page.locator("#gpu-usage-recording")).toContainText("最早采样");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.locator("#pause").click();
  await mkdir("work/gpu-usage-screenshots", { recursive: true });
  await page.locator("#gpu-usage-panel").scrollIntoViewIfNeeded();
  await page.locator("#gpu-usage-panel").screenshot({
    path: `work/gpu-usage-screenshots/${info.project.name}-day.png`,
  });
  await page
    .locator("#gpu-usage-panel")
    .evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.screenshot({
    path: `work/gpu-usage-screenshots/${info.project.name}-viewport.png`,
  });
  const weekResponse = page.waitForResponse((r) =>
    r.url().includes("/status/api/gpu-usage?group=week"),
  );
  await page.locator("#gpu-usage-group").selectOption("week");
  const week = await (await weekResponse).json();
  expect(week.summary.sample_count).toBeGreaterThanOrEqual(
    data.summary.sample_count,
  );
  for (const period of week.periods)
    expect(new Date(period.label + "T00:00:00+08:00").getUTCDay()).toBe(0); // Beijing Monday is UTC Sunday.
  await expect(page.locator("#gpu-usage-rows tr")).toHaveCount(12);
  await expect(page.locator("#gpu-usage-caption")).toContainText("周一");
  await page.locator("#gpu-usage-panel").screenshot({
    path: `work/gpu-usage-screenshots/${info.project.name}-week.png`,
  });
  await page.locator("#gpu-usage-count").selectOption("4");
  await expect(page.locator("#gpu-usage-rows tr")).toHaveCount(4);
  await page.locator("#gpu-usage-through").fill("2020-02-01");
  await page.locator("#gpu-usage-through").blur();
  await expect(page.locator("#gpu-usage-message")).toContainText(
    "暂无有效采样",
  );
  await expect(page.locator("#gpu-usage-rows tr:first-child")).toContainText(
    "无数据",
  );
  await expect(
    page.locator("#gpu-usage-summary article:first-child strong"),
  ).toHaveText("—");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});

test("GPU query failure hides old totals and a server switch cancels pending reports", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "statistics-desktop" || !!process.env.GAASD_TEST_URL,
    "Synthetic failure and race checks run locally only.",
  );
  await page.goto("/status?server=intranet");
  await expect(page.locator("#gpu-usage-results")).toBeVisible();
  await page.route("**/status/api/gpu-usage*", (route) =>
    route.fulfill({ status: 503, json: { error: "test unavailable" } }),
  );
  await page.locator("#gpu-usage-query").click();
  await expect(page.locator("#gpu-usage-message")).toContainText(
    "暂时无法读取",
  );
  await expect(page.locator("#gpu-usage-results")).toBeHidden();
  await page.unroute("**/status/api/gpu-usage*");
  await page.route("**/status/api/gpu-usage*", async (route) => {
    await delay(1000);
    await route.continue().catch(() => {});
  });
  await page.locator("#gpu-usage-query").click();
  await page.locator("#server-select").selectOption("cloud");
  await expect(page.locator("#cpu-cores .core-card")).toHaveCount(2);
  await expect(page.locator("#gpu-usage-panel")).toBeHidden();
  await page.locator("#server-select").selectOption("intranet");
  await expect(page.locator("#gpu-usage-results")).toBeVisible();
});

test("stale and failed samples stay visibly flagged; periodic sampling advances", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "statistics-desktop",
    "Check polling and failure behavior once.",
  );
  await page.goto("/status");
  await expect(page.locator("#cpu-cores .core-card")).toHaveCount(2);
  if (process.env.GAASD_TEST_URL) {
    test.setTimeout(100000);
    const first = await page.locator("#status-updated").innerText();
    await expect
      .poll(() => page.locator("#status-updated").innerText(), {
        timeout: 75000,
      })
      .not.toBe(first);
    await expect(page.locator("#live-state")).toHaveText("实时更新");
  }
  await page.route("**/status/api/snapshot*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: { ...data, stale: true, age_seconds: 90 },
    });
  });
  await page.locator("#refresh-status").click();
  await expect(page.locator("#live-state")).toHaveText("采样已过期");
  await expect(page.locator("#status-error")).toContainText("90 秒未更新");
  await page.unroute("**/status/api/snapshot*");
  await page.route("**/status/api/snapshot*", (route) => route.abort("failed"));
  await page.locator("#refresh-status").click();
  await expect(page.locator("#live-state")).toHaveText("连接异常");
  await expect(page.locator("#status-error")).toContainText("保留最后一次采样");
  await expect(page.locator("#cpu-cores .core-card")).toHaveCount(2);
  await page.locator("#server-select").selectOption("intranet");
  await expect(page.locator("#status-error")).toContainText(
    "尚未取得服务器数据",
  );
  await expect(page.locator("#server-data")).toBeHidden();
});

test("refresh cadence is 30 / 60 / 600 seconds and pause stops polling", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "statistics-desktop");
  await page.clock.install();
  let count = 0;
  page.on("request", (request) => {
    if (request.url().includes("/status/api/snapshot")) count++;
  });
  await page.goto("/status");
  await expect(page.locator("#server-data")).toBeVisible();
  await expect(page.locator("#refresh-status")).toBeEnabled();
  const initial = count;
  await page.clock.fastForward(29000);
  expect(count).toBe(initial);
  await page.clock.fastForward(1000);
  await expect.poll(() => count).toBe(initial + 1);
  await expect(page.locator("#refresh-status")).toBeEnabled();
  for (const seconds of [60, 600]) {
    await page.locator("#interval").selectOption(String(seconds));
    const previous = count;
    await page.clock.fastForward((seconds - 1) * 1000);
    expect(count).toBe(previous);
    await page.clock.fastForward(1000);
    await expect.poll(() => count).toBe(previous + 1);
    await expect(page.locator("#refresh-status")).toBeEnabled();
  }
  await page.locator("#pause").click();
  const paused = count;
  await page.clock.fastForward(600000);
  expect(count).toBe(paused);
});
