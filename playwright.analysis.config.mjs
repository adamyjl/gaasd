import base from "./playwright.status.config.mjs";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  ...base,
  testMatch: "analysis.test.mjs",
  outputDir: "work/analysis-test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "work/analysis-test-report", open: "never" }],
  ],
});
