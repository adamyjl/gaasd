import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { sample } from "./status-fixtures.mjs";

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
  await expect(page.locator(".fleet-card")).toHaveCount(8);
  await expect(page.locator("#fleet-counts")).toHaveText(
    "3 台 GPU 服务器 · 3 台开发机器 · 2 台中转机器",
  );
  for (const [group, names] of [
    [
      "gpu-hosts",
      ["清华 · 8×A100", "研究院 · 8×RTX 4090", "研究院 · 8×RTX 5090"],
    ],
    [
      "dev-hosts",
      [
        "研究院办公室 · Ubuntu 3060 Ti",
        "清华办公室 · RTX PRO 6000 · 01",
        "清华办公室 · RTX PRO 6000 · 02",
      ],
    ],
    ["relay-hosts", ["清华腾讯云服务器", "研究院 Windows 中转机"]],
  ]) {
    await expect(page.locator(`#${group} .fleet-card h3`)).toHaveText(names);
  }
  const overview = await (
    await page.request.get(base + "/status1/api/overview")
  ).json();
  const offline = overview.hosts.filter(
    (host) => host.stale || host.unavailable,
  );
  if (!live) expect(offline).toEqual([]);
  await expect(page.locator("#fleet-summary")).toContainText(
    `${8 - offline.length} / 8`,
  );
  await expect(page.locator("#fleet-summary")).toContainText(
    `${overview.hosts.filter((host) => !host.unavailable).reduce((count, host) => count + (host.gpu?.devices?.length || 0), 0)} / 28`,
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
  const secondResponse = page.waitForResponse((response) =>
    response.url().includes("/status5/api/snapshot?server=pro6000-02"),
  );
  await page.locator("#server-select").selectOption("pro6000-02");
  expect((await (await secondResponse).json()).server.id).toBe("pro6000-02");
  await expect(page).toHaveURL(/server=pro6000-02/);
  await expect(page.locator("#gpu-cards .gpu-card")).toHaveCount(1);
  await expect(page.locator("#host-summary")).toContainText("第二台");
  await overflow();
  await page.reload();
  await expect(page.locator("#server-select")).toHaveValue("pro6000-02");
  await page.locator("#server-select").selectOption("pro6000");
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

test("summary counts latest offline samples and deduplicates local disks", async ({
  page,
}, info) => {
  test.skip(
    Boolean(process.env.GAASD_TEST_URL),
    "Synthetic API coverage runs locally",
  );
  const GiB = 1024 ** 3;
  const volume = (device, total, used, free, extra = {}) => ({
    device,
    mount: device,
    kind: "local",
    filesystem: "ext4",
    total: total * GiB,
    used: used * GiB,
    free: free * GiB,
    ...extra,
  });
  const hosts = [
    {
      ...sample(false),
      stale: false,
      server: {
        id: "cloud",
        name: "测试云主机",
        group: "中转机器",
        expected_gpus: 0,
        href: "/status",
      },
      filesystems: [
        volume("/dev/test", 100, 25, 70),
        volume("/dev/test", 100, 25, 70, { mount: "/duplicate" }),
        volume("tmpfs", 1000, 999, 1, { kind: "memory" }),
        volume("remote:/data", 1000, 999, 1, { kind: "remote" }),
        volume("overlay", 1000, 999, 1, { filesystem: "overlay" }),
        volume("/dev/loop0", 1000, 999, 1),
      ],
    },
    {
      ...sample(true),
      stale: true,
      generated_at: Date.now() / 1000 - 86400,
      host: { logical_cpus: 8 },
      cpu: { percent: 50 },
      server: {
        id: "cached",
        name: "测试离线机器",
        group: "GPU 服务器",
        expected_gpus: 8,
        href: "/status4",
      },
      filesystems: [volume("C:", 200, 50, 120), volume("c:\\", 200, 50, 120)],
    },
    {
      unavailable: true,
      stale: true,
      server: {
        id: "missing",
        name: "无采样机器",
        expected_gpus: 0,
        group: "开发机器",
        href: "/status",
      },
    },
  ];
  await page.route("**/status1/api/overview", (route) =>
    route.fulfill({ json: { generated_at: Date.now() / 1000, hosts } }),
  );
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/status1");
  const metric = (label) =>
    page.locator("#fleet-summary article").filter({
      has: page.locator("p", { hasText: new RegExp(`^${label}$`) }),
    });
  await expect(metric("在线主机")).toContainText("1 / 3");
  await expect(metric("逻辑 CPU")).toContainText("10");
  await expect(metric("CPU 整体占用")).toContainText("42.4%");
  await expect(metric("硬盘总容量")).toContainText("300 GiB");
  await expect(metric("硬盘总容量")).toContainText("2 / 3 台 · 2 个本地卷");
  await expect(metric("硬盘已用空间")).toContainText("75 GiB");
  await expect(metric("硬盘已用空间")).toContainText("25%");
  await expect(metric("硬盘可用空间")).toContainText("190 GiB");
  await expect(page.locator("#summary-note")).toContainText(
    "含 1 台离线 / 过期缓存",
  );
  await expect(page.locator("#summary-note")).toContainText("测试离线机器");
  await expect(page.locator("#summary-note")).toContainText("1 台尚无采样");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await mkdir("work/fleet-disk-screenshots", { recursive: true });
  await page.screenshot({
    path: `work/fleet-disk-screenshots/${info.project.name}-cached.png`,
    fullPage: true,
  });
  hosts[1].stale = false;
  hosts[1].generated_at = Date.now() / 1000;
  await page.locator("#refresh").click();
  await expect(metric("在线主机")).toContainText("2 / 3");
  await expect(metric("硬盘总容量")).toContainText("300 GiB");
  await expect(page.locator("#summary-note")).not.toContainText(
    "离线 / 过期缓存",
  );
  expect(errors).toEqual([]);
});

test("unreadable or absent disks stay unknown instead of showing zero", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.GAASD_TEST_URL),
    "Synthetic API coverage runs locally",
  );
  await page.route("**/status1/api/overview", (route) =>
    route.fulfill({
      json: {
        generated_at: Date.now() / 1000,
        hosts: [
          {
            ...sample(false),
            stale: true,
            server: {
              id: "cloud",
              name: "测试",
              group: "中转机器",
              expected_gpus: 0,
            },
            filesystems: [
              { device: "/dev/missing", kind: "local" },
              {
                device: "/dev/bad",
                kind: "local",
                total: 100,
                used: -1,
                free: 101,
              },
            ],
          },
        ],
      },
    }),
  );
  await page.goto("/status1");
  const disks = page
    .locator("#fleet-summary article")
    .filter({ hasText: /硬盘/ });
  await expect(disks.locator("strong")).toHaveText(["—", "—", "—"]);
  await expect(disks).toHaveCount(3);
  await expect(page.locator("#fleet-summary")).toContainText("2 卷数据缺失");
  await expect(page.locator("#fleet-summary")).toContainText("总使用率 未提供");
});
