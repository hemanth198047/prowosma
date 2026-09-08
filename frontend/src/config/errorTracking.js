// Frontend error tracking (Sentry) — previously entirely absent, meaning
// client-side failures were invisible unless a user happened to report
// them. Same config-driven, opt-in pattern as src/config/auth0.js: unset,
// this does nothing (zero behavior/bundle-size-at-runtime change); set
// VITE_SENTRY_DSN and it starts capturing real errors.
import * as Sentry from "@sentry/react";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || "";

export const isErrorTrackingConfigured = Boolean(SENTRY_DSN);

export function initErrorTracking() {
  if (!isErrorTrackingConfigured) {
    if (import.meta.env.PROD) {
      console.warn(
        "[error-tracking] VITE_SENTRY_DSN is not set — this production build has no client-side " +
        "error tracking. Frontend crashes/exceptions will only be visible if a user reports them."
      );
    }
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || (import.meta.env.PROD ? "production" : "development"),
    // Conservative default — capture 10% of sessions for performance
    // tracing, 100% of sessions that actually error. Tune once real
    // traffic volume/Sentry quota considerations are known; this is a
    // reasoned starting point, not a measured-optimal value (same
    // honesty caveat as the latency SLO targets in docs/SLO.md).
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
  });
}

/** Error boundary component — wrap the app root with this to catch render-time errors, not just async ones. */
export const ErrorTrackingBoundary = Sentry.ErrorBoundary;
