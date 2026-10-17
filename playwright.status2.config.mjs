import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "status2.test.mjs",
  workers: 1,
  timeout: 45000,
  expect: { timeout: 15000 },
  outputDir: "work/status2-test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "work/status2-test-report", open: "never" }],
  ],
  use: {
    baseURL: process.env.GAASD_STATUS2_URL || "https://gaasd.com",
    channel: "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "office-desktop",
      use: { viewport: { width: 1440, height: 1000 } },
    },
    { name: "office-tablet", use: { viewport: { width: 1024, height: 900 } } },
    {
      name: "office-mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "office-narrow",
      use: {
        viewport: { width: 320, height: 740 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
