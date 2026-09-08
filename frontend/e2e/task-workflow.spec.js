// Real E2E: the core task-management workflow — register, land in the
// app, create a task, see it appear. If the frontend and backend ever
// disagree on the Task request/response shape (a real risk with no
// contract testing between them — see docs/API_CONTRACT.md), this is
// what catches it, where a frontend test with a mocked API response
// cannot.
import { test, expect } from "@playwright/test";

async function registerNewUser(page) {
  const email = `e2e-task-${Date.now()}@example.com`;
  await page.goto("/login");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByPlaceholder(/jane smith/i).fill("E2E Task User");
  await page.getByPlaceholder(/you@company\.com/i).fill(email);
  await page.getByPlaceholder("••••••••••").fill("E2ETestPassword123!");
  await page.getByRole("button", { name: "Create account →" }).click();
  await page.waitForURL(/workspace-setup|onboarding|dashboard/i, { timeout: 15000 });
}

test.describe("Task workflow", () => {
  test("a logged-in user can create a task and see it in the list", async ({ page }) => {
    await registerNewUser(page);

    // If registration routed into workspace setup rather than straight to
    // the dashboard, this app's own onboarding flow needs a workspace name
    // before Tasks is reachable — fill it in if that screen appears.
    // Selectors verified directly against WorkspaceSetup.jsx's actual
    // placeholder/button text, not guessed.
    const workspaceNameField = page.getByPlaceholder("e.g. Acme Engineering");
    if (await workspaceNameField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await workspaceNameField.fill("E2E Test Workspace");
      await page.getByRole("button", { name: "Create workspace →" }).click();
      await page.waitForURL(/dashboard|tasks/i, { timeout: 15000 });
    }

    await page.goto("/tasks");

    const taskTitle = `E2E task ${Date.now()}`;
    // Selectors verified against Tasks.jsx: "+ New Task" button, "Task
    // title" input placeholder.
    await page.getByRole("button", { name: "+ New Task" }).click();
    await page.getByPlaceholder("Task title").fill(taskTitle);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(taskTitle)).toBeVisible({ timeout: 10000 });
  });
});
