import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import { AxiosError } from "axios";

import client from "../../api/client";
import App from "../../App.jsx";

/**
 * Behavioural check for the error-message sweep, through a real page.
 *
 * Someone who can't send an invitation must be told WHY. The backend answers
 * that failure in several shapes and every one has to surface a readable reason:
 *
 *   RoleGuardFilter / WorkspaceFilter  403  { error: "FORBIDDEN",        message: "<why>" }
 *   PlanGuardFilter                    402  { error: "UPGRADE_REQUIRED", message: "<why>" }
 *   InvitationController.invite        402  { error: "<why>" }            (no message)
 *
 * Reading `error` first used to show the first two as the bare words
 * "FORBIDDEN" / "UPGRADE_REQUIRED"; reading only `message` hid the third.
 */

// ── jsdom gaps the full app shell touches on mount ─────────────────────
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  });
}
window.HTMLElement.prototype.scrollIntoView = window.HTMLElement.prototype.scrollIntoView || function () {};
globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
globalThis.IntersectionObserver = globalThis.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };

const EMAIL = "owner@example.com";
const USER = { id: "u1", name: "Owner", email: EMAIL, role: "USER" };
// ownerEmail === user.email  →  RoleContext resolves the role to OWNER (can invite)
const WORKSPACE = { id: "ws1", name: "My Own Workspace", ownerEmail: EMAIL };

let inviteReply; // { status, data } returned for POST /invitations

function respond(config, status, data) {
  const response = { status, data, headers: {}, config, statusText: String(status) };
  if (status >= 400) throw new AxiosError(`HTTP ${status}`, "ERR_BAD_REQUEST", config, null, response);
  return response;
}

function fakeBackend(config) {
  const url = String(config.url || "");
  const method = (config.method || "get").toLowerCase();
  if (url === "/invitations" && method === "post") return respond(config, inviteReply.status, inviteReply.data);
  if (url === "/auth/profile") return respond(config, 200, USER);
  if (url.startsWith("/workspaces")) return respond(config, 200, [WORKSPACE]);
  if (url.startsWith("/notifications/count") || url.startsWith("/notifications/unread")) return respond(config, 200, { count: 0 });
  if (url.startsWith("/dashboard/summary") || url.startsWith("/ai/settings")) return respond(config, 200, {});
  return respond(config, 200, []);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("token", "valid.jwt.token");
  localStorage.setItem("user", JSON.stringify(USER));
  localStorage.setItem("activeWorkspace", JSON.stringify(WORKSPACE));
  client.defaults.adapter = async (config) => fakeBackend(config);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  window.history.pushState({}, "", "/team");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function sendInviteAndGetError() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /invite member/i }, { timeout: 6000 }));
  fireEvent.change(await screen.findByPlaceholderText("colleague@company.com"), {
    target: { value: "new.hire@example.com" },
  });
  // Scope to the modal: its overlay is itself a role="button" whose accessible
  // name contains all of the modal's text, so an unscoped query matches twice.
  const modal = document.querySelector(".invite-modal");
  fireEvent.click(within(modal).getByRole("button", { name: /send invitation/i }));
  return waitFor(() => {
    const box = document.querySelector(".auth-error");
    expect(box, "an error should be shown in the invite modal").not.toBeNull();
    return box.textContent;
  }, { timeout: 4000 });
}

describe("Team — invite failure shows the real reason", () => {
  it.each([
    ["role guard (403)",  { status: 403, data: { error: "FORBIDDEN", message: "Viewers have read-only access." } },
      "Viewers have read-only access.", /FORBIDDEN/],
    ["plan guard (402)",  { status: 402, data: { error: "UPGRADE_REQUIRED", message: "Your plan allows up to 5 members. Upgrade to invite more." } },
      "Your plan allows up to 5 members. Upgrade to invite more.", /UPGRADE_REQUIRED/],
    ["inline reply (402, `error` only)", { status: 402, data: { error: "Free plan allows up to 5 members" } },
      "Free plan allows up to 5 members", null],
  ])("%s", async (_name, reply, expectedText, forbiddenText) => {
    inviteReply = reply;
    const shown = await sendInviteAndGetError();
    expect(shown).toContain(expectedText);
    if (forbiddenText) expect(shown).not.toMatch(forbiddenText);
  });

  it("falls back to the page's own wording when the reply is only a machine code", async () => {
    inviteReply = { status: 500, data: { error: "SERVER_ERROR" } };
    const shown = await sendInviteAndGetError();
    expect(shown).toContain("Failed to send invitation");
    expect(shown).not.toMatch(/SERVER_ERROR/);
  });
});
