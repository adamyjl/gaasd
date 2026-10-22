import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "preview.test.mjs",
  workers: 1,
  timeout: 90000,
  expect: { timeout: 20000 },
  outputDir: "work/review-test-results",
  reporter: [["list"], ["json", { outputFile: "work/review-results.json" }]],
  use: {
    baseURL:
      process.env.GAASD_REVIEW_URL ||
      "http://127.0.0.1:4178/gaasd/review/why-cbdes/",
    channel: "chrome",
    headless: true,
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    launchOptions: process.env.GAASD_REVIEW_PROXY
      ? {
          proxy: {
            server: process.env.GAASD_REVIEW_PROXY,
            bypass: "127.0.0.1,localhost",
          },
        }
      : {},
  },
  projects: [1440, 1024, 390, 320].map((width) => ({
    name: String(width),
    use: {
      viewport: { width, height: width > 1000 ? 1000 : 844 },
      isMobile: width < 768,
      hasTouch: width < 768,
    },
  })),
  webServer: process.env.GAASD_REVIEW_URL
    ? undefined
    : {
        command: "node scripts/serve.mjs --dir preview-dist --port 4178",
        url: "http://127.0.0.1:4178/gaasd/review/why-cbdes/",
        reuseExistingServer: false,
      },
});
