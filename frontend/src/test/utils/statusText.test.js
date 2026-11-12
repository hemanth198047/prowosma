import { describe, it, expect } from "vitest";
import { statusText, statusClass } from "../../utils/statusText";

describe("statusText", () => {
  it("turns enum values into sentence case, every underscore replaced", () => {
    expect(statusText("ON_HOLD")).toBe("On hold");
    expect(statusText("NOT_YET_STARTED")).toBe("Not yet started");
    expect(statusText("DONE")).toBe("Done");
  });
  it("keeps acronyms and mixed-case values as they are", () => {
    expect(statusText("QA_REVIEW")).toBe("QA review");
    expect(statusText("Active")).toBe("Active");
    expect(statusText("Needs_input")).toBe("Needs input");
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
