import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PRIMARY_LINKS, NAV_SECTIONS, RESTRICTED_LINKS, FOOTER_LINKS, sectionForPath } from "../../config/navigation";

// Every link the sidebar had before the redesign (App.jsx on main).
const PREVIOUS_SIDEBAR = [
  "/", "/meeting-assistant", "/projects", "/tasks", "/goals", "/kanban", "/jira-board", "/epics",
  "/deployments", "/knowledge-graph", "/sprints", "/gantt", "/calendar", "/docs", "/meetings", "/sops",
  "/analytics", "/portfolio", "/roadmap", "/change-requests", "/portfolio-plus", "/kpis", "/executive",
  "/roi", "/scenarios", "/decisions", "/reports", "/time-tracking", "/bpm", "/automations",
  "/import-export", "/integrations", "/import", "/channels", "/team", "/activity", "/categories",
  "/custom-fields", "/workspace-settings", "/admin", "/access-control", "/white-label",
  "/jira-board/settings", "/developer", "/ai", "/ai-intelligence", "/ai-settings", "/profile",
];

const all = [...PRIMARY_LINKS, ...NAV_SECTIONS.flatMap((s) => s.items), ...FOOTER_LINKS];
const appSource = readFileSync(resolve(__dirname, "../../App.jsx"), "utf8");
const routes = new Set([...appSource.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));

describe("sidebar navigation config", () => {
  it("keeps every link the sidebar had before", () => {
    const now = new Set(all.map((i) => i.to));
    expect(PREVIOUS_SIDEBAR.filter((p) => !now.has(p))).toEqual([]);
  });

  it("only links to routes that exist", () => {
    const missing = [...all, ...RESTRICTED_LINKS].map((i) => i.to).filter((p) => !routes.has(p));
    expect(missing).toEqual([]);
  });

  it("keeps the same role and capability gates", () => {
    const by = Object.fromEntries(all.map((i) => [i.to, i]));
    expect(by["/meeting-assistant"].capability).toBe("USE_MEETING_ASSISTANT");
    expect(by["/workspace-settings"].action).toBe("manageSettings");
    expect(by["/admin"].action).toBe("adminOnly");
    expect(by["/access-control"].action).toBe("adminOnly");
  });

  it("gives restricted users their previous list, minus the link to a route that never existed", () => {
    const to = RESTRICTED_LINKS.map((i) => i.to);
    expect(to).not.toContain("/releases");
    expect(to).toContain("/portfolio-plus");
    expect(to).not.toContain("/admin");
    expect(RESTRICTED_LINKS.find((i) => i.to === "/meeting-assistant").capability).toBe("USE_MEETING_ASSISTANT");
  });

  it("names the section for a page, preferring the most specific match", () => {
    expect(sectionForPath("/tasks")).toBe("Work");
    expect(sectionForPath("/jira-board/settings")).toBe("Settings");
    expect(sectionForPath("/")).toBeNull();
  });
});
