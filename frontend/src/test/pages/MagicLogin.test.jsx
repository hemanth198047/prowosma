import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { AxiosError } from "axios";

import client, { navigation } from "../../api/client";
import App from "../../App.jsx";

/**
 * Regression tests for the magic-link sign-in page (/auth/magic).
 *
 * Three separate problems used to make it unusable:
 *  1. It rendered inside the app shell, whose background calls 401 with no
 *     session; api/client.js turns any 401 into a hard redirect to /login, so
 *     the person was bounced before verification could finish.
 *  2. It stored only the JWT in localStorage and never told AuthContext, so
 *     the client-side navigate("/") reached ProtectedRoute with no user and
 *     went straight back to /login.
 *  3. The backend's verify endpoint answers 401 for a bad/expired link, which
 *     hit the same global redirect instead of showing the error.
 *
 * The verify endpoint here is faithfully SINGLE-USE (the real one clears the
 * token on first success), and the happy path runs under React.StrictMode
 * like main.jsx does, which runs effects twice in development.
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

// AuthContext keys this tab's session under a per-tab id created at import time.
const TAB_ID = sessionStorage.getItem("__tab_id__");

const EMAIL = "abhiscorner4@gmail.com";
const JWT = "jwt.from.magic.link";
const USER = { id: "u1", name: "Abhi", email: EMAIL, role: "USER" };
const WORKSPACE = { id: "ws1", name: "My Own Workspace", ownerEmail: EMAIL };

let verifyCalls;     // how many times /auth/magic-link/verify was hit
let tokenConsumed;   // single-use, like the real backend
let unauthorized;    // protected calls answered 401 (each one = redirect to /login in production)
let toLogin;         // spy: "the app tried to leave this page for /login"
let workspaceHeaders; // X-Workspace-Id sent on calls made with the NEW session's JWT

function respond(config, status, data) {
  const response = { status, data, headers: {}, config, statusText: String(status) };
  if (status >= 400) throw new AxiosError(`HTTP ${status}`, "ERR_BAD_REQUEST", config, null, response);
  return response;
}

function fakeBackend(config) {
  const url = String(config.url || "");
  const hasAuth = !!(config.headers?.get?.("Authorization") ?? config.headers?.Authorization);

  if (url === "/auth/magic-link/verify") {
    verifyCalls += 1;
    const token = JSON.parse(config.data || "{}").token;
    if (token === "good-token" && !tokenConsumed) {
      tokenConsumed = true;
      // Exactly what AuthEnhancementsController.verifyMagicLink returns.
      return respond(config, 200, { token: JWT, email: EMAIL, name: "Abhi" });
    }
    return respond(config, 401, { error: "Invalid or expired magic link" });
  }

  if (!hasAuth) {
    unauthorized.push(url);
    return respond(config, 401, { error: "UNAUTHENTICATED" });
  }
  // Only calls made by the NEW session (they carry the new JWT). The tab's OLD
  // session legitimately makes a few of its own on mount, with the old workspace.
  if (config.headers?.get?.("Authorization") === `Bearer ${JWT}`) {
    workspaceHeaders.push(config.headers?.get?.("X-Workspace-Id") ?? null);
  }
  if (url === "/auth/profile") return respond(config, 200, USER);
  if (url.startsWith("/workspaces")) return respond(config, 200, [WORKSPACE]);
  if (url.startsWith("/notifications/count") || url.startsWith("/notifications/unread"))
    return respond(config, 200, { count: 0 });
  if (url.startsWith("/dashboard/summary") || url.startsWith("/ai/settings")) return respond(config, 200, {});
  return respond(config, 200, []);
}

beforeEach(() => {
  verifyCalls = 0;
  tokenConsumed = false;
  unauthorized = [];
  workspaceHeaders = [];
  localStorage.clear();
  sessionStorage.clear();
  client.defaults.adapter = async (config) => fakeBackend(config);
  toLogin = vi.spyOn(navigation, "toLogin").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function openMagicLink(search) {
  window.history.pushState({}, "", `/auth/magic${search}`);
}

describe("MagicLogin — valid link", () => {
  it("signs the person in and lands them in the app (not back on /login), verifying the single-use token only once", async () => {
    openMagicLink("?token=good-token");
    render(<React.StrictMode><App /></React.StrictMode>);

    expect(await screen.findByRole("heading", { name: /logged in/i }, { timeout: 4000 })).toBeInTheDocument();

    // After the short "Redirecting…" pause the app opens at "/" — signed in.
    await waitFor(() => expect(window.location.pathname).toBe("/"), { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 400)); // let ProtectedRoute settle; a bounce would show up here
    expect(window.location.pathname).toBe("/");

    // The session is a real, complete one (AuthContext knows the user).
    expect(localStorage.getItem("token")).toBe(JWT);
    expect(JSON.parse(localStorage.getItem("user")).email).toBe(EMAIL);

    expect(verifyCalls, "single-use token must be verified exactly once").toBe(1);
    expect(toLogin, "app bounced the user to /login").not.toHaveBeenCalled();
    expect(unauthorized, "protected calls made without a session").toEqual([]);
  });
});

describe("MagicLogin — a different account was signed in on this tab", () => {
  it("does not carry the previous account's workspace into the new session", async () => {
    // Tab still holds account A's session, including its active workspace.
    sessionStorage.setItem(`${TAB_ID}__token`, "old.jwt.for.someone.else");
    sessionStorage.setItem(`${TAB_ID}__user`, JSON.stringify({ id: "u-old", email: "old@example.com", name: "Old" }));
    sessionStorage.setItem(`${TAB_ID}__activeWorkspace`, JSON.stringify({ id: "stale-ws", name: "Old Workspace" }));

    openMagicLink("?token=good-token");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/"), { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 400));

    // Sending A's workspace id as B would be rejected by the backend
    // (WorkspaceFilter: "You are not a member of this workspace").
    expect(workspaceHeaders.length, "new session should have made calls").toBeGreaterThan(0);
    expect(workspaceHeaders).not.toContain("stale-ws");
    expect(JSON.parse(localStorage.getItem("user")).email).toBe(EMAIL);
    expect(toLogin).not.toHaveBeenCalled();
  });
});

describe("MagicLogin — bad, expired or missing link", () => {
  it("shows the server's reason and stays put instead of redirecting to /login", async () => {
    openMagicLink("?token=expired-token");
    render(<App />);

    expect(await screen.findByRole("heading", { name: /login failed/i }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("Invalid or expired magic link")).toBeInTheDocument();

    await new Promise((r) => setTimeout(r, 300));
    expect(window.location.pathname).toBe("/auth/magic");
    expect(toLogin, "a 401 from verify bounced the user away from the error message").not.toHaveBeenCalled();
    expect(unauthorized).toEqual([]);
  });

  it("'Back to Login' goes to the login page", async () => {
    openMagicLink("?token=expired-token");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /back to login/i }, { timeout: 4000 }));
    await waitFor(() => expect(window.location.pathname).toBe("/login"));
  });

  it("explains a link with no token without calling the API", async () => {
    openMagicLink("");
    render(<App />);

    expect(await screen.findByText("No token provided.", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(verifyCalls).toBe(0);
    expect(toLogin).not.toHaveBeenCalled();
    expect(unauthorized).toEqual([]);
  });
});
