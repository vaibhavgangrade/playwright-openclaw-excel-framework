import { defineConfig } from "@playwright/test";

const headed = String(process.env.PW_HEADED || "").trim() === "1";
const slowMo = Number(process.env.PW_SLOWMO || 0);

export default defineConfig({
  testDir: "./tests",
  timeout: 60 * 1000,
  retries: 0,
  use: {
    headless: !headed,
    launchOptions: {
      slowMo: Number.isFinite(slowMo) && slowMo > 0 ? slowMo : 0,
    },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  reporter: [["line"], ["json", { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || "artifacts/playwright-report.json" }]],
});
