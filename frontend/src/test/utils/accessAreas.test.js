import { describe, it, expect } from "vitest";
import { isPathAllowedForRestricted, RESTRICTED_LANDING } from "../../utils/accessAreas";

describe("isPathAllowedForRestricted", () => {
  it("allows the scoped areas and their sub-pages", () => {
    for (const p of ["/tasks", "/kanban", "/calendar", "/gantt", "/docs", "/docs/abc", "/goals", "/sprints", "/reports", "/analytics", "/ai", "/sops", "/decisions", "/channels", "/search", "/projects", "/projects/p1", "/team", "/profile"]) {
      expect(isPathAllowedForRestricted(p)).toBe(true);
    }
  });
  it("refuses everything not yet scoped", () => {
    for (const p of ["/", "/dashboard", "/dashboard-x", "/admin", "/access-control", "/tasksX", "/projects-archive", "/meetings", "/kpis", "/roi", "/scenarios", "/automations", "/integrations", "/bpm", "/import", "/expertise", "/deployments", "/goalsX"]) {
      expect(isPathAllowedForRestricted(p)).toBe(false);
    }
  });
  it("opens the meeting assistant only with the capability", () => {
    expect(isPathAllowedForRestricted("/meeting-assistant")).toBe(false);
    expect(isPathAllowedForRestricted("/meeting-assistant", ["CREATE_TASK"])).toBe(false);
    expect(isPathAllowedForRestricted("/meeting-assistant", ["USE_MEETING_ASSISTANT"])).toBe(true);
    expect(isPathAllowedForRestricted("/meeting-assistantX", ["USE_MEETING_ASSISTANT"])).toBe(false);
  });
  it("lands people on their tasks", () => {
    expect(RESTRICTED_LANDING).toBe("/tasks");
  });
});
