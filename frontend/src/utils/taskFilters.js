/**
 * The Tasks page's filters, as plain functions so the filter rail can show
 * how many tasks each choice would leave. The rules are the page's existing
 * ones, moved here unchanged (e.g. "overdue" is past the due moment and not
 * DONE; "this week" runs through Saturday).
 *
 * f = { status, priority, project, assignee, due, search }   ("" = any)
 * ctx = { now, projectIds(projectId) -> [ids incl. sub-projects] }
 */
export function dueWindows(now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + (6 - endOfWeek.getDay())); // through Saturday
  endOfWeek.setHours(23, 59, 59, 999);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { startOfToday, endOfWeek, endOfMonth };
}

export function matchesDue(t, due, now = new Date()) {
  if (!due) return true;
  const { startOfToday, endOfWeek, endOfMonth } = dueWindows(now);
  const d = t.dueDate ? new Date(t.dueDate) : null;
  switch (due) {
    case "overdue": return !!(d && d < now && t.status !== "DONE");
    case "today": return !!(d && d.toDateString() === now.toDateString());
    case "week": return !!(d && d >= startOfToday && d <= endOfWeek);
    case "month": return !!(d && d >= startOfToday && d <= endOfMonth);
    case "nodate": return !t.dueDate;
    default: return true;
  }
}

export function taskMatches(t, f, ctx = {}) {
  const now = ctx.now || new Date();
  if (!matchesDue(t, f.due, now)) return false;
  if (f.status && t.status !== f.status) return false;
  if (f.priority && t.priority !== f.priority) return false;
  if (f.project) {
    const ids = ctx.projectIds ? ctx.projectIds(f.project) : [f.project];
    if (!ids.includes(t.projectId)) return false;
  }
  if (f.assignee) {
    if (f.assignee === "__unassigned__") {
      if (t.assigneeIds?.length > 0) return false;
    } else if (!t.assigneeIds?.includes(f.assignee)) {
      return false;
    }
  }
  if (f.search && !String(t.title ?? "").toLowerCase().includes(f.search.toLowerCase())) return false;
  return true;
}

/** How many tasks would match if `key` were set to `value` (other filters kept). */
export function facetCount(tasks, f, key, value, ctx) {
  const g = { ...f, [key]: value };
  let n = 0;
  for (const t of tasks || []) if (taskMatches(t, g, ctx)) n += 1;
  return n;
}

/** Which due-date group a task falls in for "Group by: Due date". */
export function dueBucket(t, now = new Date()) {
  if (t.status === "DONE") return "done";
  if (!t.dueDate) return "nodate";
  const d = new Date(t.dueDate);
  if (Number.isNaN(d.getTime())) return "nodate";
  if (d < now) return "overdue";
  const { endOfWeek } = dueWindows(now);
  if (d.toDateString() === now.toDateString()) return "today";
  if (d <= endOfWeek) return "week";
  return "later";
}

const DUE_GROUPS = [
  { key: "overdue", label: "Overdue", tone: "late" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "later", label: "Later" },
  { key: "nodate", label: "No due date" },
  { key: "done", label: "Done" },
];
const STATUS_ORDER = ["TODO", "IN_PROGRESS", "DONE"];
const PRIORITY_RANK = { URGENT: 0, CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const byDue = (a, b) => {
  const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
  const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
  if (da !== db) return da - db;
  const pa = PRIORITY_RANK[a.priority] ?? 9, pb = PRIORITY_RANK[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  return String(a.title ?? "").localeCompare(String(b.title ?? ""));
};

/**
 * [{ key, label, tone?, color?, tasks }] for the list view, empty groups
 * left out, tasks soonest-due first inside each group.
 * by: "due" | "status" | "project" | "tag"
 */
export function groupTasks(tasks, by, { projects = [], statusLabel = (s) => s, now = new Date() } = {}) {
  const list = (tasks || []).slice().sort(byDue);
  if (by === "status") {
    const keys = [...STATUS_ORDER, ...new Set(list.map(t => t.status).filter(s => s && !STATUS_ORDER.includes(s)))];
    return keys
      .map(k => ({ key: k, label: statusLabel(k), tasks: list.filter(t => t.status === k) }))
      .concat([{ key: "__none__", label: "No status", tasks: list.filter(t => !t.status) }])
      .filter(g => g.tasks.length);
  }
  if (by === "project") {
    const known = new Map(projects.map(p => [p.id, p]));
    const order = [];
    const groups = new Map();
    for (const t of list) {
      const k = known.has(t.projectId) ? t.projectId : "__none__";
      if (!groups.has(k)) { groups.set(k, []); order.push(k); }
      groups.get(k).push(t);
    }
    return order
      .sort((a, b) => (a === "__none__") - (b === "__none__") || String(known.get(a)?.name ?? "").localeCompare(String(known.get(b)?.name ?? "")))
      .map(k => ({ key: k, label: known.get(k)?.name ?? "No project", color: known.get(k)?.color, tasks: groups.get(k) }));
  }
  if (by === "tag") {
    const groups = new Map();
    for (const t of list) {
      const tags = t.tags?.length ? t.tags : ["__none__"];
      for (const tag of tags) {
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag).push(t);
      }
    }
    return [...groups.keys()]
      .sort((a, b) => (a === "__none__") - (b === "__none__") || a.localeCompare(b))
      .map(k => ({ key: k, label: k === "__none__" ? "No tag" : k, tasks: groups.get(k) }));
  }
  // due
  const buckets = Object.fromEntries(DUE_GROUPS.map(g => [g.key, []]));
  for (const t of list) buckets[dueBucket(t, now)].push(t);
  return DUE_GROUPS.map(g => ({ ...g, tasks: buckets[g.key] })).filter(g => g.tasks.length);
}
