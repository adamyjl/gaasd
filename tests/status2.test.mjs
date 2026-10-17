import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const credentialPath = process.env.GAASD_STATISTICS_CREDENTIALS;
const credentials = credentialPath
  ? JSON.parse(await readFile(credentialPath, "utf8"))
  : undefined;
test.skip(
  !credentialPath || !process.env.GAASD_STATUS2_URL,
  "Explicit deployed URL and temporary admin credentials required.",
);
test.use({
  httpCredentials: credentials ? { ...credentials, send: "always" } : undefined,
});
test.beforeEach(async () => {
  await delay(5000);
});

test("office proxy shares authentication and protects assets and all APIs", async ({
  browser,
  request,
}, info) => {
  test.skip(
    info.project.name !== "office-desktop",
    "Check authorization once.",
  );
  const origin = process.env.GAASD_STATUS2_URL;
  const unauth = await browser.newContext({ httpCredentials: undefined });
  for (const path of [
    "/status2/",
    "/status2/app.js",
    "/status2/style.css",
    "/status2/api/status",
    "/status2/api/events",
    "/status2/api/inventory",
    "/status2/api/history?id=unknown&hours=1",
  ]) {
    const response = await unauth.request.get(origin + path);
    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toContain(
      'Basic realm="GAASD Statistics"',
    );
  }
  const denied = await unauth.request.get(origin + "/status2/api/status", {
    headers: {
      Authorization:
        "Basic " + Buffer.from("invalid:invalid").toString("base64"),
    },
  });
  expect(denied.status()).toBe(401);
  expect(
    (await unauth.request.get(origin + "/_gaasd_status2_auth")).status(),
  ).toBe(404);
  await unauth.close();
  for (const path of [
    "/status2/",
    "/status",
    "/statistics",
    "/status/api/snapshot?server=intranet",
  ])
    expect((await request.get(origin + path)).status()).toBe(200);
  expect(
    (await request.post(origin + "/status2/api/status", { data: {} })).status(),
  ).toBe(403);
});

test("office monitor loads real GPU data, prefixed assets and history on every viewport", async ({
  page,
}, info) => {
  const errors = [],
    paths = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => paths.push(new URL(request.url()).pathname));
  const dataResponse = page.waitForResponse(
    (r) => r.url().endsWith("/status2/api/status") && r.status() === 200,
  );
  await page.goto("/status2");
  await expect(page).toHaveURL(/\/status2\/$/);
  const snapshot = await (await dataResponse).json();
  expect(snapshot.hostname).toBe("tsari");
  expect(snapshot.gpus[0].name).toContain("3060 Ti");
  expect(snapshot.gpus[0].memory_total).toBe(8192);
  expect(snapshot.stale).toBe(false);
  await expect(page.locator("#host")).toContainText("tsari");
  await expect(page.locator("#summary .metric")).toHaveCount(4);
  await expect(page.locator(".gpu-card")).toContainText("3060 Ti");
  await expect(page.locator("#connection")).toContainText("采集在线");
  await expect(page.locator("#chart-note")).toContainText("数据点");
  await expect(page.locator("#inventory")).not.toContainText("正在加载");
  await expect(page.locator("#offline")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  const history = page.waitForResponse(
    (r) =>
      r.url().includes("/status2/api/history?") &&
      r.url().includes("hours=168"),
  );
  await page.locator("#range").selectOption("168");
  expect((await history).status()).toBe(200);
  await page.locator("#refresh").click();
  await expect(page.locator("#offline")).toBeHidden();
  await mkdir("work/status2-screenshots", { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `work/status2-screenshots/${info.project.name}.png`,
    fullPage: true,
  });
  await page.screenshot({
    path: `work/status2-screenshots/${info.project.name}-viewport.png`,
  });
  await page.reload();
  await expect(page.locator("#connection")).toContainText("采集在线");
  expect(
    paths.some(
      (path) =>
        path.startsWith("/api/") || path === "/app.js" || path === "/style.css",
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});
