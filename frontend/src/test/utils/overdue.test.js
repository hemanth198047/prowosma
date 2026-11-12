import { describe, it, expect } from "vitest";
import { isTaskOverdue } from "../../utils/overdue";

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
