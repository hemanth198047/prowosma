// Central Auth0 configuration — read once, used everywhere Auth0 is
// referenced (main.jsx's <Auth0Provider>, Login.jsx's button visibility).
//
// Vite bakes import.meta.env values into the built JS at COMPILE time, the
// same way VITE_API_URL already works (see api/client.js) — set these as
// build-time env vars / --build-arg values, never edit source to change
// tenants again.
//
// The fallback values below are the pre-existing shared dev tenant. They
// keep local `npm run dev` working with zero setup, exactly as before this
// change — they are NOT used in any deployment that sets the real env
// vars, and `isAuth0Configured` tells the UI whether it's looking at the
// shared dev tenant or a real, customer-supplied one.
const DEV_FALLBACK_DOMAIN = "dev-k7wl42wvci7bojg2.us.auth0.com";
const DEV_FALLBACK_CLIENT_ID = "3xp1SBwmgZHaibd0HLGNrRR1T0ZBpaHs";

export const AUTH0_DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN || DEV_FALLBACK_DOMAIN;
export const AUTH0_CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID || DEV_FALLBACK_CLIENT_ID;

// True once a real, customer-supplied tenant has been set via env vars
// rather than falling back to the shared dev tenant. Used to decide
// whether to show Auth0-backed login buttons at all — showing "Continue
// with Auth0 SSO" against the shared dev tenant in a real deployment would
// let users authenticate against the wrong tenant entirely.
export const isAuth0Configured =
  Boolean(import.meta.env.VITE_AUTH0_DOMAIN) && Boolean(import.meta.env.VITE_AUTH0_CLIENT_ID);

// True when running against the shared dev tenant (either fully unset, or
// explicitly still pointed at it) — surfaced so the UI/console can warn
// instead of silently authenticating real users against a shared tenant.
export const isUsingSharedDevTenant = AUTH0_DOMAIN === DEV_FALLBACK_DOMAIN;

// <Auth0Provider> treats ANY page whose URL has ?code=…&state=… as an Auth0 login coming back and tries to process it. Other sign-in
// flows return to the app the same way — e.g. connecting a Google account for Meeting Assistant returns to
// /integrations/meeting-platforms/google-callback?code=…&state=… — and must not be handed to Auth0. Auth0's own return URL is
// /auth0/callback (see main.jsx), so the automatic handling is switched on for that page only.
export function shouldSkipAuth0RedirectCallback(pathname) {
  const path = String(pathname || "").replace(/\/+$/, "");
  return path !== "/auth0/callback";
}

if (typeof window !== "undefined" && isUsingSharedDevTenant && import.meta.env.PROD) {
  console.warn(
    "[auth0] VITE_AUTH0_DOMAIN / VITE_AUTH0_CLIENT_ID are not set — this production build is " +
    "using the shared development Auth0 tenant. Set both as build-time env vars before shipping."
  );
}
