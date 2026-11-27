import { describe, it, expect } from "vitest";
import { isHtmlInsteadOfData, isSessionFailure } from "../../api/client";

describe("a web page where data was expected", () => {
  it("is detected for an HTML string", () => {
    expect(isHtmlInsteadOfData({ data: "<!doctype html><html></html>", headers: { "content-type": "text/html; charset=utf-8" }, config: {} })).toBe(true);
  });
  it("is not mistaken for JSON, text files or downloads", () => {
    expect(isHtmlInsteadOfData({ data: { a: 1 }, headers: { "content-type": "application/json" }, config: {} })).toBe(false);
    expect(isHtmlInsteadOfData({ data: "a,b\n1,2", headers: { "content-type": "text/csv" }, config: {} })).toBe(false);
    expect(isHtmlInsteadOfData({ data: "<html>", headers: { "content-type": "text/html" }, config: { responseType: "blob" } })).toBe(false);
    expect(isHtmlInsteadOfData({ data: "<html>", headers: { "content-type": "text/html" }, config: { responseType: "text" } })).toBe(false);
    expect(isHtmlInsteadOfData(undefined)).toBe(false);
  });
});

describe("when a 401 means the sign-in is gone", () => {
  const err = (status, method, url) => ({ response: { status }, config: { method, url } });
  it("is true for an ordinary 401", () => {
    expect(isSessionFailure(err(401, "get", "/tasks"))).toBe(true);
    expect(isSessionFailure(err(401, "post", "/meetings"))).toBe(true);
  });
  it("is false for other statuses and for a wrong password on 'delete my account'", () => {
    expect(isSessionFailure(err(403, "get", "/tasks"))).toBe(false);
    expect(isSessionFailure(err(500, "get", "/tasks"))).toBe(false);
    expect(isSessionFailure(err(401, "delete", "/users/me"))).toBe(false);
    expect(isSessionFailure({})).toBe(false);
  });
});
