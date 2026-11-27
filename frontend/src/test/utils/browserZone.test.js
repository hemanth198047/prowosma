import { describe, it, expect, vi, afterEach } from "vitest";
import { browserZone } from "../../utils/browserZone";

describe("browserZone", () => {
  afterEach(() => vi.restoreAllMocks());
  it("returns the browser's IANA zone id", () => {
    expect(browserZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
  it("returns undefined when the browser can't tell, never throws", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => { throw new Error("no intl"); });
    expect(browserZone()).toBeUndefined();
    vi.restoreAllMocks();
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => ({ resolvedOptions: () => ({}) }));
    expect(browserZone()).toBeUndefined();
  });
});
