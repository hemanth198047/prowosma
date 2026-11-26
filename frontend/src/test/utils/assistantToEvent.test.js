import { describe, it, expect } from "vitest";
import { assistantToEvent, googleToEvent } from "../../utils/calendarMeetings";

describe("assistantToEvent", () => {
  it("puts a meeting at its real time, not in the all-day row", () => {
    const ev = assistantToEvent({ id: "u1", title: "Test Again", meetingAt: "2026-11-26T13:30:00Z", meetingEndAt: "2026-11-26T14:00:00Z" });
    expect(ev.allDay).toBe(false);
    expect(ev.start.toISOString()).toBe("2026-11-26T13:30:00.000Z");
    expect(ev.end.toISOString()).toBe("2026-11-26T14:00:00.000Z");
    expect(ev.extendedProps).toMatchObject({ type: "uma", itemId: "u1" });
  });
  it("defaults to half an hour when the end is missing or wrong", () => {
    expect(assistantToEvent({ id: "a", meetingAt: "2026-11-26T13:30:00Z" }).end.toISOString()).toBe("2026-11-26T14:00:00.000Z");
    expect(assistantToEvent({ id: "a", meetingAt: "2026-11-26T13:30:00Z", meetingEndAt: "2026-11-26T13:00:00Z" }).end.toISOString()).toBe("2026-11-26T14:00:00.000Z");
  });
  it("skips a meeting without a usable time", () => {
    expect(assistantToEvent({ id: "a", meetingAt: "nope" })).toBeNull();
  });
});

describe("googleToEvent", () => {
  it("shows a timed Google event at its time, lighter until the invitation is answered", () => {
    const ev = googleToEvent({ id: "g1", title: "Test Again", start: "2026-11-26T13:30:00Z", end: "2026-11-26T14:00:00Z", myResponse: "needsAction" });
    expect(ev.allDay).toBe(false);
    expect(ev.start.toISOString()).toBe("2026-11-26T13:30:00.000Z");
    expect(ev.classNames).toContain("cal-ev-pending");
    expect(googleToEvent({ id: "g2", start: "2026-11-26T13:30:00Z", myResponse: "accepted" }).classNames).not.toContain("cal-ev-pending");
  });
  it("puts an all-day event in the all-day row and remembers the matching assistant meeting", () => {
    const ev = googleToEvent({ id: "g3", title: "Holiday", allDay: true, startDate: "2026-11-27", endDate: "2026-11-28" }, "u9");
    expect(ev).toMatchObject({ allDay: true, start: "2026-11-27", end: "2026-11-28" });
    expect(ev.extendedProps.umaId).toBe("u9");
  });
  it("skips an event it cannot place", () => {
    expect(googleToEvent({ id: "g4", start: "nope" })).toBeNull();
    expect(googleToEvent(null)).toBeNull();
  });
});
