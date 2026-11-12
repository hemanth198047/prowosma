// The app's navigation in one place: the sidebar renders it and the top bar
// uses it to name the current page ("Work / Projects"). Every route the old
// emoji sidebar linked to is still here; only the grouping and icons changed.
import {
  LayoutDashboard, Bot, FolderKanban, SquareCheckBig, Columns3, CalendarDays,
  GanttChart, ClipboardList, Rocket, Target, Timer, Layers, Map, Briefcase,
  GitPullRequest, FileText, Mic, BookOpen, Lightbulb, Network, LineChart,
  FileStack, Gauge, Presentation, PiggyBank, Shuffle, Clock, Users, Building2,
  MessageSquare, History, Workflow, Zap, ArrowLeftRight, Plug, Download,
  Sparkles, Brain, Wand2, Tag, SlidersHorizontal, Building, ShieldCheck,
  KeyRound, Palette, Wrench, Code2, UserCircle, Settings,
} from "lucide-react";

// gate: { can: "<capability>" } (access context) or { cando: "<action>" } (role)
export const NAV_TOP = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/meeting-assistant", label: "Meeting Assistant", icon: Bot, gate: { can: "USE_MEETING_ASSISTANT" } },
];

export const NAV_GROUPS = [
  { id: "work", label: "Work", icon: FolderKanban, defaultOpen: true, items: [
    { to: "/projects", label: "Projects", icon: FolderKanban, badge: "overdueProjects" },
    { to: "/tasks", label: "Tasks", icon: SquareCheckBig, badge: "overdueTasksOnly" },
    { to: "/kanban", label: "Kanban", icon: Columns3 },
    { to: "/calendar", label: "Calendar", icon: CalendarDays },
    { to: "/gantt", label: "Gantt", icon: GanttChart },
    { to: "/jira-board", label: "Jira Board", icon: ClipboardList, end: true },
    { to: "/deployments", label: "Deployments", icon: Rocket },
  ] },
  { id: "plan", label: "Plan", icon: Target, items: [
    { to: "/goals", label: "Goals", icon: Target },
    { to: "/sprints", label: "Sprints", icon: Timer },
    { to: "/epics", label: "Epics", icon: Layers },
    { to: "/roadmap", label: "Roadmap & RAID", icon: Map },
    { to: "/portfolio", label: "Portfolio", icon: Briefcase },
    { to: "/portfolio-plus", label: "Portfolio+", icon: Briefcase },
    { to: "/change-requests", label: "Change Requests", icon: GitPullRequest },
  ] },
  { id: "knowledge", label: "Knowledge", icon: BookOpen, items: [
    { to: "/docs", label: "Docs", icon: FileText },
    { to: "/meetings", label: "Meetings", icon: Mic },
    { to: "/sops", label: "SOPs", icon: BookOpen },
    { to: "/decisions", label: "Decisions", icon: Lightbulb },
    { to: "/knowledge-graph", label: "Knowledge Graph", icon: Network },
  ] },
  { id: "insights", label: "Insights", icon: LineChart, items: [
    { to: "/analytics", label: "Analytics", icon: LineChart },
    { to: "/reports", label: "Reports", icon: FileStack },
    { to: "/kpis", label: "KPI Tracker", icon: Gauge },
    { to: "/executive", label: "Executive", icon: Presentation },
    { to: "/roi", label: "ROI Engine", icon: PiggyBank },
    { to: "/scenarios", label: "Scenarios", icon: Shuffle },
    { to: "/time-tracking", label: "Time & Billing", icon: Clock },
  ] },
  { id: "people", label: "People", icon: Users, items: [
    { to: "/team", label: "Members", icon: Users },
    { to: "/org-chart", label: "Org chart", icon: Building2 },
    { to: "/channels", label: "Channels", icon: MessageSquare },
    { to: "/activity", label: "Activity Log", icon: History },
  ] },
  { id: "automate", label: "Automate", icon: Workflow, items: [
    { to: "/bpm", label: "BPM Studio", icon: Workflow },
    { to: "/automations", label: "Automations", icon: Zap },
    { to: "/import-export", label: "Import / Export", icon: ArrowLeftRight },
    { to: "/integrations", label: "Integrations", icon: Plug },
    { to: "/import", label: "Import", icon: Download, end: true },
  ] },
  { id: "ai", label: "AI", icon: Sparkles, items: [
    { to: "/ai", label: "AI Assistant", icon: Sparkles, end: true },
    { to: "/ai-intelligence", label: "AI Intelligence", icon: Brain },
    { to: "/ai-settings", label: "AI Settings", icon: Wand2 },
  ] },
  { id: "settings", label: "Settings", icon: Settings, items: [
    { to: "/categories", label: "Categories", icon: Tag },
    { to: "/custom-fields", label: "Custom Fields", icon: SlidersHorizontal },
    { to: "/workspace-settings", label: "Workspace", icon: Building, gate: { cando: "manageSettings" } },
    { to: "/admin", label: "Admin Centre", icon: ShieldCheck, gate: { cando: "adminOnly" } },
    { to: "/access-control", label: "Access Control", icon: KeyRound, gate: { cando: "adminOnly" } },
    { to: "/white-label", label: "White-label", icon: Palette },
    { to: "/jira-board/settings", label: "Jira Settings", icon: Wrench },
    { to: "/developer", label: "Developer", icon: Code2 },
  ] },
];

export const NAV_BOTTOM = [
  { to: "/profile", label: "Profile", icon: UserCircle },
];

// Restricted (department / assigned-work) access: the same short list as before.
export const NAV_RESTRICTED = [
  { to: "/tasks", label: "My Tasks", icon: SquareCheckBig },
  { to: "/kanban", label: "Kanban", icon: Columns3 },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/meeting-assistant", label: "Meeting Assistant", icon: Bot, gate: { can: "USE_MEETING_ASSISTANT" } },
  { to: "/gantt", label: "Gantt", icon: GanttChart },
  { to: "/goals", label: "Goals", icon: Target },
  { to: "/sprints", label: "Sprints", icon: Timer },
  { to: "/epics", label: "Epics", icon: Layers },
  { to: "/roadmap", label: "Roadmap & RAID", icon: Map },
  { to: "/change-requests", label: "Change Requests", icon: GitPullRequest },
  { to: "/portfolio-plus", label: "Portfolio+", icon: Briefcase },
  { to: "/docs", label: "Docs", icon: FileText },
  { to: "/sops", label: "SOPs", icon: BookOpen },
  { to: "/decisions", label: "Decisions", icon: Lightbulb },
  { to: "/channels", label: "Channels", icon: MessageSquare },
  { to: "/reports", label: "Reports", icon: FileStack },
  { to: "/analytics", label: "Analytics", icon: LineChart },
  { to: "/time-tracking", label: "Time", icon: Clock },
  { to: "/ai", label: "AI Assistant", icon: Sparkles, end: true },
  { to: "/team", label: "Members", icon: Users },
  { to: "/org-chart", label: "Org chart", icon: Building2 },
];

/** Does a nav item's route cover this pathname? (`end` items match exactly.) */
export function matchesPath(item, pathname) {
  if (item.to === "/" || item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(item.to + "/");
}

// Pages reached from inside other pages, so they have no sidebar link of their own.
const EXTRA_TITLES = {
  "/search": "Search",
  "/integrations/meeting-platforms": "Meeting Platforms",
  "/workspace-setup": "Workspace setup",
  "/workflow-guide": "Workflow guide",
};

/**
 * Where the current page sits in the navigation, for the top bar:
 * { section: "Work", label: "Projects" }. The most specific match wins, so
 * /jira-board/settings reads "Settings / Jira Settings", not "Work / Jira Board".
 */
export function locate(pathname) {
  let best = null;
  const consider = (item, section) => {
    if (!matchesPath(item, pathname)) return;
    if (!best || item.to.length > best.to.length) best = { to: item.to, section, label: item.label };
  };
  NAV_TOP.forEach(i => consider(i, null));
  NAV_GROUPS.forEach(g => g.items.forEach(i => consider(i, g.label)));
  NAV_BOTTOM.forEach(i => consider(i, null));
  if (best) return { section: best.section, label: best.label };
  if (EXTRA_TITLES[pathname]) return { section: null, label: EXTRA_TITLES[pathname] };
  const first = pathname.split("/").filter(Boolean)[0] || "";
  const label = first.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return { section: null, label: label || "Dashboard" };
}

