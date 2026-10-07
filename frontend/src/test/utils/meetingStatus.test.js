import { describe, it, expect } from "vitest";
import {
  statusMeta, isActiveStatus, canCancelSession, canRetrySession, submitLabel, providerName, ALL_STATUSES, localInputValue,
  formatClock, ACCEPTS_TRANSCRIPT, WAITING_FOR_TRANSCRIPT,
} from "../../utils/meetingStatus";

describe("meetingStatus", () => {
  it("knows every lifecycle state the backend defines", () => {
    expect(ALL_STATUSES).toEqual(expect.arrayContaining([
      "SCHEDULED", "AWAITING_TRANSCRIPT", "TRANSCRIPT_RECEIVED", "CONNECTING", "WAITING_FOR_ADMISSION", "LISTENING",
      "RECONNECTING", "PROCESSING", "READY_FOR_REVIEW", "COMPLETED", "FAILED", "CANCELLED",
    ]));
    expect(statusMeta("NOPE").label).toBe("NOPE");
  });

  it("treats completed, failed and cancelled as finished", () => {
    for (const s of ["COMPLETED", "FAILED", "CANCELLED"]) expect(isActiveStatus(s)).toBe(false);
    for (const s of ["SCHEDULED", "PROCESSING", "READY_FOR_REVIEW"]) expect(isActiveStatus(s)).toBe(true);
  });

  it("offers cancel only for manageable, in-flight sessions and retry only after failure", () => {
    expect(canCancelSession({ canManage: true, status: "AWAITING_TRANSCRIPT" })).toBe(true);
    expect(canCancelSession({ canManage: false, status: "AWAITING_TRANSCRIPT" })).toBe(false);
    expect(canCancelSession({ canManage: true, status: "COMPLETED" })).toBe(false);
    expect(canRetrySession({ canManage: true, status: "FAILED" })).toBe(true);
    expect(canRetrySession({ canManage: true, status: "CANCELLED" })).toBe(false);
  });

  it("never says 'Send Meeting Assistant' unless a platform can really join live", () => {
    expect(submitLabel(null)).toBe("Register meeting");
    expect(submitLabel({ platforms: [{ liveJoin: false }] })).toBe("Register meeting");
    expect(submitLabel({ platforms: [{ liveJoin: false }, { liveJoin: true }] })).toBe("Send Meeting Assistant");
  });

  it("formats names and datetime-local values", () => {
    expect(providerName("GOOGLE_MEET")).toBe("Google Meet");
    expect(providerName("ZOOM")).toBe("ZOOM");
    expect(localInputValue(new Date(2026, 0, 5, 9, 7))).toBe("2026-01-05T09:07");
  });

  it("formats transcript timestamps", () => {
    expect(formatClock(83000)).toBe("01:23");
    expect(formatClock(3723000)).toBe("1:02:03");
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(null)).toBe("");
    expect(formatClock(undefined)).toBe("");
  });

  it("mirrors the server's rule for when a transcript may be added", () => {
    expect(ACCEPTS_TRANSCRIPT).toEqual(expect.arrayContaining(["SCHEDULED", "AWAITING_TRANSCRIPT", "TRANSCRIPT_RECEIVED", "FAILED", "READY_FOR_REVIEW"]));
    for (const s of ["PROCESSING", "COMPLETED", "CANCELLED"]) expect(ACCEPTS_TRANSCRIPT).not.toContain(s);
    expect(WAITING_FOR_TRANSCRIPT).toEqual(["SCHEDULED", "AWAITING_TRANSCRIPT"]);
  });
});
