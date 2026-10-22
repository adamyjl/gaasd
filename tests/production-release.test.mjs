import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("Chinese is the default homepage and the previous Chinese URL remains usable", async ({
  page,
  request,
}, info) => {
  test.skip(info.project.name !== "desktop", "Check compatibility once");
  for (const path of ["/", "/index.html", "/cn/"]) {
    await page.goto(path);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.locator("html")).toHaveAttribute(
      "data-video-language",
      "cn",
    );
    await expect(page.locator('[data-review-language="en"]')).toHaveAttribute(
      "href",
      "/en/",
    );
    await expect(page.locator('[data-review-language="cn"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  const entry = await request.get("/en");
  expect(entry.status()).toBe(200);
  expect(entry.url()).toMatch(/\/en\/$/);
});

for (const language of ["en", "cn"]) {
  test(`${language}: production home preserves review features and language navigation`, async ({
    page,
  }, info) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(language === "cn" ? "/" : "/en/");
    await page.reload();
    await expect(page.locator(".track-card")).toHaveCount(4);
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-preview",
      "true",
    );
    await expect(page.locator(".review-banner")).toHaveCount(0);
    await expect(
      page.locator('.language-switch [aria-current="page"]'),
    ).toHaveAttribute("data-review-language", language);
    await expect(page.locator(".language-switch")).toBeVisible();
    await expect(page.locator(".why-source-toggle")).toBeHidden();
    await expect(page.locator(".why-pdf-link")).toBeHidden();
    for (let step = 0; step < 4; step++) {
      await page.locator(".why-stage").nth(step).click();
      await expect(page.locator(".why-detail-number")).toHaveText(
        `0${step + 1} / 04`,
      );
    }
    await page.locator(".why-restart").click();
    await expect(page.locator(".why-detail-number")).toHaveText("01 / 04");
    await page.locator(".track-card").last().scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        page
          .locator("img[src]")
          .evaluateAll((images) =>
            images.every((img) => img.complete && img.naturalWidth > 0),
          ),
      )
      .toBe(true);
    const layout = await page.evaluate(() => ({
      width: window.innerWidth,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      cards: [...document.querySelectorAll(".track-card")].map((card) => {
        const box = card.getBoundingClientRect();
        return { x: Math.round(box.x), y: Math.round(box.y) };
      }),
    }));
    expect(layout.overflow).toBe(false);
    expect(new Set(layout.cards.map((card) => card.x)).size).toBe(
      layout.width >= 768 ? 2 : 1,
    );
    expect(new Set(layout.cards.map((card) => card.y)).size).toBe(
      layout.width >= 768 ? 2 : 4,
    );
    const folder =
      process.env.GAASD_RELEASE_SCREENSHOTS || "work/release-screenshots";
    await mkdir(folder, { recursive: true });
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.screenshot({
      path: `${folder}/${language}-${info.project.name}-full.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `${folder}/${language}-${info.project.name}-viewport.png`,
    });
    await page.locator(".why-cta").click();
    await expect(page).toHaveURL(/#tracks$/);
    const link = await page
      .locator(`[data-review-language="${language === "en" ? "cn" : "en"}"]`)
      .boundingBox();
    await page.mouse.click(link.x + link.width / 2, link.y + link.height / 2);
    await expect(page).toHaveURL(
      language === "en" ? /\/#tracks$/ : /\/en\/#tracks$/,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      language === "en" ? "zh-CN" : "en",
    );
    expect(errors).toEqual([]);
  });
}

test("production analytics remains enabled without writing QA events to the server", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "desktop",
    "Run the intercepted analytics check once",
  );
  const events = [];
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "webdriver", { get: () => false }),
  );
  await page.route("**/api/analytics/events", async (route) => {
    events.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await page.goto("/");
  await expect
    .poll(() => events.some((event) => event.kind === "page_view"))
    .toBe(true);
  await page.locator('.track-card[data-video-id="ai-assist"]').click();
  await expect
    .poll(() =>
      page
        .locator("#media-video")
        .evaluate((video) => video.currentTime > 0.2 && !video.paused),
    )
    .toBe(true);
  await page.locator(".media-close").click();
  await expect
    .poll(() =>
      events.some(
        (event) => event.kind === "video" && event.video_id === "ai-assist",
      ),
    )
    .toBe(true);
});
