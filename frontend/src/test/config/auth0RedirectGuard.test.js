import { describe, it, expect } from "vitest";
import { shouldSkipAuth0RedirectCallback } from "../../config/auth0";

describe("shouldSkipAuth0RedirectCallback", () => {
  it("lets Auth0 process its own return page", () => {
    expect(shouldSkipAuth0RedirectCallback("/auth0/callback")).toBe(false);
    expect(shouldSkipAuth0RedirectCallback("/auth0/callback/")).toBe(false);        // a trailing slash is still Auth0's page
  });

  it("keeps Auth0 away from every other page that arrives with ?code=&state= — notably the Google Meet connection", () => {
    for (const path of ["/integrations/meeting-platforms/google-callback", "/", "/login", "/integrations/meeting-platforms", "/auth0/callback-evil", "/x/auth0/callback", "", undefined, null]) {
      expect(shouldSkipAuth0RedirectCallback(path), String(path)).toBe(true);
    }
  });
});
