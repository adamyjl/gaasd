import { test, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const credentials = process.env.GAASD_STATISTICS_CREDENTIALS
  ? JSON.parse(await readFile(process.env.GAASD_STATISTICS_CREDENTIALS, "utf8"))
  : { username: "qa", password: "local-test-only" };
const auth = {
  Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`,
};
const output = path.resolve("work/statistics-screenshots");

test("public collection stores real playback and trusts only the server IP", async ({
  browser,
  request,
}, testInfo) => {
  test.skip(
    !process.env.GAASD_TEST_URL ||
      testInfo.project.name !== "statistics-desktop",
    "One tagged production check; excluded from visitor totals as automatic traffic.",
  );
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/144.0.0.0 Safari/537.36 GAASD-QA/1.0",
    extraHTTPHeaders: { "X-Real-IP": "203.0.113.199" },
  });
  const page = await context.newPage();
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "webdriver", { get: () => false }),
  );
  let visitId;
  await page.route("**/api/analytics/events", async (route) => {
    const payload = route.request().postDataJSON();
    if (payload) visitId = payload.visit_id;
    await route.continue();
  });
  await page.goto(process.env.GAASD_TEST_URL);
  await page.locator(".overview-video").click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((video) => video.currentTime > 2),
    )
    .toBe(true);
  const recorded = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/analytics/events") &&
      response.request().postDataJSON()?.phase === "close",
  );
  await page.locator(".media-close").click();
  expect((await recorded).status()).toBe(204);
  const response = await request.get("/statistics/api/report?bots=1&size=100", {
    headers: auth,
  });
  expect(response.status()).toBe(200);
  const data = await response.json();
  const visit = data.visits.find((row) => row.id === visitId);
  expect(visit).toBeTruthy();
  expect(visit.is_bot).toBe(1);
  expect(visit.ip).not.toBe("203.0.113.199");
  expect(visit.videos[0].video_id).toBe("overview");
  expect(visit.videos[0].watched_ms).toBeGreaterThan(500);
  expect(visit.videos[0].watched_ms).toBeLessThan(10000);
  await context.close();
});

test("private dashboard, filters, detail rows, CSV and responsive layout", async ({
  browser,
  request,
}, testInfo) => {
  await mkdir(output, { recursive: true });
  const denied = await request.get("/statistics/api/report");
  expect(denied.status()).toBe(401);
  expect(denied.headers()["cache-control"]).toContain("no-store");
  if (!process.env.GAASD_TEST_URL) {
    const seed = {
      kind: "video",
      visit_id: crypto.randomUUID(),
      session_id: crypto.randomUUID(),
      path: "/",
      video_id: "overview",
      play_id: crypto.randomUUID(),
      phase: "progress",
      watched_ms: 4500,
      position: 5,
      coverage: 0.2,
      referrer: "https://example.com/demo?token=redacted",
    };
    const response = await request.post("/api/analytics/events", {
      data: seed,
      headers: {
        Origin: "http://127.0.0.1:4173",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/144.0.0.0 Safari/537.36",
      },
    });
    expect(response.status()).toBe(204);
  }
  const context = await browser.newContext({
    ...testInfo.project.use,
    httpCredentials: {
      username: credentials.username,
      password: credentials.password,
    },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    `${testInfo.project.use.baseURL || process.env.GAASD_TEST_URL || "http://127.0.0.1:4173"}/statistics`,
  );
  await expect(page.locator("#metric-pv")).not.toHaveText("—");
  await expect(page.locator("#video-rows>tr")).toHaveCount(5);
  await expect(page.locator("#message")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(output, `${testInfo.project.name}.png`),
    fullPage: true,
  });
  await page.screenshot({
    path: path.join(output, `${testInfo.project.name}-viewport.png`),
  });
  await page.locator('[data-days="1"]').click();
  await expect(page.locator('[data-days="1"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#updated")).toContainText("更新于");
  if (await page.locator(".detail-button").count()) {
    await page.locator(".detail-button").first().click();
    await expect(page.locator(".detail-cell").first()).toBeVisible();
  }
  await page.locator("input[name=q]").fill("no-matching-region-gaasd");
  await page.locator(".apply-button").click();
  await expect(page.locator("#metric-pv")).toHaveText("0");
  await expect(page.locator("#visit-rows")).toContainText("暂无访问记录");
  await page.locator("input[name=q]").fill("");
  await page.locator(".apply-button").click();
  await expect(page.locator("#updated")).toContainText("更新于");
  const csv = await request.get("/statistics/api/export.csv", {
    headers: auth,
  });
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("访问时间");
  expect(errors).toEqual([]);
  await context.close();
});

test("real video tracking measures playback, ignores seeking, and honors opt-out", async ({
  page,
}, testInfo) => {
  test.skip(
    Boolean(process.env.GAASD_TEST_URL) ||
      testInfo.project.name !== "statistics-desktop",
    "Synthetic recording is tested only against the local service.",
  );
  const events = [];
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "webdriver", { get: () => false }),
  );
  await page.route("**/api/analytics/events", async (route) => {
    events.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.goto("/");
  await expect
    .poll(() => events.filter((event) => event.kind === "page_view").length)
    .toBe(1);
  await page.locator(".overview-video").click();
  await expect
    .poll(() => events.some((event) => event.phase === "start"))
    .toBe(true);
  await expect
    .poll(() =>
      page.locator("video").evaluate((video) => video.currentTime > 2),
    )
    .toBe(true);
  await page.locator("video").evaluate((video) => {
    video.currentTime = 20;
  });
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((video) => video.currentTime > 20.5 && !video.seeking),
    )
    .toBe(true);
  await page.locator(".media-close").click();
  await expect
    .poll(() => events.some((event) => event.phase === "close"))
    .toBe(true);
  const collected = events.filter((event) => event.kind === "video");
  const final = collected.at(-1);
  expect(final.watched_ms).toBeGreaterThan(500);
  expect(final.watched_ms).toBeLessThan(8000);
  expect(final.position).toBeGreaterThan(20);
  expect(final.coverage).toBeLessThan(0.5);
  expect(new Set(collected.map((event) => event.play_id)).size).toBe(1);
  await page.goto("/privacy.html");
  await page.locator("#privacy-toggle").click();
  await expect(page.locator("#privacy-status")).toContainText("disabled");
  const count = events.length;
  await page.goto("/");
  await page.locator(".overview-video").click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((video) => video.currentTime > 1),
    )
    .toBe(true);
  await page.locator(".media-close").click();
  expect(events).toHaveLength(count);
});
