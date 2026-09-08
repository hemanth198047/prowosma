import { describe, it, expect } from "vitest";
import { unwrapList, unwrapPaged } from "../../api/client";

/**
 * unwrapList/unwrapPaged are the single highest-value functions to test in
 * this whole frontend: across this project's hardening work, at least 16
 * separate confirmed bugs (2FA setup, the main Portfolio dashboard, ROI
 * summaries, AI recommendations, workspace creation, and more) all traced
 * back to the exact same root cause — calling unwrapList() on an endpoint
 * that returns a single object instead of a list. unwrapList silently
 * returns [] in that case rather than throwing, which is exactly why the
 * bug was invisible in the UI (no error, just permanently-empty data) and
 * why it happened so many times independently.
 *
 * These tests exist to do two things: lock in correct behavior for the
 * three real list shapes the backend actually returns, and make the
 * dangerous single-object fallback an explicit, named, intentional
 * behavior instead of an undocumented footgun — so the next person who
 * hits it can find this test and understand immediately why their data
 * came back empty, instead of re-discovering the same bug from scratch.
 */
describe("unwrapList", () => {
  it("returns a direct array as-is", () => {
    const response = { data: [{ id: "1" }, { id: "2" }] };
    expect(unwrapList(response)).toEqual([{ id: "1" }, { id: "2" }]);
  });

  it("unwraps a PagedResponse shape ({ data: [...] })", () => {
    const response = {
      data: { data: [{ id: "1" }], page: 0, totalElements: 1, totalPages: 1, hasNext: false },
    };
    expect(unwrapList(response)).toEqual([{ id: "1" }]);
  });

  it("unwraps a Spring Page shape ({ content: [...] })", () => {
    const response = { data: { content: [{ id: "1" }, { id: "2" }] } };
    expect(unwrapList(response)).toEqual([{ id: "1" }, { id: "2" }]);
  });

  it("returns [] for a missing response body", () => {
    expect(unwrapList({})).toEqual([]);
    expect(unwrapList(undefined)).toEqual([]);
  });

  it(
    "returns [] (not an error) for a single-object response — " +
    "THIS is the exact footgun that caused 16+ real bugs. If a component " +
    "reads unwrapList(response) and the response is actually a single " +
    "object (e.g. {totalProjects, healthyCount, ...}), this silently " +
    "returns an empty array instead of failing loudly. Never call " +
    "unwrapList on an endpoint whose backend controller returns a single " +
    "object/Map rather than a List/PagedResponse — use response.data directly.",
    () => {
      const singleObjectResponse = { data: { totalProjects: 5, healthyCount: 3, projects: [] } };
      expect(unwrapList(singleObjectResponse)).toEqual([]);
    }
  );
});

describe("unwrapPaged", () => {
  it("extracts data + pagination metadata from a real PagedResponse", () => {
    const response = {
      data: { data: [{ id: "1" }], page: 2, totalPages: 5, totalElements: 42, hasNext: true },
    };
    expect(unwrapPaged(response)).toEqual({
      data: [{ id: "1" }],
      page: 2,
      totalPages: 5,
      totalElements: 42,
      hasNext: true,
    });
  });

  it("defaults pagination fields when missing, rather than returning undefined", () => {
    const response = { data: { data: [{ id: "1" }] } };
    expect(unwrapPaged(response)).toEqual({
      data: [{ id: "1" }],
      page: 0,
      totalPages: 0,
      totalElements: 0,
      hasNext: false,
    });
  });

  it("returns an empty-but-well-formed shape for a missing response body", () => {
    expect(unwrapPaged({})).toEqual({
      data: [], page: 0, totalPages: 0, totalElements: 0, hasNext: false,
    });
  });
});
