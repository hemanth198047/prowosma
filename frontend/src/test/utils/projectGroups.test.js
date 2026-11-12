import { describe, it, expect } from "vitest";
import { projectState, isOverdue, groupProjects, projectSummary, dueLabel, compareByDue } from "../../utils/projectGroups";

const NOW = new Date(2026, 10, 12, 15, 0); // 12 Nov 2026, 3pm local
const day = (n) => new Date(2026, 10, 12 + n, 9, 0).toISOString();

describe("projectState", () => {
  it("maps stored statuses to the four page groups", () => {
    expect(projectState({ status: "ACTIVE" })).toBe("motion");
    expect(projectState({ status: "IN_PROGRESS" })).toBe("motion");
    expect(projectState({ status: "AT_RISK" })).toBe("motion");
    expect(projectState({ status: "ON_HOLD" })).toBe("paused");
    expect(projectState({ status: "paused" })).toBe("paused");
    expect(projectState({ status: "COMPLETED" })).toBe("done");
    expect(projectState({ status: "cancelled" })).toBe("done");
    expect(projectState({ status: "NOT_STARTED" })).toBe("notstarted");
    expect(projectState({ status: "Planning" })).toBe("notstarted");
  });
  it("treats an archived project as paused unless it's finished", () => {
    expect(projectState({ status: "ACTIVE", archived: true })).toBe("paused");
    expect(projectState({ status: "DONE", archived: true })).toBe("done");
  });
  it("puts unknown or missing statuses in motion rather than hiding them", () => {
    expect(projectState({ status: "SOMETHING_NEW" })).toBe("motion");
    expect(projectState({})).toBe("motion");
  });
});

describe("isOverdue / dueLabel", () => {
  it("is overdue from the day after the due date, never when done", () => {
    expect(isOverdue({ status: "ACTIVE", dueDate: day(-1) }, NOW)).toBe(true);
    expect(isOverdue({ status: "ACTIVE", dueDate: day(0) }, NOW)).toBe(false);
    expect(isOverdue({ status: "DONE", dueDate: day(-5) }, NOW)).toBe(false);
    expect(isOverdue({ status: "ACTIVE" }, NOW)).toBe(false);
  });
  it("reads naturally", () => {
    expect(dueLabel({ status: "ACTIVE", dueDate: day(-2) }, NOW)).toBe("2 days overdue");
    expect(dueLabel({ status: "ACTIVE", dueDate: day(-1) }, NOW)).toBe("1 day overdue");
    expect(dueLabel({ status: "ACTIVE", dueDate: day(0) }, NOW)).toBe("Due today");
    expect(dueLabel({ status: "ACTIVE", dueDate: day(1) }, NOW)).toBe("Due tomorrow");
    expect(dueLabel({ status: "ACTIVE", dueDate: day(8) }, NOW, "en-GB")).toBe("Due 20 Nov");
    expect(dueLabel({ status: "DONE", dueDate: day(-10) }, NOW, "en-GB")).toBe("Due 2 Nov");
    expect(dueLabel({ status: "ACTIVE" }, NOW)).toBe("No due date");
  });
});

describe("groupProjects / projectSummary", () => {
  const list = [
    { id: "a", name: "B later", status: "ACTIVE", dueDate: day(20) },
    { id: "b", name: "A soon", status: "ACTIVE", dueDate: day(3) },
    { id: "c", name: "No date", status: "ACTIVE" },
    { id: "d", name: "Held", status: "ON_HOLD", dueDate: day(-2) },
    { id: "e", name: "Shipped", status: "COMPLETED", dueDate: day(-10) },
  ];
  it("groups in display order, soonest due first, undated last, no empty groups", () => {
    const g = groupProjects(list);
    expect(g.map(s => s.label)).toEqual(["In motion", "Paused", "Done"]);
    expect(g[0].projects.map(p => p.id)).toEqual(["b", "a", "c"]);
  });
  it("counts each state and the overdue ones", () => {
    expect(projectSummary(list, NOW)).toEqual({ motion: 3, notstarted: 0, paused: 1, done: 1, overdue: 1, total: 5 });
  });
  it("breaks due-date ties by name", () => {
    const x = { name: "b", dueDate: day(1) }, y = { name: "a", dueDate: day(1) };
    expect([x, y].sort(compareByDue)[0]).toBe(y);
  });
});
