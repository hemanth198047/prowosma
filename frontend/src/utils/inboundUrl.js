/**
 * The absolute URL an external tool (Datadog, Sentry, Jenkins) posts events to.
 *
 * The backend returns only the path ("/api/inbound-events/datadog/<token>"); the host is
 * whatever the API is served from. `baseURL` is the API client's base ("https://host/api").
 * When that is relative (same-origin deployments) the page's own origin is used.
 */
export function inboundUrl(baseURL, path, fallbackOrigin = "") {
  if (typeof path !== "string" || !path.startsWith("/api/")) return "";
  let origin = fallbackOrigin || "";
  try {
    if (/^https?:\/\//i.test(baseURL || "")) origin = new URL(baseURL).origin;
  } catch {
    /* unparseable base URL: keep the fallback origin */
  }
  return origin.replace(/\/$/, "") + path;
}
