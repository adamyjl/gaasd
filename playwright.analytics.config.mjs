import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "analytics.test.mjs",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  outputDir: "work/analytics-test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "work/analytics-test-report", open: "never" }],
  ],
  use: {
    baseURL: process.env.GAASD_TEST_URL || "http://127.0.0.1:4173",
    channel: "chrome",
    headless: true,
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "statistics-desktop",
      use: { viewport: { width: 1440, height: 1024 } },
    },
    {
      name: "statistics-mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "statistics-narrow",
      use: {
        viewport: { width: 320, height: 740 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: process.env.GAASD_TEST_URL
    ? undefined
    : [
        {
          command: "node scripts/serve.mjs --dir dist --port 4173",
          url: "http://127.0.0.1:4173",
          reuseExistingServer: true,
        },
        {
          command: "node scripts/analytics-dev.mjs",
          url: "http://127.0.0.1:4180/internal/health",
          reuseExistingServer: true,
        },
      ],
});
