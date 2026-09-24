import { defineConfig } from "@playwright/test";
import base from "./playwright.config.mjs";
export default defineConfig({
  ...base,
  testMatch: "bilingual-videos.test.mjs",
  outputDir: "work/bilingual-test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "work/bilingual-test-report", open: "never" }],
  ],
  projects: base.projects.filter((p) => ["desktop", "mobile"].includes(p.name)),
});
