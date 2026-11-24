import { describe, it, expect } from "vitest";
import { isTaskOverdue, isFinishedStatus } from "../../utils/overdue";
import { matchesDue } from "../../utils/taskFilters";

const now = new Date("2026-11-11T12:00:00Z");

describe("isTaskOverdue (same rule as the Dashboard)", () => {
  it("is overdue when the due date has passed and the task is not done", () => {
    expect(isTaskOverdue({ dueDate: "2026-11-08T00:00:00Z", status: "TODO" }, now)).toBe(true);
    expect(isTaskOverdue({ dueDate: "2026-11-08T00:00:00Z", status: "IN_PROGRESS" }, now)).toBe(true);
  });
  it("is not overdue when done, not yet due, or undated", () => {
    expect(isTaskOverdue({ dueDate: "2026-11-08T00:00:00Z", status: "DONE" }, now)).toBe(false);
    expect(isTaskOverdue({ dueDate: "2026-11-20T00:00:00Z", status: "TODO" }, now)).toBe(false);
    expect(isTaskOverdue({ status: "TODO" }, now)).toBe(false);
  });
});

const past = "2020-01-01T10:00:00";
const NOW = new Date("2026-11-24T12:00:00");


describe("a task that is no longer open is never overdue", () => {
  it.each(["DONE", "done", "CANCELLED", "CLOSED", "COMPLETED", "RESOLVED"])("%s", (status) => {
    expect(isFinishedStatus(status)).toBe(true);
    expect(isTaskOverdue({ dueDate: past, status }, NOW)).toBe(false);
    expect(matchesDue({ dueDate: past, status }, "overdue", NOW)).toBe(false);
  });
  it.each(["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", undefined])("%s past its due date is overdue", (status) => {
    expect(isTaskOverdue({ dueDate: past, status }, NOW)).toBe(true);
    expect(matchesDue({ dueDate: past, status }, "overdue", NOW)).toBe(true);
  });
  it("no due date is never overdue", () => expect(isTaskOverdue({ status: "TODO" }, NOW)).toBe(false));
});
