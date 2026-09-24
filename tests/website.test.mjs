import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const expectedTitles = [
  "Decouple Software Layers",
  "Reuse Proven Components",
  "Refactor Visually With AI",
];
const sources = {
  overview: "media/present2/en/overview-en-ja-20260914.mp4",
  platform: "media/present2/en/platform-20260915.mp4",
  "ai-assist": "media/present2/en/ai-assist.mp4",
  nnide: "media/present2/en/nnide-20260916.mp4",
  vla: "media/present2/en/vla-20260916.mp4",
};
const screenshots = path.resolve("work/screenshots");

test("breakpoint edges keep navigation, headings and cards inside the viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Run the width sweep once.");
  await page.goto("/");
  for (const width of [340, 360, 600, 767, 768, 820, 1199, 1200, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => {
      const offenders = [
        ...document.querySelectorAll(
          ".header-inner > *, h1 span, .track-title, .track-mobile-description, .track-description",
        ),
      ].filter((element) => {
        if (!element.getClientRects().length) return false;
        const range = document.createRange();
        range.selectNodeContents(element);
        const box = range.getBoundingClientRect();
        return box.right > window.innerWidth || box.left < 0;
      });
      return {
        scroll: document.documentElement.scrollWidth > window.innerWidth,
        offenders: offenders.map((element) => element.textContent),
      };
    });
    expect(overflow, `Width ${width}`).toEqual({
      scroll: false,
      offenders: [],
    });
  }
});

test("responsive layout, content, real images and screenshots", async ({
  page,
}, testInfo) => {
  const errors = [];
  const mediaRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/media/")) mediaRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator(".track-card")).toHaveCount(4);
  await expect(page.locator("h1 span")).toHaveText(expectedTitles);
  await expect(page.locator(".metric")).toHaveCount(2);
  await expect(page.locator(".eyebrow")).toHaveText("CBDES = CBB + GAASD");
  expect(await page.locator("body").innerText()).not.toMatch(
    /资产|生命周期|Lorem Ipsum/,
  );
  await page.locator(".track-card").last().scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    [...document.images].every((img) => img.complete && img.naturalWidth > 0),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(0, 0);
  const layout = await page.evaluate(() => {
    const rect = (selector) =>
      [...document.querySelectorAll(selector)].map((element) => {
        const box = element.getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          right: box.right,
          bottom: box.bottom,
        };
      });
    return {
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      titles: rect("h1 span"),
      cards: rect(".track-card"),
      poster: rect(".track-image"),
      copy: rect(".track-copy"),
      overview: rect(".overview-video")[0],
      systems: rect(".systems")[0],
      metrics: rect(".metric"),
      gradients: [...document.querySelectorAll("*")].filter((element) =>
        window.getComputedStyle(element).backgroundImage.includes("gradient"),
      ).length,
      background: window.getComputedStyle(document.body).backgroundColor,
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  expect(layout.gradients).toBe(0);
  expect(layout.background).toBe("rgb(11, 11, 11)");
  expect(layout.overview.width / layout.overview.height).toBeCloseTo(16 / 9, 1);
  for (const poster of layout.poster)
    expect(poster.width / poster.height).toBeCloseTo(16 / 9, 1);
  for (const line of layout.titles) {
    expect(line.right).toBeLessThanOrEqual(layout.width - 18);
    if (layout.width >= 1200)
      expect(line.height).toBeCloseTo(layout.titles[0].height, 0);
  }
  expect(layout.metrics[0].width).toBeCloseTo(layout.metrics[1].width, 0);
  const expectedColumns =
    layout.width >= 1200 ? 4 : layout.width >= 768 ? 2 : 1;
  expect(
    layout.cards.filter((box) => Math.abs(box.y - layout.cards[0].y) < 2),
  ).toHaveLength(expectedColumns);
  if (layout.width < 768) {
    await expect(page.locator(".menu-toggle")).toBeVisible();
    await expect(page.locator(".desktop-nav")).toBeHidden();
    await expect(page.locator(".brand-full")).toBeHidden();
    expect(layout.systems.bottom).toBeLessThan(layout.overview.y);
    const playTargets = await page
      .locator(".play-square")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        })),
      );
    for (const size of playTargets) {
      expect(size.width).toBeGreaterThanOrEqual(44);
      expect(size.height).toBeGreaterThanOrEqual(44);
    }
    if (layout.width >= 340)
      expect(layout.poster[0].right).toBeLessThanOrEqual(layout.copy[0].x + 1);
    else
      expect(layout.poster[0].bottom).toBeLessThanOrEqual(layout.copy[0].y + 1);
  } else {
    await expect(page.locator(".desktop-nav")).toBeVisible();
    await expect(page.locator(".menu-toggle")).toBeHidden();
  }
  expect(mediaRequests).toHaveLength(0);
  expect(errors).toHaveLength(0);
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: path.join(screenshots, `gaasd-${testInfo.project.name}.png`),
    fullPage: true,
  });
  if (layout.width >= 768)
    await page.screenshot({
      path: path.join(
        screenshots,
        `gaasd-${testInfo.project.name}-viewport.png`,
      ),
    });
});

test("navigation, keyboard focus and mobile menu", async ({ page }) => {
  await page.goto("/");
  const mobile = page.viewportSize().width < 768;
  if (mobile) {
    const toggle = page.locator(".menu-toggle");
    await toggle.click();
    await expect(page.locator("#mobile-menu")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("body")).toHaveClass(/scroll-locked/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#mobile-menu")).not.toBeVisible();
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    for (const anchor of ["tracks", "capabilities", "about", "overview"]) {
      await toggle.click();
      await page.locator(`#mobile-menu a[href="#${anchor}"]`).click();
      await expect(page).toHaveURL(new RegExp(`#${anchor}$`));
      await expect(page.locator("#mobile-menu")).not.toBeVisible();
      await expect(page.locator("body")).not.toHaveClass(/scroll-locked/);
    }
  } else {
    for (const anchor of ["tracks", "capabilities", "about", "overview"]) {
      await page.locator(`.desktop-nav a[href="#${anchor}"]`).click();
      await expect(page).toHaveURL(new RegExp(`#${anchor}$`));
    }
  }
  const trigger = page.locator(".overview-video");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#media-dialog")).toBeVisible();
  await expect(page.locator(".media-close")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#media-dialog")).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveClass(/scroll-locked/);
});

test("all five videos play, seek, switch and release on close", async ({
  page,
}, testInfo) => {
  test.setTimeout(150000);
  await page.goto("/");
  await page.locator(".overview-video").click();
  const video = page.locator("#media-video");
  const items = [
    ["overview", 28],
    ["platform", 207],
    ["ai-assist", 194],
    ["nnide", 296],
    ["vla", 275],
  ];
  for (const [id, duration] of items) {
    if (id !== "overview")
      await page.locator(`.media-switcher [data-video-id="${id}"]`).click();
    await expect(video).toHaveAttribute("src", sources[id]);
    await expect
      .poll(
        () =>
          video.evaluate(
            (element) =>
              element.readyState >= 2 &&
              !element.paused &&
              element.currentTime > 0.1,
          ),
        { timeout: 30000 },
      )
      .toBe(true);
    const actual = await video.evaluate((element) => ({
      duration: element.duration,
      error: element.error,
    }));
    expect(actual.error).toBeNull();
    expect(Math.abs(actual.duration - duration)).toBeLessThan(1);
    await video.evaluate((element) => {
      element.currentTime = 10;
    });
    await expect
      .poll(() =>
        video.evaluate(
          (element) => !element.seeking && element.currentTime >= 10,
        ),
      )
      .toBe(true);
    await expect(
      page.locator(`.media-switcher [data-video-id="${id}"]`),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await page.locator('.media-switcher [data-video-id="overview"]').click();
  await expect
    .poll(() =>
      video.evaluate(
        (element) =>
          element.currentTime > 10.2 &&
          !element.paused &&
          element.readyState >= 3,
      ),
    )
    .toBe(true);
  await expect(page.locator(".media-state")).toBeHidden();
  await expect(page.locator("video")).toHaveCount(1);
  await page.screenshot({
    path: path.join(screenshots, `gaasd-player-${testInfo.project.name}.png`),
  });
  await page.locator(".media-close").click();
  await expect(video).not.toHaveAttribute("src");
  expect(await video.evaluate((element) => element.paused)).toBe(true);
  await expect(page.locator(".overview-video")).toBeFocused();
  for (const [id] of items.slice(1)) {
    await page.locator(`.track-card[data-video-id="${id}"]`).click();
    await expect(video).toHaveAttribute("src", sources[id]);
    await page.keyboard.press("Escape");
  }
});

test("video failure shows a working retry action", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "One browser network failure check is sufficient.",
  );
  await page.route(`**/${sources.overview}`, (route) => route.abort("failed"));
  await page.goto("/");
  await page.locator(".overview-video").click();
  await expect(page.locator(".retry-button")).toBeVisible();
  await expect(page.locator(".media-message")).toHaveText(
    "Unable to load the video. Please try again.",
  );
  await expect(page.locator(".retry-button")).toHaveText("Retry playback");
  await page.unroute(`**/${sources.overview}`);
  await page.locator(".retry-button").click();
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((element) => element.currentTime > 0.1 && !element.paused),
    )
    .toBe(true);
  await expect(page.locator(".media-state")).toBeHidden();
});

test("media endpoint supports range requests for seeking", async ({
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "One HTTP range check is sufficient.",
  );
  const response = await request.get("/media/overview.mp4", {
    headers: { Range: "bytes=0-3" },
  });
  expect(response.status()).toBe(206);
  expect(response.headers()["content-range"]).toMatch(/^bytes 0-3\/\d+$/);
  expect((await response.body()).length).toBe(4);
  const invalid = await request.get("/media/overview.mp4", {
    headers: { Range: "bytes=9999999999-" },
  });
  expect(invalid.status()).toBe(416);
  const health = await request.get("/healthz");
  expect((await health.json()).status).toBe("ok");
});
