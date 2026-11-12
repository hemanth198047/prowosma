import { describe, it, expect } from "vitest";
import { taskMatches, facetCount, matchesDue, dueBucket, groupTasks } from "../../utils/taskFilters";

const NOW = new Date(2026, 10, 12, 15, 0); // Thursday 12 Nov 2026, 3pm local
const at = (d, h = 9) => new Date(2026, 10, 12 + d, h, 0).toISOString();

const T = [
  { id: "1", title: "Fix login", status: "IN_PROGRESS", priority: "HIGH", projectId: "p1", assigneeIds: ["m1"], dueDate: at(-3), tags: ["web"] },
  { id: "2", title: "Draft copy", status: "TODO", priority: "MEDIUM", projectId: "p2", assigneeIds: [], dueDate: at(0, 18), tags: [] },
  { id: "3", title: "Ship it", status: "DONE", priority: "LOW", projectId: "p1", assigneeIds: ["m2"], dueDate: at(-1) },
  { id: "4", title: "Plan sprint", status: "TODO", priority: "HIGH", projectId: "sub", assigneeIds: ["m1"], dueDate: at(2) },
  { id: "5", title: "Someday", status: "TODO", priority: "LOW", projectId: null, assigneeIds: [] },
  { id: "6", title: "Next month", status: "TODO", priority: "MEDIUM", projectId: "p2", assigneeIds: ["m2"], dueDate: at(30), tags: ["web", "ops"] },
];
const ctx = { now: NOW, projectIds: (id) => (id === "p1" ? ["p1", "sub"] : [id]) };
const none = { status: "", priority: "", project: "", assignee: "", due: "", search: "" };

describe("matchesDue (same rules the page always used)", () => {
  it("overdue = past the due moment and not DONE", () => {
    expect(T.filter(t => matchesDue(t, "overdue", NOW)).map(t => t.id)).toEqual(["1"]);
  });
  it("today = same calendar day", () => {
    expect(T.filter(t => matchesDue(t, "today", NOW)).map(t => t.id)).toEqual(["2"]);
  });
  it("this week runs through Saturday; this month through month end", () => {
    expect(T.filter(t => matchesDue(t, "week", NOW)).map(t => t.id)).toEqual(["2", "4"]);
    expect(T.filter(t => matchesDue(t, "month", NOW)).map(t => t.id)).toEqual(["2", "4"]);
  });
  it("no date", () => {
    expect(T.filter(t => matchesDue(t, "nodate", NOW)).map(t => t.id)).toEqual(["5"]);
  });
});

describe("taskMatches", () => {
  it("project filter includes sub-projects", () => {
    expect(T.filter(t => taskMatches(t, { ...none, project: "p1" }, ctx)).map(t => t.id)).toEqual(["1", "3", "4"]);
  });
  it("assignee and unassigned", () => {
    expect(T.filter(t => taskMatches(t, { ...none, assignee: "m1" }, ctx)).map(t => t.id)).toEqual(["1", "4"]);
    expect(T.filter(t => taskMatches(t, { ...none, assignee: "__unassigned__" }, ctx)).map(t => t.id)).toEqual(["2", "5"]);
  });
  it("search is case-insensitive on the title; filters combine", () => {
    expect(T.filter(t => taskMatches(t, { ...none, search: "PLAN" }, ctx)).map(t => t.id)).toEqual(["4"]);
    expect(T.filter(t => taskMatches(t, { ...none, status: "TODO", priority: "HIGH" }, ctx)).map(t => t.id)).toEqual(["4"]);
  });
});

describe("facetCount", () => {
  it("counts what a choice would leave, keeping the other filters", () => {
    const f = { ...none, priority: "HIGH" };
    expect(facetCount(T, f, "status", "TODO", ctx)).toBe(1);
    expect(facetCount(T, f, "status", "IN_PROGRESS", ctx)).toBe(1);
    expect(facetCount(T, f, "status", "DONE", ctx)).toBe(0);
    // the facet's own current value is replaced, not stacked
    expect(facetCount(T, f, "priority", "LOW", ctx)).toBe(2);
  });
});

describe("dueBucket / groupTasks", () => {
  it("buckets by due date, done tasks last", () => {
    expect(T.map(t => dueBucket(t, NOW))).toEqual(["overdue", "today", "done", "week", "nodate", "later"]);
  });
  it("groups by due date in reading order", () => {
    const g = groupTasks(T, "due", { now: NOW });
    expect(g.map(x => x.label)).toEqual(["Overdue", "Today", "This week", "Later", "No due date", "Done"]);
    expect(g[0].tone).toBe("late");
  });
  it("groups by status with readable labels", () => {
    const g = groupTasks(T, "status", { statusLabel: (s) => s.toLowerCase(), now: NOW });
    expect(g.map(x => [x.label, x.tasks.length])).toEqual([["todo", 4], ["in_progress", 1], ["done", 1]]);
  });
  it("groups by project, unknown project last", () => {
    const projects = [{ id: "p2", name: "Beta", color: "#123" }, { id: "p1", name: "Alpha" }];
    const g = groupTasks(T, "project", { projects, now: NOW });
    expect(g.map(x => x.label)).toEqual(["Alpha", "Beta", "No project"]);
    expect(g[1].color).toBe("#123");
  });
  it("groups by tag, a task in each of its tags, untagged last", () => {
    const g = groupTasks(T, "tag", { now: NOW });
    expect(g.map(x => [x.label, x.tasks.map(t => t.id)])).toEqual([["ops", ["6"]], ["web", ["1", "6"]], ["No tag", ["3", "2", "4", "5"]]]);
  });
});
