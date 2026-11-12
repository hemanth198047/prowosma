/**
 * How a status value is shown to people. Enum-style values ("ON_HOLD",
 * "IN_PROGRESS") become sentence case with spaces ("On hold", "In progress");
 * a known acronym stays upper case ("QA_REVIEW" -> "QA review"). Values that
 * are already mixed case ("Active", "Needs input") are only de-underscored.
 * Only for display — never send the result to the API.
 */
const ACRONYMS = new Set(["QA", "UAT", "KPI", "OKR", "AI", "PR", "MVP", "ROI", "RAID", "SLA", "API", "UI", "UX", "CR"]);

export function statusText(status) {
  if (status === null || status === undefined) return "";
  const raw = String(status).replace(/_/g, " ").trim();
  if (raw !== raw.toUpperCase()) return raw; // already mixed case: keep it
  return raw
    .split(/\s+/)
    .map((w, i) => {
      if (ACRONYMS.has(w)) return w;
      const lower = w.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

/** CSS-safe badge suffix: "IN PROGRESS" / "IN_PROGRESS" -> "in_progress". */
export function statusClass(status) {
  return String(status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}
