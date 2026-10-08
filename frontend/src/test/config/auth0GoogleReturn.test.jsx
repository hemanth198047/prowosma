import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { shouldSkipAuth0RedirectCallback } from "../../config/auth0";

/**
 * Uses the REAL Auth0 library. The Meeting Assistant's Google connection returns to
 *   /integrations/meeting-platforms/google-callback?code=…&state=…
 * which looks exactly like an Auth0 login coming back. These tests show what the library does with it.
 */
const GOOGLE_RETURN = "/integrations/meeting-platforms/google-callback?state=GOOGLE_STATE&code=4%2F0AbCdEf&scope=email%20openid&authuser=0&prompt=consent";

function Probe() {
  const { isLoading, error, isAuthenticated } = useAuth0();
  return <p data-testid="probe">{isLoading ? "loading" : `done|auth=${isAuthenticated}|error=${error ? error.message : "none"}`}</p>;
}

const mount = (skip) => render(
  <Auth0Provider domain="example.us.auth0.com" clientId="test-client" skipRedirectCallback={skip}
    authorizationParams={{ redirect_uri: `${window.location.origin}/auth0/callback` }}>
    <Probe />
  </Auth0Provider>);

beforeEach(() => {
  if (!window.crypto?.subtle) Object.defineProperty(window, "crypto", { configurable: true, value: webcrypto });   // the library needs WebCrypto
  window.history.pushState({}, "", GOOGLE_RETURN);
});
afterEach(() => { cleanup(); window.history.pushState({}, "", "/"); });

describe("Auth0Provider on Google's return URL", () => {
  it("WITHOUT the guard (the old setup) the library tries to treat Google's code as an Auth0 login and fails", async () => {
    mount(false);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toMatch(/^done/), { timeout: 4000 });
    expect(screen.getByTestId("probe").textContent).toContain("error=Invalid state");
  });

  it("WITH the guard the library leaves the URL alone and reports no error", async () => {
    mount(shouldSkipAuth0RedirectCallback(window.location.pathname));
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toMatch(/^done/), { timeout: 4000 });
    expect(screen.getByTestId("probe").textContent).toBe("done|auth=false|error=none");
    expect(window.location.search).toContain("state=GOOGLE_STATE");                       // the code and state are still there for our page
    expect(window.location.search).toContain("code=4%2F0AbCdEf");
  });
});
