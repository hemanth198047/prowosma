import { describe, it, expect } from "vitest";
import { resultOf } from "../../utils/aiResult";

describe("resultOf (AI response shown to people)", () => {
  it("keeps a single report object, such as the daily standup, instead of turning it into []", () => {
    const standup = { yesterday: "Finished login", today: "API work", blockers: "None", mood: "On Track", suggestion: "Keep going" };
    expect(resultOf({ data: standup })).toEqual(standup);
  });
  it("still unwraps lists and paged shapes", () => {
    expect(resultOf({ data: [1, 2] })).toEqual([1, 2]);
    expect(resultOf({ data: { data: [3], page: 0, totalPages: 1 } })).toEqual([3]);
    expect(resultOf({ data: { content: [4] } })).toEqual([4]);
  });
  it("keeps an object that merely has a data field next to other fields", () => {
    const r = { dependencies: [], message: "Need at least 2 tasks" };
    expect(resultOf({ data: r })).toEqual(r);
  });
  it("gives an empty result for an empty response", () => {
    expect(resultOf({ data: null })).toEqual({});
  });
});
