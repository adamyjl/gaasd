import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";

const credentials = process.env.GAASD_STATISTICS_CREDENTIALS
  ? JSON.parse(await readFile(process.env.GAASD_STATISTICS_CREDENTIALS, "utf8"))
  : { username: "qa", password: "local-test-only" };
test.use({ httpCredentials: credentials });

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
  const url = process.env.GAASD_TEST_URL || "http://127.0.0.1:4173";
  for (const path of [
    "/status",
    "/status/api/snapshot",
    "/status/assets/status.js",
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
  await page.locator("#interval").selectOption("10");
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
  await page.getByRole("link", { name: "访问统计 ↗" }).click();
  await expect(page.locator("h1")).toHaveText("访问与视频统计");
  expect(
    (await context.request.get(url + "/statistics/api/report")).status(),
  ).toBe(200);
  expect(errors).toEqual([]);
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
    const first = await page.locator("#status-updated").innerText();
    await expect
      .poll(() => page.locator("#status-updated").innerText(), {
        timeout: 16000,
      })
      .not.toBe(first);
    await expect(page.locator("#live-state")).toHaveText("实时更新");
  }
  await page.route("**/status/api/snapshot", async (route) => {
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
  await page.unroute("**/status/api/snapshot");
  await page.route("**/status/api/snapshot", (route) => route.abort("failed"));
  await page.locator("#refresh-status").click();
  await expect(page.locator("#live-state")).toHaveText("连接异常");
  await expect(page.locator("#status-error")).toContainText("保留最后一次采样");
  await expect(page.locator("#cpu-cores .core-card")).toHaveCount(2);
});
