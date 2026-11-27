import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reportClientError, resetReportedErrors, describeError } from "../../utils/reportError";

describe("reportClientError", () => {
  beforeEach(() => { resetReportedErrors(); globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true })); });
  afterEach(() => { delete globalThis.fetch; });

  it("sends the problem to the server once, with where it happened", () => {
    expect(reportClientError(new Error("x.map is not a function"), "page")).toBe(true);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/auth\/client-errors$/);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ message: "x.map is not a function", source: "page" });
    expect(body.page).toBeTruthy();
  });

  it("does not repeat the same problem, and stops after a few", () => {
    const e = new Error("same");
    expect(reportClientError(e, "page")).toBe(true);
    expect(reportClientError(e, "page")).toBe(false);
    for (let i = 0; i < 10; i++) reportClientError(new Error(`other ${i}`), "page");
    expect(fetch.mock.calls.length).toBe(5);
  });

  it("ignores an old page asking for a file that is gone (it reloads by itself)", () => {
    expect(reportClientError(new Error("Failed to fetch dynamically imported module"), "page")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never throws, even when the network is down", () => {
    globalThis.fetch = vi.fn(() => { throw new Error("offline"); });
    expect(() => reportClientError(new Error("y"), "app")).not.toThrow();
    expect(describeError(null).message).toBe("Unknown error");
  });
});
