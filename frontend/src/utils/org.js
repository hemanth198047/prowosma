/** Pure helpers for the org chart and people cards. */

export function initials(name, email) {
  const src = (name || email || "?").trim();
  const parts = src.split(/[\s._@-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : src.slice(0, 2);
  return letters.toUpperCase();
}

/** byId, children lists and roots. A missing or looping manager makes a person a root. */
export function buildTree(people) {
  const byId = new Map((people || []).map((p) => [p.id, p]));
  const children = new Map();
  const roots = [];
  for (const p of byId.values()) {
    const m = p.managerId && byId.has(p.managerId) && !inLoop(p.id, byId) ? p.managerId : null;
    if (!m) roots.push(p);
    else {
      if (!children.has(m)) children.set(m, []);
      children.get(m).push(p);
    }
  }
  const byName = (a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "");
  roots.sort(byName);
  children.forEach((list) => list.sort(byName));
  return { byId, children, roots };
}

function inLoop(id, byId) {
  const seen = new Set();
  let cur = id;
  while (cur && byId.has(cur)) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = byId.get(cur).managerId;
    if (cur === id) return true;
  }
  return false;
}

/** Managers above a person, nearest first. Stops on loops. */
export function managerChain(id, byId) {
  const out = [];
  const seen = new Set([id]);
  let cur = byId.get(id)?.managerId;
  while (cur && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    out.push(byId.get(cur));
    cur = byId.get(cur).managerId;
  }
  return out;
}

/** Everyone below a person (to keep them out of the "reports to" picker). */
export function descendantIds(id, children) {
  const out = new Set();
  const stack = [...(children.get(id) || [])];
  while (stack.length) {
    const p = stack.pop();
    if (out.has(p.id)) continue;
    out.add(p.id);
    stack.push(...(children.get(p.id) || []));
  }
  return out;
}

/** Number of people below a person (all levels). */
export function teamSize(id, children) {
  return descendantIds(id, children).size;
}

/** "10:32 AM" in the person's time zone, or null when unknown/invalid. */
export function localTime(timeZone, now = new Date()) {
  if (!timeZone) return null;
  try {
    return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone });
  } catch {
    return null;
  }
}

/** Ids to show when searching: matches plus everyone above them (so the path stays visible). */
export function searchVisible(query, people, byId) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return null;
  const hit = (p) => [p.name, p.email, p.title, p.department, ...(p.departments || [])]
    .some((v) => v && String(v).toLowerCase().includes(q));
  const show = new Set();
  const matches = new Set();
  for (const p of people || []) {
    if (!hit(p)) continue;
    matches.add(p.id);
    show.add(p.id);
    managerChain(p.id, byId).forEach((m) => show.add(m.id));
  }
  return { show, matches };
}

/** Sum of allocationPercent per email across projects. */
export function allocationByEmail(projects) {
  const out = new Map();
  for (const pr of projects || []) {
    for (const t of pr.teamDetails || []) {
      if (!t?.email || !(t.allocationPercent > 0)) continue;
      const k = t.email.toLowerCase();
      out.set(k, (out.get(k) || 0) + t.allocationPercent);
    }
  }
  return out;
}

export const PROJECT_ROLES = [
  "Project manager", "Product owner", "Tech lead", "Developer", "Designer",
  "QA", "Analyst", "Stakeholder", "Sponsor", "Consultant",
];
