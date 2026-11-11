/**
 * How a status value is shown to people: underscores become spaces, every
 * one of them ("ON_HOLD" -> "ON HOLD", "PAST_DUE" -> "PAST DUE"). Case is
 * kept, so uppercase pills stay uppercase. Only for display — never use the
 * result as a value sent to the API.
 */
export function statusText(status) {
  if (status === null || status === undefined) return "";
  return String(status).replace(/_/g, " ");
}

/** CSS-safe badge suffix: "IN PROGRESS" / "IN_PROGRESS" -> "in_progress". */
export function statusClass(status) {
  return String(status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}
