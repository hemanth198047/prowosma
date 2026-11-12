/**
 * Projects grouped by where they are in their life, for the Projects page:
 * "In motion", "Not started", "Paused", "Done". Display-only — the stored
 * status values are never changed.
 */
export const PROJECT_STATES = [
  { key: "motion", label: "In motion" },
  { key: "notstarted", label: "Not started" },
  { key: "paused", label: "Paused" },
  { key: "done", label: "Done" },
];

const DONE = new Set(["COMPLETED", "COMPLETE", "DONE", "CLOSED", "CANCELLED", "CANCELED", "ARCHIVED"]);
const PAUSED = new Set(["PAUSED", "ON_HOLD", "HOLD", "BLOCKED", "SUSPENDED"]);
const NOT_STARTED = new Set(["NOT_STARTED", "PLANNED", "PLANNING", "BACKLOG", "DRAFT", "PROPOSED", "NEW", "TODO"]);

const norm = (s) => String(s ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");

export function projectState(p) {
  const s = norm(p?.status);
  if (DONE.has(s)) return "done";
  if (p?.archived || PAUSED.has(s)) return "paused";
  if (NOT_STARTED.has(s)) return "notstarted";
  return "motion";
}

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** Past its due date and not finished. */
export function isOverdue(p, now = new Date()) {
  if (!p?.dueDate || projectState(p) === "done") return false;
  const due = new Date(p.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  return startOfDay(due) < startOfDay(now);
}

/** Whole days until the due date (negative = overdue); null without a date. */
export function daysUntilDue(p, now = new Date()) {
  if (!p?.dueDate) return null;
  const due = new Date(p.dueDate);
  if (Number.isNaN(due.getTime())) return null;
  return Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
}

/** Soonest due first; projects without a date last; then by name. */
export function compareByDue(a, b) {
  const da = a?.dueDate ? new Date(a.dueDate).getTime() : Infinity;
  const db = b?.dueDate ? new Date(b.dueDate).getTime() : Infinity;
  if (da !== db) return da - db;
  return String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
}

/** [{ key, label, projects }] in display order, empty states left out. */
export function groupProjects(projects) {
  const by = Object.fromEntries(PROJECT_STATES.map(s => [s.key, []]));
  (projects || []).forEach(p => by[projectState(p)].push(p));
  return PROJECT_STATES
    .map(s => ({ ...s, projects: by[s.key].slice().sort(compareByDue) }))
    .filter(s => s.projects.length > 0);
}

/** Counts for the summary strip. */
export function projectSummary(projects, now = new Date()) {
  const out = { motion: 0, notstarted: 0, paused: 0, done: 0, overdue: 0, total: 0 };
  (projects || []).forEach(p => {
    out[projectState(p)] += 1;
    out.total += 1;
    if (isOverdue(p, now)) out.overdue += 1;
  });
  return out;
}

/** "Due 20 Nov", "Due today", "2 days overdue" — short due text for cards. */
export function dueLabel(p, now = new Date(), locale) {
  const days = daysUntilDue(p, now);
  if (days === null) return "No due date";
  const done = projectState(p) === "done";
  if (!done && days < 0) return days === -1 ? "1 day overdue" : `${-days} days overdue`;
  if (!done && days === 0) return "Due today";
  if (!done && days === 1) return "Due tomorrow";
  const d = new Date(p.dueDate);
  const sameYear = d.getFullYear() === now.getFullYear();
  const txt = d.toLocaleDateString(locale, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  return `Due ${txt}`;
}
