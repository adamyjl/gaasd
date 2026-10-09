import base from "./playwright.analytics.config.mjs";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  ...base,
  use: {
    ...base.use,
    baseURL: process.env.GAASD_TEST_URL || "http://127.0.0.1:4174",
  },
  projects: [
    ...base.projects,
    {
      name: "statistics-tablet",
      use: { viewport: { width: 1024, height: 900 } },
    },
  ],
  webServer: process.env.GAASD_TEST_URL
    ? undefined
    : [
        {
          command: "node scripts/serve.mjs --dir site --port 4174",
          url: "http://127.0.0.1:4174",
          env: { GAASD_ANALYTICS_UPSTREAM: "http://127.0.0.1:4182" },
        },
        {
          command: "node scripts/status-test-server.mjs",
          url: "http://127.0.0.1:4182/internal/health",
        },
      ],
  testMatch: "status.test.mjs",
  outputDir: "work/status-test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "work/status-test-report", open: "never" }],
  ],
});
