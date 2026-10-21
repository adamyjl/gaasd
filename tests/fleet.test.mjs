import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const credentials = process.env.GAASD_STATISTICS_CREDENTIALS
  ? JSON.parse(await readFile(process.env.GAASD_STATISTICS_CREDENTIALS, "utf8"))
  : { username: "qa", password: "local-test-only" };
test.use({ httpCredentials: { ...credentials, send: "always" } });

test("fleet overview, workstation details, separate GPU histories and shared login", async ({
  page,
  browser,
}, info) => {
  const live = Boolean(process.env.GAASD_TEST_URL);
  const base = process.env.GAASD_TEST_URL || "http://127.0.0.1:4174";
  if (live) await delay(6000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      new URL(response.url()).pathname.startsWith("/status")
    )
      errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  const anonymous = await browser.newContext({ httpCredentials: undefined });
  for (const path of [
    "/status1",
    "/status3",
    "/status4",
    "/status5",
    "/status5/api/snapshot",
    "/status5/api/history",
    "/status1/api/overview",
    "/status3/api/snapshot",
    "/status4/api/gpu-usage",
    "/status/assets/fleet.js",
  ]) {
    const response = await anonymous.request.get(base + path);
    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toContain(
      "GAASD Statistics",
    );
  }
  await anonymous.close();
  const overflow = async () =>
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
  await mkdir("work/fleet-screenshots", { recursive: true });
  await page.goto("/status1");
  await expect(page.locator(".fleet-card")).toHaveCount(7);
  const overview = await (
    await page.request.get(base + "/status1/api/overview")
  ).json();
  const offline = overview.hosts.filter(
    (host) => host.stale || host.unavailable,
  );
  // Production Windows has a documented pre-existing SSH outage. The new
  // workstation and every other host must still be fresh; fixtures must all pass.
  expect(offline.every((host) => live && host.server.id === "windows")).toBe(
    true,
  );
  await expect(page.locator("#fleet-summary")).toContainText(
    `${7 - offline.length} / 7`,
  );
  await expect(page.locator("#fleet-summary")).toContainText(
    `${27 - offline.length} / 27`,
  );
  await overflow();
  await page.screenshot({
    path: `work/fleet-screenshots/${info.project.name}-overview.png`,
    fullPage: true,
  });
  await page.locator("#pause").click();
  await expect(page.locator("#pause")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#interval").selectOption("60");
  await page.locator("#refresh").click();
  await expect(page.locator("#refresh")).toBeEnabled();
  if (live) await delay(5000);
  await page.goto("/status3");
  await expect(page.locator("#server-select")).toHaveValue("windows");
  await expect(page.locator("#cpu-cores .core-card")).toHaveCount(8);
  await expect(page.locator("#gpu-cards .gpu-card")).toHaveCount(1);
  await expect(page.locator("#hardware-panel")).toBeVisible();
  await expect(page.locator("#software-panel")).toBeVisible();
  await expect(page.locator("#gpu-usage-panel")).toBeHidden();
  await overflow();
  await page.screenshot({
    path: `work/fleet-screenshots/${info.project.name}-windows.png`,
    fullPage: true,
  });
  if (live) await delay(5000);
  await page.goto("/status4?server=rtx5090");
  await expect(page.locator("#server-select")).toHaveValue("rtx5090");
  await expect(page.locator("#gpu-cards .gpu-card")).toHaveCount(8);
  await expect(page.locator("#gpu-usage-results")).toBeVisible();
  await expect(page.locator("#host-summary")).toContainText("192.168.1.111");
  await page.locator("#server-select").selectOption("rtx4090");
  await expect(page.locator("#host-summary")).toContainText("192.168.1.19");
  await expect(page.locator("#gpu-cards .gpu-card")).toHaveCount(8);
  await expect(page.locator("#gpu-usage-results")).toBeVisible();
  await page.locator("#gpu-usage-group").selectOption("week");
  await expect(page.locator("#gpu-usage-caption")).toContainText("每周");
  await expect(page.locator("#gpu-usage-rows tr")).toHaveCount(12);
  await overflow();
  await page.screenshot({
    path: `work/fleet-screenshots/${info.project.name}-4090.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator("#server-select")).toHaveValue("rtx4090");
  await expect(page.locator("#gpu-cards .gpu-card")).toHaveCount(8);
  if (live) await delay(5000);
  await page.goto("/status?server=intranet");
  await expect(page.locator("#gpu-cards .gpu-card")).toHaveCount(8);
  await expect(page.locator("#gpu-usage-results")).toBeVisible();
  if (live) await delay(5000);
  await page.goto("/status5");
  await expect(page.locator("#server-select")).toHaveValue("pro6000");
  await expect(page.locator("#gpu-cards .gpu-card")).toHaveCount(1);
  await expect(page.locator("#gpu-cards")).toContainText("RTX PRO 6000");
  await expect(page.locator("#hardware-panel")).toBeVisible();
  await expect(page.locator("#gpu-usage-panel")).toBeHidden();
  await overflow();
  await page.screenshot({
    path: `work/fleet-screenshots/${info.project.name}-pro6000.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator("#server-select")).toHaveValue("pro6000");
  expect(errors).toEqual([]);
});
