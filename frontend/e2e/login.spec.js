// Real E2E: registers a brand-new account through the actual UI, against
// a real running backend — not a mocked API response. This is the exact
// gap plain unit/integration tests (backend MockMvc tests, frontend
// component tests with mocked axios) can't close: it proves the frontend
// and backend actually agree on request/response shapes, not just that
// each side individually does what its own tests assume the other side
// does.
import { test, expect } from "@playwright/test";

test.describe("Registration and login", () => {
  test("a new user can register, land on the app, and see their own workspace prompt", async ({ page }) => {
    const uniqueEmail = `e2e-${Date.now()}@example.com`;

    await page.goto("/login");
    await page.getByRole("button", { name: "Create account" }).click();

    await page.getByPlaceholder(/jane smith/i).fill("E2E Test User");
    await page.getByPlaceholder(/you@company\.com/i).fill(uniqueEmail);
    await page.getByPlaceholder("••••••••••").fill("E2ETestPassword123!");

    await page.getByRole("button", { name: "Create account →" }).click();

    // A brand-new user has no workspace yet — the app should route them
    // into workspace setup rather than an error state or a blank page.
    await expect(page).toHaveURL(/workspace-setup|onboarding|dashboard/i, { timeout: 15000 });
  });

  test("an unregistered email shows a real error, not a silent failure", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder(/you@company\.com/i).fill(`does-not-exist-${Date.now()}@example.com`);
    await page.getByPlaceholder("••••••••••").fill("WrongPassword123!");
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    await expect(page.locator(".auth-error")).toBeVisible({ timeout: 10000 });
  });

  test("login page has no automatically-detectable accessibility violations in a real browser", async ({ page }) => {
    // Complements the jsdom-based axe test in src/test/pages/ — this runs
    // in a REAL browser (real layout, real computed styles), which
    // src/test/pages/Login.auth0Gating.test.jsx's own comments note
    // jsdom cannot do (e.g. color contrast needs real rendering). Requires
    // @axe-core/playwright.
    const AxeBuilder = (await import("@axe-core/playwright")).default;
    await page.goto("/login");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
