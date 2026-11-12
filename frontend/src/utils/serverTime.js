/**
 * Meeting times are stored on the server as UTC without a zone suffix
 * (Java LocalDateTime), e.g. "2026-11-12T04:30:00". The browser would read
 * such a string as LOCAL time and shift it by the viewer's UTC offset, so
 * every read goes through parseServerDateTime and every write sends a UTC
 * ISO string.
 */

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

/** Server date-time string → Date (null when empty or invalid). */
export function parseServerDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value);
  // Date-only strings ("2026-11-12") are calendar days, not instants.
  const iso = s.length > 10 && !HAS_ZONE.test(s) ? `${s}Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date → UTC ISO string for the server. */
export function toServerDateTime(date) {
  return date ? new Date(date).toISOString() : null;
}

const pad = (n) => String(n).padStart(2, "0");

/** Date → "YYYY-MM-DDTHH:mm" in local time, for <input type="datetime-local">. */
export function toLocalInputValue(date) {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Date → "YYYY-MM-DD" in local time, for <input type="date">. */
export function toLocalDateValue(date) {
  return toLocalInputValue(date).slice(0, 10);
}

/** Date → "HH:mm" in local time, for <input type="time">. */
export function toLocalTimeValue(date) {
  return toLocalInputValue(date).slice(11, 16);
}

/** "YYYY-MM-DD" + "HH:mm" (local) → Date. */
export function fromLocalParts(dateStr, timeStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = (timeStr || "00:00").split(":").map(Number);
  const out = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
  return Number.isNaN(out.getTime()) ? null : out;
}
