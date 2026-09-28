import { defineConfig } from "@playwright/test";
import base from "./playwright.config.mjs";

export default defineConfig({
  ...base,
  testMatch: "production-release.test.mjs",
  outputDir: "work/release-test-results",
  reporter: [["list"]],
});
