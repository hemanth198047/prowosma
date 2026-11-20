import { describe, it, expect } from "vitest";
import { NAV_TOP, NAV_GROUPS, NAV_BOTTOM, NAV_RESTRICTED, locate, matchesPath } from "../../components/shell/navConfig";

// Every route the old emoji sidebar linked to — none may go missing in the redesign.
const OLD_FULL_MENU = [
  "/", "/projects", "/tasks", "/goals", "/kanban", "/jira-board", "/epics",
  "/deployments", "/knowledge-graph", "/sprints", "/gantt", "/calendar", "/docs", "/meetings", "/sops",
  "/analytics", "/portfolio", "/roadmap", "/change-requests", "/portfolio-plus", "/kpis", "/executive",
  "/roi", "/scenarios", "/decisions", "/reports", "/time-tracking", "/bpm", "/automations",
  "/import-export", "/integrations", "/import", "/channels", "/team", "/org-chart", "/activity",
  "/categories", "/custom-fields", "/workspace-settings", "/admin", "/access-control", "/white-label",
  "/jira-board/settings", "/developer", "/ai", "/ai-intelligence", "/ai-settings", "/profile",
];
const OLD_RESTRICTED_MENU = [
  "/tasks", "/kanban", "/calendar", "/projects", "/meetings", "/gantt", "/goals", "/sprints",
  "/epics", "/roadmap", "/change-requests", "/portfolio-plus", "/docs", "/sops", "/decisions",
  "/channels", "/reports", "/analytics", "/time-tracking", "/ai", "/team", "/org-chart", "/profile",
];

const full = [...NAV_TOP, ...NAV_GROUPS.flatMap(g => g.items), ...NAV_BOTTOM];

describe("navigation config", () => {
  it("keeps every link of the old full menu, once each", () => {
    // Meetings replaced "/meetings" and "/meeting-assistant" (one link); Attendance is the only addition.
    const routes = full.map(i => i.to).filter(r => r !== "/attendance");
    expect([...routes].sort()).toEqual([...OLD_FULL_MENU].sort());
  });

  it("lists Meetings once, behind the meeting permission and its feature flag; the old meeting links are gone", () => {
    const items = full.filter(i => i.to === "/meetings");
    expect(items).toHaveLength(1);
    expect(items[0].gate).toEqual({ can: "USE_MEETING_ASSISTANT", flag: "aiMeetingAssistant" });
    expect(full.some(i => i.to === "/meeting-assistant" || i.to === "/ai-meeting-assistant")).toBe(false);
    expect(NAV_RESTRICTED.find(i => i.to === "/meetings").gate).toEqual({ can: "USE_MEETING_ASSISTANT", flag: "aiMeetingAssistant" });
  });

  it("lists Attendance under People and in the restricted menu, behind its feature flag", () => {
    const items = full.filter(i => i.to === "/attendance");
    expect(items).toHaveLength(1);
    expect(items[0].gate).toEqual({ flag: "attendance" });
    expect(NAV_GROUPS.find(g => g.id === "people").items.some(i => i.to === "/attendance")).toBe(true);
    expect(NAV_RESTRICTED.find(i => i.to === "/attendance").gate).toEqual({ flag: "attendance" });
  });

  it("keeps every link of the old restricted menu", () => {
    const routes = [...NAV_RESTRICTED, ...NAV_BOTTOM].map(i => i.to).filter(r => r !== "/attendance");
    expect([...routes].sort()).toEqual([...OLD_RESTRICTED_MENU].sort());
  });

  it("keeps the old permission gates", () => {
    const gate = to => full.find(i => i.to === to).gate;
    expect(gate("/meetings")).toEqual({ can: "USE_MEETING_ASSISTANT", flag: "aiMeetingAssistant" });
    expect(gate("/workspace-settings")).toEqual({ cando: "manageSettings" });
    expect(gate("/admin")).toEqual({ cando: "adminOnly" });
    expect(gate("/access-control")).toEqual({ cando: "adminOnly" });
  });

  it("keeps the overdue badges on Projects and Tasks", () => {
    expect(full.find(i => i.to === "/projects").badge).toBe("overdueProjects");
    expect(full.find(i => i.to === "/tasks").badge).toBe("overdueTasksOnly");
  });

  it("every item has an icon component", () => {
    [...full, ...NAV_RESTRICTED].forEach(i => expect(i.icon, i.to).toBeTruthy());
  });
});

describe("matchesPath", () => {
  it("matches nested routes but not look-alike prefixes", () => {
    const projects = { to: "/projects" };
    expect(matchesPath(projects, "/projects")).toBe(true);
    expect(matchesPath(projects, "/projects/p1")).toBe(true);
    expect(matchesPath(projects, "/projects-archive")).toBe(false);
  });
  it("treats / and end items as exact", () => {
    expect(matchesPath({ to: "/" }, "/tasks")).toBe(false);
    expect(matchesPath({ to: "/ai", end: true }, "/ai-settings")).toBe(false);
    expect(matchesPath({ to: "/jira-board", end: true }, "/jira-board/settings")).toBe(false);
  });
});

describe("locate (top bar trail)", () => {
  it("names the section and page", () => {
    expect(locate("/projects")).toEqual({ section: "Work", label: "Projects" });
    expect(locate("/org-chart")).toEqual({ section: "People", label: "Org chart" });
    expect(locate("/")).toEqual({ section: null, label: "Dashboard" });
  });
  it("prefers the most specific route", () => {
    expect(locate("/jira-board/settings")).toEqual({ section: "Settings", label: "Jira settings" });
    expect(locate("/integrations/meeting-platforms")).toEqual({ section: "Automate", label: "Integrations" });
  });
  it("falls back to a readable name for unlisted pages", () => {
    expect(locate("/search")).toEqual({ section: null, label: "Search" });
    expect(locate("/workflow-guide")).toEqual({ section: null, label: "Workflow guide" });
    expect(locate("/some-page/x")).toEqual({ section: null, label: "Some Page" });
  });
});
