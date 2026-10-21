/**
 * Which parts of the app a RESTRICTED person (department / assigned-work access profile) can use.
 * Mirrors the backend allowlist (AccessGatePolicy): the API refuses everything else, so this only
 * decides what to show — it is never the security boundary. Keep the two in step.
 */
export const RESTRICTED_LANDING = "/tasks";

const ALLOWED_PREFIXES = ["/projects", "/tasks", "/team", "/profile"];

export function isPathAllowedForRestricted(pathname = "/") {
  return ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
