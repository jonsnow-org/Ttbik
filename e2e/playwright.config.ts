// Local QA only — NOT run in CI. Start the env first: bash scripts/qa/env.sh up
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: /match-app\.spec\.ts/,
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.QA_BASE_URL || "http://localhost:3100",
    viewport: { width: 390, height: 844 },
    locale: "ar",
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
});
