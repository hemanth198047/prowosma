import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Verifies src/config/auth0.js actually falls back to the shared dev
 * tenant when VITE_AUTH0_DOMAIN/VITE_AUTH0_CLIENT_ID are unset, and
 * correctly reports isAuth0Configured=true only once BOTH a real domain
 * and client ID are supplied — this is the flag Login.jsx uses to decide
 * whether to show Auth0-backed login buttons at all, so getting it wrong
 * either hides working SSO or (worse) shows a login button pointed at the
 * wrong tenant in production.
 *
 * Uses vi.resetModules() + a dynamic import after stubbing env vars,
 * since the module reads import.meta.env once at import time.
 */
describe("config/auth0", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("falls back to the shared dev tenant when nothing is configured", async () => {
    vi.stubEnv("VITE_AUTH0_DOMAIN", "");
    vi.stubEnv("VITE_AUTH0_CLIENT_ID", "");
    const { AUTH0_DOMAIN, isAuth0Configured, isUsingSharedDevTenant } = await import("../../config/auth0.js");

    expect(AUTH0_DOMAIN).toBe("dev-k7wl42wvci7bojg2.us.auth0.com");
    expect(isAuth0Configured).toBe(false);
    expect(isUsingSharedDevTenant).toBe(true);
  });

  it("reports isAuth0Configured=true once a real domain AND client ID are both set", async () => {
    vi.stubEnv("VITE_AUTH0_DOMAIN", "acme-corp.us.auth0.com");
    vi.stubEnv("VITE_AUTH0_CLIENT_ID", "real-client-id-123");
    const { AUTH0_DOMAIN, AUTH0_CLIENT_ID, isAuth0Configured, isUsingSharedDevTenant } =
      await import("../../config/auth0.js");

    expect(AUTH0_DOMAIN).toBe("acme-corp.us.auth0.com");
    expect(AUTH0_CLIENT_ID).toBe("real-client-id-123");
    expect(isAuth0Configured).toBe(true);
    expect(isUsingSharedDevTenant).toBe(false);
  });

  it("requires BOTH domain and client ID — setting only one still isn't 'configured'", async () => {
    vi.stubEnv("VITE_AUTH0_DOMAIN", "acme-corp.us.auth0.com");
    vi.stubEnv("VITE_AUTH0_CLIENT_ID", "");
    const { isAuth0Configured } = await import("../../config/auth0.js");

    expect(isAuth0Configured).toBe(false);
  });
});
