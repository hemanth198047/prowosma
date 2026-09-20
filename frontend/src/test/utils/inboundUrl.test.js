import { describe, it, expect } from "vitest";
import { inboundUrl } from "../../utils/inboundUrl";

describe("inboundUrl", () => {
  const path = "/api/inbound-events/datadog/abc123";

  it("uses the API's own host, so it works wherever the API is served from", () => {
    expect(inboundUrl("https://api.acme.com/api", path, "https://app.acme.com"))
      .toBe("https://api.acme.com/api/inbound-events/datadog/abc123");
    expect(inboundUrl("http://localhost:9090/api", path, "http://localhost:5173"))
      .toBe("http://localhost:9090/api/inbound-events/datadog/abc123");
  });

  it("falls back to the page's origin when the API base is relative (same-origin deployments)", () => {
    expect(inboundUrl("/api", path, "https://app.acme.com")).toBe("https://app.acme.com" + path);
    expect(inboundUrl(undefined, path, "https://app.acme.com/")).toBe("https://app.acme.com" + path);
  });

  it("falls back rather than throwing when the base URL is unparseable", () => {
    expect(inboundUrl("http://[bad", path, "https://app.acme.com")).toBe("https://app.acme.com" + path);
  });

  it("refuses anything that is not an /api/ path, so a hostile or malformed response can't produce another host", () => {
    for (const bad of ["//evil.com/x", "https://evil.com/api/x", "/other/x", "api/x", "", null, undefined, 42]) {
      expect(inboundUrl("https://api.acme.com/api", bad, "https://app.acme.com")).toBe("");
    }
  });
});
