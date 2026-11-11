/**
 * Workspace setup: instead of asking people to pick a "template" (PMO / Portfolio, Software
 * Delivery, …), which users found confusing, the setup screen asks two plain questions —
 * which field they work in and what their role is — and this module picks the template for them.
 *
 * Everything here is pure data + pure functions so the choice is predictable and unit-tested.
 */

/* ─── Workspace templates (what actually gets configured) ─── */
export const TEMPLATES = [
  {
    id: "software-delivery",
    name: "Software Delivery",
    icon: "💻",
    desc: "Built for engineering teams shipping products — sprints, DORA, deployments, goals.",
    tags: ["Sprints", "Tasks", "DORA Metrics", "Goals", "Kanban", "Deployments"],
    color: "#3732A8",
    defaultPages: ["/", "tasks", "sprints", "kanban", "goals", "deployments"],
    settings: { dateFormat: "DD/MM/YYYY", defaultTaskStatus: "TODO",
      enableSprints: true, enableDORA: true, enableKanban: true },
  },
  {
    id: "pmo",
    name: "PMO / Portfolio",
    icon: "📊",
    desc: "Programme management office — portfolio views, RAID, KPIs, ROI, executive reporting.",
    tags: ["Portfolio", "RAID", "KPIs", "ROI Engine", "Roadmap", "Reports"],
    color: "#0891b2",
    defaultPages: ["/", "portfolio", "roadmap", "kpis", "roi", "reports"],
    settings: { dateFormat: "DD/MM/YYYY", enableRisk: true, enableROI: true, enablePortfolio: true },
  },
  {
    id: "enterprise-transformation",
    name: "Enterprise Transformation",
    icon: "🏗",
    desc: "Large-scale change programmes — initiatives, milestones, decisions, BPM, automations.",
    tags: ["Initiatives", "Roadmap", "Decisions", "BPM", "Automations", "Channels"],
    color: "#7C5CBF",
    defaultPages: ["/", "roadmap", "decisions", "automations", "channels", "bpm"],
    settings: { dateFormat: "DD/MM/YYYY", enableBPM: true, enableAutomations: true },
  },
  {
    id: "agile-product",
    name: "Agile Product Team",
    icon: "🎯",
    desc: "Product squads with OKRs, epics, sprints, kanban, and continuous delivery.",
    tags: ["OKRs", "Epics", "Sprints", "Kanban", "Backlog", "Analytics"],
    color: "#1E8E5A",
    defaultPages: ["/", "goals", "epics", "sprints", "kanban", "analytics"],
    settings: { dateFormat: "DD/MM/YYYY", enableEpics: true, enableOKR: true, enableKanban: true },
  },
  {
    id: "knowledge-hub",
    name: "Knowledge & Docs Hub",
    icon: "📚",
    desc: "Documentation-first team — docs, SOPs, decisions, meetings, knowledge graph.",
    tags: ["Docs", "SOPs", "Decisions", "Meetings", "Knowledge Graph", "Search"],
    color: "#C17D22",
    defaultPages: ["/", "docs", "decisions", "meetings", "sops", "knowledge-graph"],
    settings: { dateFormat: "DD/MM/YYYY", enableDocs: true, enableSOPs: true },
  },
  {
    id: "blank",
    name: "Blank Workspace",
    icon: "⬜",
    desc: "Start from scratch and configure everything yourself.",
    tags: [],
    color: "#64748b",
    defaultPages: ["/"],
    settings: {},
  },
];

export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || null;

/* ─── Question 1: which field do you work in? ─── */
// `template` is the best fit for a typical team in that field.
export const INDUSTRIES = [
  { key: "software",      icon: "💻", label: "Software & IT",               hint: "Product, engineering, IT services",        template: "software-delivery" },
  { key: "media",         icon: "🎬", label: "Media & Entertainment",       hint: "Film, TV, publishing, content, gaming",    template: "agile-product" },
  { key: "marketing",     icon: "📣", label: "Marketing & Agencies",        hint: "Campaigns, creative and client work",      template: "agile-product" },
  { key: "finance",       icon: "🏦", label: "Finance & Banking",           hint: "Banking, insurance, investments",          template: "pmo" },
  { key: "consulting",    icon: "🤝", label: "Consulting & Professional",   hint: "Advisory, audit, professional services",   template: "pmo" },
  { key: "construction",  icon: "🏗", label: "Construction & Real Estate",  hint: "Sites, developments, facilities",          template: "pmo" },
  { key: "healthcare",    icon: "🏥", label: "Healthcare & Life Sciences",  hint: "Hospitals, pharma, medical devices",       template: "enterprise-transformation" },
  { key: "manufacturing", icon: "🏭", label: "Manufacturing & Operations",  hint: "Production, supply chain, logistics",      template: "enterprise-transformation" },
  { key: "government",    icon: "🏛", label: "Government & Non-profit",     hint: "Public sector, NGOs, charities",           template: "enterprise-transformation" },
  { key: "retail",        icon: "🛍", label: "Retail & E-commerce",         hint: "Stores, online shops, consumer brands",    template: "agile-product" },
  { key: "education",     icon: "🎓", label: "Education & Research",        hint: "Schools, universities, research labs",     template: "knowledge-hub" },
  { key: "legal",         icon: "⚖️", label: "Legal",                        hint: "Law firms, in-house legal, compliance",    template: "knowledge-hub" },
  { key: "other",         icon: "✨", label: "Something else",              hint: "We'll set up a general-purpose workspace", template: "agile-product" },
];

/* ─── Question 2: what is your role? ─── */
// `template` set → the role decides regardless of field (it reflects what the person does all day).
// `template` null → keep the field's choice.
export const ROLES = [
  { key: "executive",       icon: "👔", label: "Executive / Leadership",        hint: "I oversee many projects and need the big picture", template: "pmo" },
  { key: "pmo",             icon: "📊", label: "Portfolio / PMO",               hint: "I track programmes, risks and budgets",           template: "pmo" },
  { key: "project-manager", icon: "📋", label: "Project or Programme Manager",  hint: "I plan and deliver projects",                     template: null },
  { key: "product-manager", icon: "🎯", label: "Product Manager",               hint: "I own a product, its goals and backlog",          template: "agile-product" },
  { key: "team-lead",       icon: "🧭", label: "Team Lead",                     hint: "I run a team and assign its work",                template: null },
  { key: "team-member",     icon: "🙋", label: "Team Member",                   hint: "I work on the tasks I'm given",                   template: null },
];

export const industryByKey = (k) => INDUSTRIES.find((i) => i.key === k) || null;
export const roleByKey = (k) => ROLES.find((r) => r.key === k) || null;

/**
 * Picks the workspace template for a field + role. Always returns a real template (never null),
 * so the setup screen never has to ask the person to choose one.
 *
 * @returns {{ template: object, reason: string }}
 */
export function recommendTemplate(industryKey, roleKey) {
  const industry = industryByKey(industryKey);
  const role = roleByKey(roleKey);

  let id = industry?.template || "agile-product";
  // Software teams led by a product manager work in OKRs/epics, not deployment pipelines — the
  // role's template applies; same for leadership/PMO roles in any field.
  if (role?.template) id = role.template;

  const template = templateById(id) || templateById("agile-product");

  let reason;
  if (role?.template && role.template !== industry?.template) {
    reason = `As ${withArticle(role.label)}, you'll get ${template.tags.slice(0, 3).join(", ")} up front.`;
  } else if (industry && industry.key !== "other") {
    reason = `Teams in ${industry.label} usually work with ${template.tags.slice(0, 3).join(", ")}.`;
  } else {
    reason = `A general setup with ${template.tags.slice(0, 3).join(", ")} — you can turn on more any time.`;
  }
  return { template, reason };
}

function withArticle(label) {
  const first = label.trim().charAt(0).toLowerCase();
  return ("aeiou".includes(first) ? "an " : "a ") + label;
}

/** Suggested workspace description, e.g. "Media & Entertainment workspace". */
export function suggestedDescription(industryKey) {
  const industry = industryByKey(industryKey);
  return industry && industry.key !== "other" ? `${industry.label} workspace` : "";
}
