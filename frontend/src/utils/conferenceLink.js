/**
 * Quick, friendly checking of a meeting link as someone types, so they learn at once whether a notetaker can join. This is ONLY for feedback:
 * the server checks every link again and is the authority. Mirrors the server's rules (https only, the platforms' own domains).
 */
export const PLATFORM_NAMES = { GOOGLE_MEET: "Google Meet", ZOOM: "Zoom", MS_TEAMS: "Microsoft Teams", WEBEX: "Webex" };
export const SUPPORTED_TEXT = "Fireflies works with Google Meet, Zoom, Microsoft Teams and Webex links.";

export function detectPlatform(raw) {
  const text = (raw || "").trim();
  if (!text || text.length > 2000 || /\s/.test(text)) return null;
  let u;
  try { u = new URL(text); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  let platform = null;
  if (host === "meet.google.com" && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(path)) platform = "GOOGLE_MEET";
  else if ((host === "zoom.us" || host.endsWith(".zoom.us") || host === "zoomgov.com" || host.endsWith(".zoomgov.com"))
    && (/^\/(?:j|wc\/join|s)\/\d{8,12}\/?$/.test(path) || /^\/my\/[A-Za-z0-9._-]{1,64}\/?$/.test(path))) platform = "ZOOM";
  else if ((host === "teams.microsoft.com" || host === "teams.live.com") && (/^\/meet\/\d{6,20}\/?$/.test(path) || /^\/l\/meetup-join\/[^/]{10,300}/.test(path))) platform = "MS_TEAMS";
  else if ((host === "webex.com" || host.endsWith(".webex.com")) && path.length > 1) platform = "WEBEX";
  return platform ? { platform, name: PLATFORM_NAMES[platform] } : null;
}
