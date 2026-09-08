// Playwright config for real, cross-service E2E tests — the frontend
// running against a REAL backend, not mocks. Previously there was no E2E
// suite of any kind; this exercises frontend + backend together, unlike
// every other test in this codebase (which is unit/integration on one
// side or the other).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
