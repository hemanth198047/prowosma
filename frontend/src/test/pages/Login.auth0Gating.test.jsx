import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { MemoryRouter } from "react-router-dom";

// Mock axios's default-exported `get` (used directly by Login.jsx for the
// SSO-providers check) so that effect resolves immediately with no SAML
// providers configured, instead of hanging.
vi.mock("axios", () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: { saml: [] } })) },
}));

// api/client.js calls axios.create(...) at import time and builds a whole
// interceptor chain on top of it — irrelevant to what this test verifies
// (button visibility) and not worth re-mocking axios.create's full shape
// for. Login.jsx only actually uses `unwrapList` from this module.
vi.mock("../../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  unwrapList: (data) => (Array.isArray(data) ? data : data?.items ?? []),
}));

// Mock useAuth0 — this component only needs loginWithRedirect from it.
vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({ loginWithRedirect: vi.fn() }),
}));

/**
 * Verifies the Auth0-gating fix directly: Login.jsx must show
 * Auth0-backed login buttons ("Continue with Auth0 SSO" and the
 * Google/Microsoft/GitHub social buttons) only when a real tenant is
 * configured (src/config/auth0.js's isAuth0Configured), never against the
 * shared development tenant in what the app believes is a real
 * deployment. This is the regression test for the exact bug fixed in the
 * SAML/Auth0 configurability change.
 */
describe("Login — Auth0 button gating", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("hides all Auth0-backed buttons when isAuth0Configured is false", async () => {
    vi.doMock("../../config/auth0", () => ({ isAuth0Configured: false }));
    const { default: Login } = await import("../../pages/Login.jsx");

    render(<MemoryRouter><Login /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.queryByText(/Continue with Auth0 SSO/i)).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Google/i })).not.toBeInTheDocument();
  });

  it("shows the Auth0 SSO button when isAuth0Configured is true", async () => {
    vi.doMock("../../config/auth0", () => ({ isAuth0Configured: true }));
    const { default: Login } = await import("../../pages/Login.jsx");

    render(<MemoryRouter><Login /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText(/Continue with Auth0 SSO/i)).toBeInTheDocument();
    });
  });

  it("has no automatically-detectable accessibility violations (axe-core)", async () => {
    // Included as a second, complementary automated signal alongside the
    // static jsx-a11y ESLint rules (eslint.config.js) — NOT a replacement
    // for them. Verified empirically while building this: axe-core running
    // inside jsdom (no real browser layout engine) does NOT reliably catch
    // every issue jsx-a11y's static rules catch — a deliberately
    // re-introduced missing label/input association during testing still
    // passed this exact axe check, because jsdom's lack of real layout
    // makes axe treat some elements as not-visible and skip visibility-
    // dependent checks. jsx-a11y (see eslint.config.js) is what actually
    // caught and fixes the real label bug in this file; this axe check
    // covers what it can (ARIA misuse, structural issues that don't
    // depend on layout) as defense in depth, not as the primary net.
    vi.doMock("../../config/auth0", () => ({ isAuth0Configured: false }));
    const { default: Login } = await import("../../pages/Login.jsx");

    const { container } = render(<MemoryRouter><Login /></MemoryRouter>);
    await waitFor(() => screen.getByPlaceholderText(/you@company.com/i));

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
