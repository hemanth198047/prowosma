import { unwrapList } from "../api/client";

/**
 * What to show for an AI response. Lists are unwrapped (paged shapes), but a single object (the standup report, a risk summary, ...) is kept
 * as it is: it used to be turned into an empty list, so these features showed "[]".
 */
export function resultOf(res) {
  const d = res?.data;
  if (d == null || d === "") return {};
  if (Array.isArray(d)) return d;
  if (typeof d === "object") {
    const keys = Object.keys(d);
    const pagedOnly = keys.length > 0 && keys.every((k) => ["data", "page", "totalPages", "totalElements", "hasNext", "content"].includes(k));
    if (pagedOnly) return unwrapList(res);
    return d;
  }
  return d;
}
