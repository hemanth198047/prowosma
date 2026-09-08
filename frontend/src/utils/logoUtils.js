/**
 * logoUtils.js
 * Helpers for resolving workspace logo URLs.
 */

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:9090";

/**
 * Convert any logoUrl value to a displayable src string.
 * Handles: null, https:// URLs, /api/... relative paths, data: base64
 */
export function resolveLogoUrl(logoUrl) {
  if (!logoUrl) return null;
  if (logoUrl.startsWith("data:"))   return logoUrl;          // base64 inline
  if (logoUrl.startsWith("http"))    return logoUrl;          // absolute URL
  if (logoUrl.startsWith("/api/"))   return `${API_BASE}${logoUrl}`; // relative API path
  return logoUrl;
}
