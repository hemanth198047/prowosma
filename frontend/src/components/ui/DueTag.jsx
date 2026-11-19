/**
 * The due date, set the same way everywhere: mono, tabular figures, "Sep 25"
 * (the year only appears when it is not this year). It stays muted until the
 * date has passed, then turns ink-red. Overdue is also announced in words for
 * screen readers, so colour is never the only signal.
 */
export function formatDue(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
}

export default function DueTag({ date, overdue = false, today = false, className = "" }) {
  const text = formatDue(date);
  if (!text) return null;
  const tone = overdue ? " due-tag--overdue" : today ? " due-tag--today" : "";
  return (
    <span className={`due-tag${tone} ${className}`.trim()}>
      {overdue && <span className="sr-only">Overdue: </span>}
      {text}
    </span>
  );
}
