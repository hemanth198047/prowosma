import { describe, it, expect } from "vitest";
import { isPathAllowedForRestricted, RESTRICTED_LANDING } from "../../utils/accessAreas";

describe("isPathAllowedForRestricted", () => {
  it("allows the scoped areas and their sub-pages", () => {
    for (const p of ["/tasks", "/projects", "/projects/p1", "/team", "/profile"]) expect(isPathAllowedForRestricted(p)).toBe(true);
  });
  it("refuses everything not yet scoped", () => {
    for (const p of ["/", "/dashboard", "/reports", "/search", "/docs", "/gantt", "/admin", "/access-control", "/tasksX", "/projects-archive"]) {
      expect(isPathAllowedForRestricted(p)).toBe(false);
    }
  });
  it("lands people on their tasks", () => {
    expect(RESTRICTED_LANDING).toBe("/tasks");
  });
});
