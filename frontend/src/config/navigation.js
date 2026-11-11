/**
 * Sidebar navigation, grouped by the job people are doing rather than by
 * feature list. Every route that was in the sidebar before is still here,
 * with the same URL and the same visibility rules:
 *
 *   capability — shown only if useAccess().can(capability) (was: Meeting Assistant)
 *   action     — wrapped in <CanDo action> (was: Workspace, Admin Centre, Access Control)
 *   badge      — key into the shell's overdue badges
 *
 * PageHeader also reads this to show which section a page belongs to.
 */
import {
  LayoutDashboard, Bot, Sparkles,
  FolderKanban, ListChecks, SquareKanban, ChartGantt, CalendarDays, Target, Clock,
  Rocket, Columns3, Layers,
  Briefcase, Package, Map, GitPullRequestArrow, Scale, Split, Coins,
  Gauge, ClipboardList, ChartColumn, Activity, Brain,
  FileText, BookOpen, Mic, Network,
  Users, MessagesSquare, ScrollText,
  Zap, Workflow, Plug, ArrowDownUp, Upload,
  Building2, Shield, KeyRound, Tags, SlidersHorizontal, Settings, Palette, CodeXml, Sparkle,
  User,
} from "lucide-react";

export const PRIMARY_LINKS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/meeting-assistant", label: "Meeting Assistant", icon: Bot, capability: "USE_MEETING_ASSISTANT" },
  { to: "/ai", label: "AI Assistant", icon: Sparkles },
];

export const NAV_SECTIONS = [
  {
    id: "work", label: "Work", defaultOpen: true,
    items: [
      { to: "/projects", label: "Projects", icon: FolderKanban, badge: "overdueProjects" },
      { to: "/tasks", label: "Tasks", icon: ListChecks, badge: "overdueTasksOnly" },
      { to: "/kanban", label: "Kanban", icon: SquareKanban },
      { to: "/gantt", label: "Gantt", icon: ChartGantt },
      { to: "/calendar", label: "Calendar", icon: CalendarDays },
      { to: "/goals", label: "Goals", icon: Target },
      { to: "/time-tracking", label: "Time & Billing", icon: Clock },
    ],
  },
  {
    id: "agile", label: "Agile", defaultOpen: true,
    items: [
      { to: "/sprints", label: "Sprints", icon: Rocket },
      { to: "/jira-board", label: "Jira Board", icon: Columns3, end: true },
      { to: "/epics", label: "Epics", icon: Layers },
    ],
  },
  {
    id: "govern", label: "Govern", defaultOpen: false,
    items: [
      { to: "/portfolio", label: "Portfolio", icon: Briefcase },
      { to: "/portfolio-plus", label: "Portfolio+", icon: Package },
      { to: "/roadmap", label: "Roadmap & RAID", icon: Map },
      { to: "/change-requests", label: "Change Requests", icon: GitPullRequestArrow },
      { to: "/decisions", label: "Decisions", icon: Scale },
      { to: "/scenarios", label: "Scenarios", icon: Split },
      { to: "/roi", label: "ROI Engine", icon: Coins },
    ],
  },
  {
    id: "insights", label: "Insights", defaultOpen: false,
    items: [
      { to: "/executive", label: "Executive", icon: Gauge },
      { to: "/reports", label: "Reports", icon: ClipboardList },
      { to: "/analytics", label: "Analytics", icon: ChartColumn },
      { to: "/kpis", label: "KPI Tracker", icon: Activity },
      { to: "/deployments", label: "Deployments", icon: Rocket },
      { to: "/ai-intelligence", label: "AI Intelligence", icon: Brain },
    ],
  },
  {
    id: "knowledge", label: "Knowledge", defaultOpen: false,
    items: [
      { to: "/docs", label: "Docs", icon: FileText },
      { to: "/sops", label: "SOPs", icon: BookOpen },
      { to: "/meetings", label: "Meetings", icon: Mic },
      { to: "/knowledge-graph", label: "Knowledge Graph", icon: Network },
    ],
  },
  {
    id: "team", label: "Team", defaultOpen: false,
    items: [
      { to: "/team", label: "Members", icon: Users },
      { to: "/channels", label: "Channels", icon: MessagesSquare },
      { to: "/activity", label: "Activity Log", icon: ScrollText },
    ],
  },
  {
    id: "automate", label: "Automate", defaultOpen: false,
    items: [
      { to: "/automations", label: "Automations", icon: Zap },
      { to: "/bpm", label: "BPM Studio", icon: Workflow },
      { to: "/integrations", label: "Integrations", icon: Plug },
      { to: "/import-export", label: "Import / Export", icon: ArrowDownUp },
      { to: "/import", label: "Import", icon: Upload },
    ],
  },
  {
    id: "settings", label: "Settings", defaultOpen: false,
    items: [
      { to: "/workspace-settings", label: "Workspace", icon: Building2, action: "manageSettings" },
      { to: "/admin", label: "Admin Centre", icon: Shield, action: "adminOnly" },
      { to: "/access-control", label: "Access Control", icon: KeyRound, action: "adminOnly" },
      { to: "/categories", label: "Categories", icon: Tags },
      { to: "/custom-fields", label: "Custom Fields", icon: SlidersHorizontal },
      { to: "/jira-board/settings", label: "Jira Settings", icon: Settings },
      { to: "/ai-settings", label: "AI Settings", icon: Sparkle },
      { to: "/white-label", label: "White-label", icon: Palette },
      { to: "/developer", label: "Developer", icon: CodeXml },
    ],
  },
];

/**
 * Restricted (department / assigned-work) access: the same links as before,
 * in the same order. The old list also had a "Releases" link to /releases,
 * a route that never existed; Portfolio+ (already in the list) is that page.
 */
export const RESTRICTED_LINKS = [
  { to: "/tasks", label: "My Tasks", icon: ListChecks },
  { to: "/kanban", label: "Kanban", icon: SquareKanban },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/meeting-assistant", label: "Meeting Assistant", icon: Bot, capability: "USE_MEETING_ASSISTANT" },
  { to: "/gantt", label: "Gantt", icon: ChartGantt },
  { to: "/goals", label: "Goals", icon: Target },
  { to: "/sprints", label: "Sprints", icon: Rocket },
  { to: "/epics", label: "Epics", icon: Layers },
  { to: "/roadmap", label: "Roadmap & RAID", icon: Map },
  { to: "/change-requests", label: "Change Requests", icon: GitPullRequestArrow },
  { to: "/portfolio-plus", label: "Portfolio+", icon: Package },
  { to: "/docs", label: "Docs", icon: FileText },
  { to: "/sops", label: "SOPs", icon: BookOpen },
  { to: "/decisions", label: "Decisions", icon: Scale },
  { to: "/channels", label: "Channels", icon: MessagesSquare },
  { to: "/reports", label: "Reports", icon: ClipboardList },
  { to: "/analytics", label: "Analytics", icon: ChartColumn },
  { to: "/time-tracking", label: "Time", icon: Clock },
  { to: "/ai", label: "AI Assistant", icon: Sparkles },
  { to: "/team", label: "Members", icon: Users },
];

export const FOOTER_LINKS = [{ to: "/profile", label: "Profile", icon: User }];

/** The sidebar section a path belongs to ("Work", "Govern", …), or null. */
export function sectionForPath(pathname) {
  if (!pathname || pathname === "/") return null;
  let best = null;
  for (const s of NAV_SECTIONS) {
    for (const it of s.items) {
      if (pathname === it.to || pathname.startsWith(it.to + "/")) {
        if (!best || it.to.length > best.len) best = { label: s.label, len: it.to.length };
      }
    }
  }
  return best?.label ?? null;
}
