/**
 * Which parts of the app a RESTRICTED person (department / assigned-work access profile) can use.
 * Mirrors the backend allowlist (AccessGatePolicy): the API refuses everything else, so this only
 * decides what to show — it is never the security boundary. Keep the two in step.
 */
export const RESTRICTED_LANDING = "/tasks";

const ALLOWED_PREFIXES = [
  "/projects", "/tasks", "/kanban", "/calendar", "/gantt", "/docs", "/search", "/team", "/org-chart", "/profile",
  // planning, knowledge and insight areas (each scoped on the server to what the person may see)
  "/goals", "/sprints", "/epics", "/releases", "/roadmap", "/change-requests", "/portfolio-plus", "/decisions",
  "/channels", "/sops", "/reports", "/analytics", "/time-tracking", "/ai", "/ai-intelligence",
];
// Needs the USE_MEETING_ASSISTANT capability on the person's access profile.
const MEETING_PREFIX = "/meeting-assistant";

const under = (pathname, prefix) => pathname === prefix || pathname.startsWith(prefix + "/");

export function isPathAllowedForRestricted(pathname = "/", capabilities = []) {
  if (under(pathname, MEETING_PREFIX)) return capabilities.includes("USE_MEETING_ASSISTANT");
  return ALLOWED_PREFIXES.some((p) => under(pathname, p));
}
