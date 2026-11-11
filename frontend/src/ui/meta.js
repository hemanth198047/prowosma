/** Pure helpers shared by the ui components (kept apart so components hot-reload cleanly). */

const STATUS = {
  TODO:        { label: "To do",       tone: "todo",     fill: 0 },
  BACKLOG:     { label: "Backlog",     tone: "todo",     fill: 0 },
  PLANNING:    { label: "Planning",    tone: "todo",     fill: 0 },
  OPEN:        { label: "Open",        tone: "todo",     fill: 0 },
  IN_PROGRESS: { label: "In progress", tone: "progress", fill: 50 },
  ACTIVE:      { label: "Active",      tone: "progress", fill: 50 },
  IN_REVIEW:   { label: "In review",   tone: "review",   fill: 75 },
  REVIEW:      { label: "In review",   tone: "review",   fill: 75 },
  TESTING:     { label: "Testing",     tone: "review",   fill: 75 },
  DONE:        { label: "Done",        tone: "done",     fill: 100 },
  COMPLETED:   { label: "Completed",   tone: "done",     fill: 100 },
  ACHIEVED:    { label: "Achieved",    tone: "done",     fill: 100 },
  CLOSED:      { label: "Closed",      tone: "done",     fill: 100 },
  BLOCKED:     { label: "Blocked",     tone: "blocked",  diamond: true },
  ON_HOLD:     { label: "On hold",     tone: "todo",     pause: true },
  PAUSED:      { label: "Paused",      tone: "todo",     pause: true },
  CANCELLED:   { label: "Cancelled",   tone: "todo",     cancel: true },
  OVERDUE:     { label: "Overdue",     tone: "blocked",  diamond: true },
  AT_RISK:     { label: "At risk",     tone: "progress", diamond: true },
};

export function statusMeta(status) {
  const key = String(status || "").toUpperCase().replace(/[\s-]+/g, "_");
  return STATUS[key] || {
    label: key ? key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, " ") : "No status",
    tone: "todo", fill: 0,
  };
}


const PRIORITY = {
  CRITICAL: { label: "Critical", tone: "critical" },
  URGENT:   { label: "Urgent",   tone: "critical" },
  HIGH:     { label: "High",     tone: "high" },
  MEDIUM:   { label: "Medium",   tone: "medium" },
  LOW:      { label: "Low",      tone: "low" },
};

export function priorityMeta(priority) {
  const key = String(priority || "").toUpperCase();
  return PRIORITY[key] || { label: key ? key.charAt(0) + key.slice(1).toLowerCase() : "None", tone: "none" };
}


const TONES = 6;

export function initialsOf(nameOrEmail = "") {
  const s = String(nameOrEmail).trim();
  if (!s) return "?";
  const base = s.includes("@") ? s.split("@")[0].replace(/[._-]+/g, " ") : s;
  const parts = base.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function toneOf(key = "") {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % TONES;
}

