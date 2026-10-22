/**
 * Everything the guided "Set up your organisation" screen offers as ready-made choices, and the one function
 * that turns the person's choices into the plan the server accepts. Nobody should ever have to write that plan
 * by hand: they pick, we build it.
 */

/** What an access level can allow, in plain words. `short` is used in one-line summaries. */
export const CAPABILITIES = [
  { key: "CREATE_PROJECT",        label: "Create projects",                                               short: "create projects" },
  { key: "CREATE_TASK",           label: "Create tasks",                                                  short: "create tasks" },
  { key: "ALLOCATE_TASKS",        label: "Assign tasks to other people",                                  short: "assign tasks to others" },
  { key: "APPROVE",               label: "Approve work",                                                  short: "approve work" },
  { key: "VIEW_FINANCIALS",       label: "See budgets and revenue",                                       short: "see budgets and revenue" },
  { key: "MANAGE_PLANNING",       label: "Manage goals, sprints, releases, risks, decisions and SOPs",    short: "manage planning" },
  { key: "USE_MEETING_ASSISTANT", label: "Use the Meeting Assistant (for their own meetings)",            short: "use the Meeting Assistant" },
];

/** What an access level can see. */
export const SCOPES = [
  { key: "MY_DEPARTMENTS", label: "Their department's projects, plus any project they are named on", short: "their departments' projects" },
  { key: "ASSIGNED_ONLY",  label: "Only the work assigned to them",                                  short: "only the work assigned to them" },
  { key: "ALL",            label: "Everything in the workspace",                                     short: "everything in the workspace" },
];

/** Ready-made access levels. `recommended` ones start ticked. */
export const LEVEL_PRESETS = [
  { key: "dept-admin", name: "Department Admin", recommended: true,
    description: "Runs a department: sees its projects and decides who else can see them.",
    scope: "MY_DEPARTMENTS", departmentAdmin: true,
    capabilities: ["CREATE_PROJECT", "CREATE_TASK", "ALLOCATE_TASKS", "APPROVE", "USE_MEETING_ASSISTANT", "MANAGE_PLANNING"] },
  { key: "ops-manager", name: "Operations Manager", recommended: true,
    description: "Keeps work moving: sees their department's projects, creates and assigns work, approves.",
    scope: "MY_DEPARTMENTS", departmentAdmin: false,
    capabilities: ["CREATE_PROJECT", "CREATE_TASK", "ALLOCATE_TASKS", "APPROVE", "USE_MEETING_ASSISTANT", "MANAGE_PLANNING"] },
  { key: "dept-member", name: "Department Member", recommended: true,
    description: "Works inside their department's projects.",
    scope: "MY_DEPARTMENTS", departmentAdmin: false,
    capabilities: ["CREATE_TASK", "USE_MEETING_ASSISTANT"] },
  { key: "assigned-only", name: "Assigned Work Only", recommended: true,
    description: "Sees only the tasks given to them. Good for freelancers, interns and new joiners.",
    scope: "ASSIGNED_ONLY", departmentAdmin: false, capabilities: [] },
  { key: "finance-lead", name: "Finance Lead", recommended: false,
    description: "Like a Department Member, and can also see budgets and revenue.",
    scope: "MY_DEPARTMENTS", departmentAdmin: false,
    capabilities: ["CREATE_TASK", "VIEW_FINANCIALS", "USE_MEETING_ASSISTANT"] },
  { key: "company-wide", name: "Company-wide Member", recommended: false,
    description: "Sees everything in the workspace (for leaders who need the whole picture) but cannot manage access.",
    scope: "ALL", departmentAdmin: false, capabilities: ["CREATE_TASK", "USE_MEETING_ASSISTANT"] },
];

/** Departments people commonly use. */
export const DEPARTMENT_SUGGESTIONS = [
  "Management", "Sales & Marketing", "Operations", "Creative", "Production", "Post-production",
  "Finance", "HR", "Technology", "Customer Support", "Legal", "Engineering", "Product", "Design",
];

/** Who is responsible for what on a project. */
export const ROLE_SUGGESTIONS = [
  "Project owner", "Business owner", "Producer", "Creative lead", "Delivery lead",
  "Client owner", "Account manager", "Reviewer", "Finance contact",
];

/** One click fills departments and project roles for a common kind of company. Everything stays editable. */
export const QUICK_STARTS = [
  { key: "media", title: "Film & media production",
    departments: ["Management", "Sales & Marketing", "Creative", "Production", "Post-production", "HR"],
    roles: ["Business owner", "Creative lead", "Producer"] },
  { key: "agency", title: "Agency or services firm",
    departments: ["Management", "Sales & Marketing", "Operations", "Finance", "HR"],
    roles: ["Client owner", "Delivery lead", "Reviewer"] },
  { key: "software", title: "Software company",
    departments: ["Management", "Product", "Engineering", "Design", "Customer Support", "HR"],
    roles: ["Project owner", "Delivery lead", "Reviewer"] },
];

/** Who sees a brand-new project unless someone changes it. */
export const PROJECT_VISIBILITY_CHOICES = [
  { key: "DEPARTMENTS",  title: "Only the departments chosen for the project", hint: "Recommended. Each project says which departments can see it.", recommended: true },
  { key: "WORKSPACE",    title: "Everyone in the workspace",                    hint: "Open by default. Narrow a project down when it needs to be private." },
  { key: "MEMBERS_ONLY", title: "Only the people named on the project",         hint: "Closed by default. Add people to each project yourself." },
];

/** Who sees a document. */
export const DOC_MODE_CHOICES = [
  { key: "BOTH",           title: "Let each document decide",                               hint: "Recommended. Share a document with departments, or only with named people.", recommended: true },
  { key: "DEPARTMENTS",    title: "By department only",                                     hint: "A document is visible to the departments you pick." },
  { key: "PRIVATE_SHARED", title: "Only the author and the people it is shared with",       hint: "The tightest setting: nothing is visible by department." },
];

export const MAX_NAME = 60;
export const MAX_ROLES = 20;

export const norm = (s) => String(s || "").trim().toLowerCase();
export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());

/** "Creative lead" -> CREATIVE_LEAD (always starts with a letter, unique within the list). */
export function roleKeys(labels) {
  const seen = new Set();
  return labels.map((label) => {
    let k = String(label).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!/^[A-Z]/.test(k)) k = `ROLE_${k || "X"}`;
    k = k.slice(0, 40);
    let unique = k, n = 2;
    while (seen.has(unique)) unique = `${k.slice(0, 36)}_${n++}`;
    seen.add(unique);
    return { key: unique, label: String(label).trim() };
  });
}

/** A one-line, plain-language description of an access level. */
export function describeLevel(level) {
  const sees = SCOPES.find((s) => s.key === level.scope)?.short || "";
  const can = (level.capabilities || []).map((c) => CAPABILITIES.find((x) => x.key === c)?.short).filter(Boolean);
  const canText = can.length ? `Can ${can.join(", ")}.` : "Can update the work assigned to them.";
  const admin = level.scope === "MY_DEPARTMENTS" && level.departmentAdmin ? " Also decides who can see their departments' projects." : "";
  return `Sees ${sees}. ${canText}${admin}`;
}

/**
 * The plan the server accepts (the same shape the advanced file import uses), built from what the person chose.
 * People who are owners/admins are never sent: they are never restricted.
 */
export function buildPlan(state) {
  const levels = state.levels.filter((l) => l.selected);
  const levelNames = new Set(levels.map((l) => l.name.trim()));
  const deptNames = new Set(state.departments.map((d) => d.trim()));
  const profiles = levels.map((l) => ({
    name: l.name.trim(),
    description: l.description || "",
    scope: l.scope,
    departmentAdmin: l.scope === "MY_DEPARTMENTS" && !!l.departmentAdmin,
    capabilities: l.capabilities || [],
  }));
  const members = state.people
    .filter((p) => !p.locked && isEmail(p.email))
    .map((p) => {
      const m = { name: (p.name || "").trim() || p.email.trim(), email: p.email.trim(), role: p.role === "VIEWER" ? "VIEWER" : "MEMBER" };
      if ((p.designation || "").trim()) m.designation = p.designation.trim();
      if (p.level && levelNames.has(p.level)) m.profile = p.level;
      m.departments = (p.departments || []).filter((d) => deptNames.has(d));
      return m;
    });
  const plan = {
    profiles,
    departments: state.departments.map((d) => ({ name: d.trim() })),
    roleSlots: roleKeys(state.roles),
    docAccessMode: state.docMode,
    defaultProjectVisibility: state.projectVisibility,
    members,
  };
  if (state.defaultLevel && levelNames.has(state.defaultLevel)) plan.defaultProfile = state.defaultLevel;
  return plan;
}

/** Start the wizard from what the workspace already has, so running it again edits rather than starts over. */
export function initialState({ profiles = [], departments = [], members = [], settings = {} } = {}) {
  const existingProfiles = profiles || [];
  const levels = LEVEL_PRESETS.map((p) => {
    const found = existingProfiles.find((e) => norm(e.name) === norm(p.name));
    return found
      ? { key: p.key, name: found.name, description: found.description || p.description, scope: found.scope || p.scope,
          departmentAdmin: !!found.departmentAdmin, capabilities: [...(found.capabilities || [])], selected: true, existing: true }
      : { key: p.key, name: p.name, description: p.description, scope: p.scope, departmentAdmin: p.departmentAdmin,
          capabilities: [...p.capabilities], selected: existingProfiles.length === 0 ? p.recommended : false, existing: false };
  });
  existingProfiles.forEach((e) => {
    if (!LEVEL_PRESETS.some((p) => norm(p.name) === norm(e.name))) {
      levels.push({ key: `own-${e.id || e.name}`, name: e.name, description: e.description || "", scope: e.scope || "MY_DEPARTMENTS",
        departmentAdmin: !!e.departmentAdmin, capabilities: [...(e.capabilities || [])], selected: true, existing: true });
    }
  });
  const deptList = (departments || []).map((d) => d.name).filter(Boolean);
  const deptById = Object.fromEntries((departments || []).map((d) => [d.id, d.name]));
  const levelNameById = Object.fromEntries(existingProfiles.map((e) => [e.id, e.name]));
  const people = (members || []).map((m) => ({
    id: m.id, name: m.name || "", email: m.email || "", designation: m.designation || "",
    level: levelNameById[m.accessProfileId] || "",
    departments: (m.departmentIds || []).map((id) => deptById[id]).filter(Boolean),
    role: m.role || "MEMBER", existing: true,
    locked: m.role === "OWNER" || m.role === "ADMIN",
  }));
  const defaultFromSettings = levelNameById[settings?.defaultAccessProfileId];
  return {
    departments: deptList,
    levels,
    roles: (settings?.projectRoleSlots || []).map((r) => r.label).filter(Boolean),
    people,
    projectVisibility: settings?.defaultProjectVisibility || "DEPARTMENTS",
    docMode: settings?.docAccessMode || "BOTH",
    defaultLevel: defaultFromSettings || (levels.find((l) => l.selected && l.scope === "ASSIGNED_ONLY")?.name || ""),
  };
}
