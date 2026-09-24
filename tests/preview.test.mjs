import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

for (const language of ["en", "cn"]) {
  test(`${language}: complete home, responsive workflow, navigation and no analytics`, async ({
    page,
  }, info) => {
    const failures = [];
    const events = [];
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        failures.push(`${response.status()} ${response.url()}`);
    });
    page.on("request", (request) => {
      if (/\/api\/analytics|\/statistics|\/status(?:\/|$)/.test(request.url()))
        events.push(request.url());
    });
    // Exercise the preview guard even when the normal automated-browser opt-out is absent.
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "webdriver", { get: () => false }),
    );
    const relative = language === "cn" ? "cn/" : "./";
    await page.goto(relative);
    await page.reload();
    await expect(page.locator(".track-card")).toHaveCount(4);
    await expect(page.locator("html")).toHaveAttribute("data-preview", "true");
    const order = await page
      .locator("main > section")
      .evaluateAll((sections) =>
        sections.map((section) => section.id || section.className),
      );
    expect(order).toEqual(["overview", "metrics-band", "why-cbdes", "tracks"]);
    await expect(page.locator("h1 span")).toHaveCount(3);
    // Exercise lazy-loaded covers below the new section before checking decoding.
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
    await expect(page.locator(".why-source-toggle")).toBeHidden();
    await expect(page.locator(".why-pdf-link")).toBeHidden();
    await expect(page.locator(".why-source-panel img[src]")).toHaveCount(0);
    for (let index = 0; index < 4; index++) {
      const stage = page.locator(".why-stage").nth(index);
      await stage.click();
      await expect(stage).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator('.why-stage[aria-pressed="true"]')).toHaveCount(
        1,
      );
      await expect(page.locator(".why-detail-number")).toHaveText(
        `0${index + 1} / 04`,
      );
      await expect(page.locator(".why-detail-output")).not.toBeEmpty();
    }
    await page.locator(".why-restart").click();
    await expect(page.locator(".why-stage").first()).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.locator(".why-stage").nth(1).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".why-stage").nth(1)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.locator(".why-restart").click();
    const overflow = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      return [...document.querySelectorAll(".why-cbdes, .why-cbdes *")]
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          return (
            rect.width > 0 &&
            (rect.left < -1 ||
              rect.right > width + 1 ||
              (!el.matches(".why-stage") &&
                el.clientWidth > 0 &&
                el.scrollWidth > el.clientWidth + 2))
          );
        })
        .map((el) => el.className);
    });
    expect(overflow).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const widths = await page.locator(".why-stage").evaluateAll((buttons) =>
      buttons.map((button) => ({
        x: button.getBoundingClientRect().x,
        y: button.getBoundingClientRect().y,
      })),
    );
    if (Number(info.project.name) < 768)
      expect(new Set(widths.map((rect) => rect.x)).size).toBe(1);
    else expect(new Set(widths.map((rect) => rect.y)).size).toBe(1);
    const folder =
      process.env.GAASD_REVIEW_SCREENSHOTS || "work/review-screenshots";
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
    const section = await page.locator("#why-cbdes").boundingBox();
    await page.screenshot({
      path: `${folder}/${language}-${info.project.name}-section.png`,
      fullPage: true,
      clip: section,
    });
    await page.locator(".why-cta").click();
    await expect(page).toHaveURL(/#tracks$/);
    // Language links are generated from the project base, and carry the visible section.
    await page.evaluate(() =>
      document
        .getElementById("why-cbdes")
        .scrollIntoView({ behavior: "instant" }),
    );
    // Use the visible sticky link's position, avoiding Playwright's automatic
    // scroll to the link's original normal-flow position in mobile Chrome.
    const languageLink = await page
      .locator(`[data-review-language="${language === "en" ? "cn" : "en"}"]`)
      .boundingBox();
    await page.mouse.click(
      languageLink.x + languageLink.width / 2,
      languageLink.y + languageLink.height / 2,
    );
    await expect(page).toHaveURL(
      language === "en" ? /\/cn\/#why-cbdes$/ : /why-cbdes\/#why-cbdes$/,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      language === "en" ? "zh-CN" : "en",
    );
    expect(events).toEqual([]);
    expect(failures).toEqual([]);
  });

  test(`${language}: public videos actually play without business events`, async ({
    page,
  }, info) => {
    test.skip(
      !["1440", "390"].includes(info.project.name),
      "One desktop and one mobile playback pass per language",
    );
    const events = [];
    const errors = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/analytics")) events.push(request.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "webdriver", { get: () => false }),
    );
    await page.goto(language === "cn" ? "cn/" : "./");
    // Dynamic imports finish wiring the player after the document load event.
    await expect(page.locator(".track-card")).toHaveCount(4);
    await page.locator(".overview-video").click();
    const ids =
      info.project.name === "1440"
        ? ["overview", "platform", "ai-assist", "nnide", "vla"]
        : ["overview"];
    const video = page.locator("#media-video");
    for (const id of ids) {
      if (id !== "overview")
        await page.locator(`.media-switcher [data-video-id="${id}"]`).click();
      await expect(video).toHaveAttribute(
        "src",
        /^https:\/\/gaasd\.com\/media\//,
      );
      await expect
        .poll(
          () =>
            video.evaluate(
              (v) =>
                !v.paused &&
                v.currentTime > 0.2 &&
                v.readyState >= 2 &&
                v.videoWidth > 0,
            ),
          { timeout: 30000 },
        )
        .toBe(true);
      await expect(video).toHaveJSProperty("error", null);
    }
    await page.locator(".media-close").click();
    await expect(page.locator("#media-dialog")).not.toBeVisible();
    expect(events).toEqual([]);
    expect(errors).toEqual([]);
  });
}
