import { describe, it, expect } from "vitest";
import { apiErrorMessage } from "../../utils/apiError";

const fail = (data) => ({ response: { data } });

describe("apiErrorMessage", () => {
  it("prefers the human `message` over a machine-code `error` (GlobalExceptionHandler shape)", () => {
    expect(apiErrorMessage(fail({ error: "INVALID_CREDENTIALS", message: "Invalid email or password" })))
      .toBe("Invalid email or password");
    expect(apiErrorMessage(fail({ error: "PASSWORD_POLICY_VIOLATION", message: "Password needs a digit" })))
      .toBe("Password needs a digit");
  });

  it("uses `error` when it is already a human sentence and there is no `message` (inline controller shape)", () => {
    expect(apiErrorMessage(fail({ error: "Invitation has expired" }))).toBe("Invitation has expired");
    expect(apiErrorMessage(fail({ error: "Invalid or expired magic link" }))).toBe("Invalid or expired magic link");
  });

  it("never shows a bare machine code — falls back instead", () => {
    expect(apiErrorMessage(fail({ error: "UNAUTHENTICATED" }), "Please sign in")).toBe("Please sign in");
    expect(apiErrorMessage(fail({ error: "INVALID_CREDENTIALS" }), "Login failed")).toBe("Login failed");
  });

  it("treats Spring's status-prefixed codes as codes too", () => {
    expect(apiErrorMessage(fail({ error: "403 FORBIDDEN" }), "fb")).toBe("fb");
    expect(apiErrorMessage(fail({ error: "404 NOT_FOUND" }), "fb")).toBe("fb");
    expect(apiErrorMessage(fail({ error: "403 FORBIDDEN", message: "Viewers cannot do that" }), "fb"))
      .toBe("Viewers cannot do that");
  });

  it("shows the real reason from the filter-level replies (role guard, plan guard, rate limit, IP allowlist)", () => {
    // RoleGuardFilter / WorkspaceFilter: { error: "FORBIDDEN", message }
    expect(apiErrorMessage(fail({ error: "FORBIDDEN", message: "Viewers have read-only access." }), "fb"))
      .toBe("Viewers have read-only access.");
    // PlanGuardFilter (402): { error: "UPGRADE_REQUIRED", message }
    expect(apiErrorMessage(fail({ error: "UPGRADE_REQUIRED", message: "SCIM requires the Enterprise plan." }), "fb"))
      .toBe("SCIM requires the Enterprise plan.");
    // RateLimitFilter (429) and IpAllowlistFilter (403): human `error`, no `message`
    expect(apiErrorMessage(fail({ error: "Too many requests", retryAfterSeconds: 60 }), "fb"))
      .toBe("Too many requests");
    expect(apiErrorMessage(fail({ error: "Access denied: IP not allowlisted" }), "fb"))
      .toBe("Access denied: IP not allowlisted");
  });

  it("falls back for empty, missing or non-object bodies and for network errors", () => {
    expect(apiErrorMessage(fail({}), "fb")).toBe("fb");
    expect(apiErrorMessage(fail({ message: "   ", error: "" }), "fb")).toBe("fb");
    expect(apiErrorMessage(fail("<html>502</html>"), "fb")).toBe("fb");
    expect(apiErrorMessage({ message: "Network Error" }, "fb")).toBe("fb");
    expect(apiErrorMessage(undefined, "fb")).toBe("fb");
  });

  it("has a sensible default fallback", () => {
    expect(apiErrorMessage(fail({}))).toMatch(/something went wrong/i);
  });
});
