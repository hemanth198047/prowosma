import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, within, fireEvent } from "@testing-library/react";
import { AxiosError } from "axios";

import client, { navigation } from "../../api/client";
import App from "../../App.jsx";

/**
 * Regression tests for: "an existing member opens their invitation link and
 * is silently dropped on the login page, with no explanation".
 *
 * The backend answers GET /api/invitations/info with HTTP 409 and
 * { alreadyMember: true, email, error } for these links. The page must stay
 * put and tell the person they're already a member, which account to log in
 * with, and offer a button that takes them to the login page.
 *
 * Root cause that these guard: /invite/accept used to render inside the app
 * shell, whose pollers made authenticated calls with no session. Any 401 makes
 * api/client.js hard-redirect to /login, so the message never got to show.
 *
 * The network is faked at the axios adapter and mimics the real backend:
 * every protected endpoint answers 401 when there is no Authorization header
 * (SecurityConfig: anyRequest().authenticated()).
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

const EMAIL = "abhiscorner4@gmail.com";
const WORKSPACE_NAME = "My Own Workspace";
const USER = { id: "u1", name: "Abhi", email: EMAIL, role: "USER" };
const WORKSPACE = { id: "ws1", name: WORKSPACE_NAME, ownerEmail: EMAIL };

// What the current backend sends for GET /invitations/info of an existing member.
const ALREADY_MEMBER = {
  error: `You're already part of ${WORKSPACE_NAME}. Please log in instead.`,
  alreadyMember: true,
  email: EMAIL,
  workspaceName: WORKSPACE_NAME,
};
// What the backend sent before `workspaceName` was added (frontend may deploy first).
const ALREADY_MEMBER_OLD_BACKEND = { ...ALREADY_MEMBER, workspaceName: undefined };

let infoResponse;   // { status, data } returned for /invitations/info
let loginResponse;  // { status, data } returned for POST /auth/login
let unauthorized;   // protected calls answered 401 — in production each one redirects to /login
let toLogin;        // spy: "the app tried to leave this page for /login"

function respond(config, status, data) {
  const response = { status, data, headers: {}, config, statusText: String(status) };
  if (status >= 400) {
    throw new AxiosError(`HTTP ${status}`, "ERR_BAD_REQUEST", config, null, response);
  }
  return response;
}

function fakeBackend(config) {
  const url = String(config.url || "");
  const method = (config.method || "get").toLowerCase();
  const hasAuth = !!(config.headers?.get?.("Authorization") ?? config.headers?.Authorization);

  // Public endpoints
  if (url.startsWith("/invitations/info")) return respond(config, infoResponse.status, infoResponse.data);
  if (url === "/auth/login" && method === "post") return respond(config, loginResponse.status, loginResponse.data);

  // Everything else is protected, like the real API.
  if (!hasAuth) {
    unauthorized.push(url);
    return respond(config, 401, { error: "UNAUTHENTICATED" });
  }
  if (url === "/auth/profile") return respond(config, 200, USER);
  if (url.startsWith("/workspaces")) return respond(config, 200, [WORKSPACE]);
  if (url.startsWith("/notifications/count") || url.startsWith("/notifications/unread"))
    return respond(config, 200, { count: 0 });
  if (url.startsWith("/dashboard/summary") || url.startsWith("/ai/settings")) return respond(config, 200, {});
  return respond(config, 200, []);
}

beforeEach(() => {
  unauthorized = [];
  infoResponse = { status: 409, data: ALREADY_MEMBER };
  loginResponse = { status: 401, data: { error: "INVALID_CREDENTIALS", message: "Invalid email or password" } };
  localStorage.clear();
  sessionStorage.clear();
  client.defaults.adapter = async (config) => fakeBackend(config);
  toLogin = vi.spyOn(navigation, "toLogin").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  window.history.pushState({}, "", "/invite/accept?token=abc123");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function seedSavedSession() {
  localStorage.setItem("token", "valid.jwt.token");
  localStorage.setItem("user", JSON.stringify(USER));
  localStorage.setItem("activeWorkspace", JSON.stringify(WORKSPACE));
}

async function findAlreadyMemberScreen() {
  return within(await screen.findByTestId("already-member", {}, { timeout: 4000 }));
}

function expectStayedOnInvitePage() {
  expect(window.location.pathname).toBe("/invite/accept");
  expect(toLogin, "app tried to bounce the user to /login").not.toHaveBeenCalled();
  // Root cause guard: the invite page is standalone, so it must not trigger any
  // protected (401-ing) call at all.
  expect(unauthorized, "protected calls made without a session").toEqual([]);
}

describe("AcceptInvite — existing member opens their invitation link", () => {
  it.each([
    ["has NO saved session", () => {}],
    ["HAS a saved (logged-in) session", seedSavedSession],
  ])("shows the 'already a member' message when this browser %s", async (_label, setup) => {
    setup();
    render(<App />);

    const view = await findAlreadyMemberScreen();
    expect(view.getByRole("heading", { name: /already a member/i })).toBeInTheDocument();
    expect(view.getByText(/nothing left to accept/i)).toBeInTheDocument();

    // Login details: which workspace, which account, which password.
    expect(view.getByText(WORKSPACE_NAME)).toBeInTheDocument();
    expect(view.getByText(EMAIL)).toBeInTheDocument();
    expect(view.getByText(/the one you set when you joined/i)).toBeInTheDocument();
    expect(view.getByRole("button", { name: /go to login/i })).toBeInTheDocument();

    // Give any late background call a chance to fire, then check nothing bounced us.
    await new Promise((r) => setTimeout(r, 300));
    expectStayedOnInvitePage();
  });

  it("still names the workspace when the backend predates the workspaceName field", async () => {
    infoResponse = { status: 409, data: ALREADY_MEMBER_OLD_BACKEND };
    render(<App />);

    const view = await findAlreadyMemberScreen();
    expect(view.getByText(WORKSPACE_NAME)).toBeInTheDocument();
  });

  it("omits the workspace row rather than showing a placeholder when the name is unknown", async () => {
    infoResponse = {
      status: 409,
      data: { alreadyMember: true, email: EMAIL,
              error: "You're already part of this workspace. Please log in instead." },
    };
    render(<App />);

    const view = await findAlreadyMemberScreen();
    expect(view.queryByText("Workspace")).not.toBeInTheDocument();
    expect(view.queryByText("this workspace")).not.toBeInTheDocument();
    expect(view.getByText(EMAIL)).toBeInTheDocument();
  });

  it("'Go to Login' takes them to the login page with their email already filled in", async () => {
    render(<App />);

    const view = await findAlreadyMemberScreen();
    fireEvent.click(view.getByRole("button", { name: /go to login/i }));

    await waitFor(() => expect(window.location.pathname).toBe("/login"));
    expect(new URLSearchParams(window.location.search).get("email")).toBe(EMAIL);
    expect(await screen.findByDisplayValue(EMAIL)).toBeInTheDocument();
  });
});

describe("AcceptInvite — a 401 on this page must not eject the user", () => {
  it("wrong password in 'Already Have Account' mode shows the form again instead of redirecting to /login", async () => {
    infoResponse = {
      status: 200,
      data: { email: EMAIL, role: "MEMBER", workspaceId: "ws1", workspaceName: WORKSPACE_NAME,
              valid: true, accountExists: true },
    };
    render(<App />);

    await screen.findByText(/you've been invited/i, {}, { timeout: 4000 });
    fireEvent.change(screen.getByPlaceholderText("Enter your password"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in & join/i }));

    // Wait until the failed login request has actually been answered (the
    // button leaves its "Please wait…" state), then check we weren't ejected.
    await waitFor(() => expect(screen.getByRole("button", { name: /sign in & join/i })).toBeEnabled());
    await new Promise((r) => setTimeout(r, 200));
    expect(toLogin, "wrong password bounced the user off the invite page").not.toHaveBeenCalled();
    expect(screen.getByText(/you've been invited/i)).toBeInTheDocument();
  });
});
