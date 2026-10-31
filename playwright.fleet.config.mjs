import base from "./playwright.status.config.mjs";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  ...base,
  timeout: 120000,
  testMatch: "fleet.test.mjs",
  outputDir: "work/fleet-test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "work/fleet-test-report", open: "never" }],
  ],
});
