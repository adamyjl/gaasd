import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const media = {
  en: [207.04, 193.98, 296.34, 274.81],
  cn: [207.04, 193.98, 282.64, 274.81],
};
const ids = ["platform", "ai-assist", "nnide", "vla"];
const titles = {
  en: [
    "Graphical Development Platform Base",
    "LLM-Assisted Graphical Development Platform",
    "Graphic Neural Network IDE",
    "Multimodal Model Development Platform",
  ],
  cn: ["平台与功能软件", "AI 辅助开发", "神经网络开发", "VLM / VLA 开发"],
};
for (const language of ["en", "cn"]) {
  test(`${language} edition plays the four numbered videos and preserves the page`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(150000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(language === "cn" ? "/cn" : "/");
    if (language === "cn") await expect(page).toHaveURL(/\/cn\/$/);
    await expect(page.locator("html")).toHaveAttribute(
      "data-video-language",
      language,
    );
    await expect(page.locator(".track-card")).toHaveCount(4);
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      language === "cn" ? "zh-CN" : "en",
    );
    await expect(page.locator(".track-title")).toHaveText(titles[language]);
    if (language === "en") {
      const text = (await page.locator("body").textContent())
        .replaceAll("京ICP备2026057773号", "")
        .replaceAll("京公网安备11010802050298号", "");
      expect(text).not.toMatch(/\p{Script=Han}/u);
      const labels = await page
        .locator("[aria-label], [alt]")
        .evaluateAll((elements) =>
          elements
            .map(
              (el) =>
                `${el.getAttribute("aria-label") || ""} ${el.getAttribute("alt") || ""}`,
            )
            .join(" "),
        );
      expect(labels).not.toMatch(/\p{Script=Han}/u);
    }
    await expect(page.locator(".footer-full")).toContainText("AI-Augmented");
    await expect(page.locator(".privacy-footer")).toContainText(
      "京ICP备2026057773号",
    );
    await page.locator(".overview-video").click();
    const video = page.locator("#media-video");
    await expect(video).toHaveAttribute(
      "src",
      language === "cn"
        ? "/media/overview.mp4"
        : "media/present2/en/overview-en-ja-20260914.mp4",
    );
    await expect
      .poll(() => video.evaluate((v) => v.currentTime > 0.1 && !v.paused), {
        timeout: 20000,
      })
      .toBe(true);
    for (const [index, id] of ids.entries()) {
      await page.locator(`.media-switcher [data-video-id="${id}"]`).click();
      await expect(page.locator("#media-title")).toHaveText(
        titles[language][index],
      );
      const filename =
        id === "platform"
          ? "platform-20260915"
          : id === "nnide" || id === "vla"
            ? `${id}-20260916`
            : id;
      const src = `/media/present2/${language}/${filename}.mp4`;
      await expect(video).toHaveAttribute(
        "src",
        language === "cn" ? src : src.slice(1),
      );
      await expect
        .poll(
          () =>
            video.evaluate(
              (v) => v.readyState >= 2 && !v.paused && v.currentTime > 0.2,
            ),
          { timeout: 30000 },
        )
        .toBe(true);
      const actual = await video.evaluate((v) => ({
        duration: v.duration,
        width: v.videoWidth,
        height: v.videoHeight,
        error: v.error,
        muted: v.muted,
      }));
      expect(Math.abs(actual.duration - media[language][index])).toBeLessThan(
        0.3,
      );
      expect(actual).toMatchObject({
        width: 1920,
        height: 1080,
        error: null,
        muted: false,
      });
      await video.evaluate((v) => {
        v.currentTime = v.duration - 3;
      });
      await expect
        .poll(
          () =>
            video.evaluate(
              (v) =>
                !v.seeking &&
                v.currentTime >= v.duration - 4 &&
                v.readyState >= 2,
            ),
          { timeout: 30000 },
        )
        .toBe(true);
      await expect(video).toHaveJSProperty("error", null);
      const range = await request.get(src, {
        headers: { Range: "bytes=0-1023" },
      });
      expect(range.status()).toBe(206);
      expect((await range.body()).length).toBe(1024);
    }
    await page.locator(".media-close").click();
    await expect(video).not.toHaveAttribute("src");
    await page.locator(".track-card").last().scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      [...document.images].every((img) => img.complete && img.naturalWidth > 0),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
    if (info.project.name === "mobile") {
      await page.locator(".menu-toggle").click();
      await page.locator('#mobile-menu a[href="#tracks"]').click();
      await expect(page).toHaveURL(
        language === "cn" ? /\/cn\/#tracks$/ : /\/#tracks$/,
      );
    }
    await mkdir("work/bilingual-screenshots", { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `work/bilingual-screenshots/${language}-${info.project.name}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}

test("both editions retain the same responsive grid and card widths", async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1024, 1200, 1440]) {
    const geometries = [];
    for (const url of ["/", "/cn/"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await expect(page.locator(".track-card")).toHaveCount(4);
      geometries.push(
        await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          cards: [...document.querySelectorAll(".track-card")].map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, width: r.width };
          }),
        })),
      );
    }
    expect(geometries[0], `Locale layout at ${width}px`).toEqual(geometries[1]);
    expect(geometries[1].overflow).toBe(false);
  }
});

test("privacy pages keep localized copy and the same browser preference", async ({
  page,
}) => {
  await page.goto("/privacy.html");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".privacy-back")).toHaveAttribute("href", "/");
  await expect(page.locator("#privacy-toggle")).toHaveText(
    "Disable analytics in this browser",
  );
  await page.locator("#privacy-toggle").click();
  await expect(page.locator("#privacy-status")).toHaveText(
    "Future analytics events are disabled in this browser.",
  );
  await page.goto("/cn/privacy.html");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator(".privacy-back")).toHaveAttribute("href", "/cn/");
  await expect(page.locator("#privacy-toggle")).toHaveText(
    "开启本浏览器的事件统计",
  );
  await page.locator("#privacy-toggle").click();
  await expect(page.locator("#privacy-status")).toHaveText(
    "本浏览器的事件统计已开启。",
  );
});
