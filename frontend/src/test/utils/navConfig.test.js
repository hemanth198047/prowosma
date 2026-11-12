import { describe, it, expect } from "vitest";
import { NAV_TOP, NAV_GROUPS, NAV_BOTTOM, NAV_RESTRICTED, locate, matchesPath } from "../../components/shell/navConfig";

// Every route the old emoji sidebar linked to — none may go missing in the redesign.
const OLD_FULL_MENU = [
  "/", "/meeting-assistant", "/projects", "/tasks", "/goals", "/kanban", "/jira-board", "/epics",
  "/deployments", "/knowledge-graph", "/sprints", "/gantt", "/calendar", "/docs", "/meetings", "/sops",
  "/analytics", "/portfolio", "/roadmap", "/change-requests", "/portfolio-plus", "/kpis", "/executive",
  "/roi", "/scenarios", "/decisions", "/reports", "/time-tracking", "/bpm", "/automations",
  "/import-export", "/integrations", "/import", "/channels", "/team", "/org-chart", "/activity",
  "/categories", "/custom-fields", "/workspace-settings", "/admin", "/access-control", "/white-label",
  "/jira-board/settings", "/developer", "/ai", "/ai-intelligence", "/ai-settings", "/profile",
];
const OLD_RESTRICTED_MENU = [
  "/tasks", "/kanban", "/calendar", "/projects", "/meeting-assistant", "/gantt", "/goals", "/sprints",
  "/epics", "/roadmap", "/change-requests", "/portfolio-plus", "/docs", "/sops", "/decisions",
  "/channels", "/reports", "/analytics", "/time-tracking", "/ai", "/team", "/org-chart", "/profile",
];

const full = [...NAV_TOP, ...NAV_GROUPS.flatMap(g => g.items), ...NAV_BOTTOM];

describe("navigation config", () => {
  it("keeps every link of the old full menu, once each", () => {
    const routes = full.map(i => i.to);
    expect([...routes].sort()).toEqual([...OLD_FULL_MENU].sort());
  });

  it("keeps every link of the old restricted menu", () => {
    const routes = [...NAV_RESTRICTED, ...NAV_BOTTOM].map(i => i.to);
    expect([...routes].sort()).toEqual([...OLD_RESTRICTED_MENU].sort());
  });

  it("keeps the old permission gates", () => {
    const gate = to => full.find(i => i.to === to).gate;
    expect(gate("/meeting-assistant")).toEqual({ can: "USE_MEETING_ASSISTANT" });
    expect(gate("/workspace-settings")).toEqual({ cando: "manageSettings" });
    expect(gate("/admin")).toEqual({ cando: "adminOnly" });
    expect(gate("/access-control")).toEqual({ cando: "adminOnly" });
    expect(NAV_RESTRICTED.find(i => i.to === "/meeting-assistant").gate).toEqual({ can: "USE_MEETING_ASSISTANT" });
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
    expect(locate("/jira-board/settings")).toEqual({ section: "Settings", label: "Jira Settings" });
    expect(locate("/integrations/meeting-platforms")).toEqual({ section: "Automate", label: "Integrations" });
  });
  it("falls back to a readable name for unlisted pages", () => {
    expect(locate("/search")).toEqual({ section: null, label: "Search" });
    expect(locate("/workflow-guide")).toEqual({ section: null, label: "Workflow guide" });
    expect(locate("/some-page/x")).toEqual({ section: null, label: "Some Page" });
  });
});
