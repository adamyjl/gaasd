import base from "./playwright.analytics.config.mjs";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  ...base,
  testMatch: "status.test.mjs",
  outputDir: "work/status-test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "work/status-test-report", open: "never" }],
  ],
});
