import { describe, it, expect } from "vitest";
import { statusText, statusClass } from "../../utils/statusText";

describe("statusText", () => {
  it("replaces every underscore, not just the first, and keeps case", () => {
    expect(statusText("ON_HOLD")).toBe("ON HOLD");
    expect(statusText("NOT_YET_STARTED")).toBe("NOT YET STARTED");
    expect(statusText("Active")).toBe("Active");
  });
  it("is safe with empty values", () => {
    expect(statusText(undefined)).toBe("");
    expect(statusText(null)).toBe("");
  });
});

describe("statusClass", () => {
  it("normalises spaces and case so every status maps to one badge class", () => {
    expect(statusClass("IN PROGRESS")).toBe("in_progress");
    expect(statusClass("ON_HOLD")).toBe("on_hold");
    expect(statusClass(undefined)).toBe("");
  });
});
