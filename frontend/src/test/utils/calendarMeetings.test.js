import { describe, it, expect } from "vitest";
import { parseServerDateTime, toServerDateTime, toLocalInputValue, fromLocalParts } from "../../utils/serverTime";
import {
  meetingEnd, meetingToEvent, slotFromClick, slotFromSelection, nextHalfHour,
  findConflicts, isLink, formatDuration, parseAttendees,
} from "../../utils/calendarMeetings";

describe("serverTime", () => {
  it("reads a zone-less server time as UTC", () => {
    expect(parseServerDateTime("2026-11-12T04:30:00").toISOString()).toBe("2026-11-12T04:30:00.000Z");
  });
  it("keeps an explicit zone", () => {
    expect(parseServerDateTime("2026-11-12T10:00:00+05:30").toISOString()).toBe("2026-11-12T04:30:00.000Z");
  });
  it("returns null for empty or invalid input", () => {
    expect(parseServerDateTime(null)).toBeNull();
    expect(parseServerDateTime("nope")).toBeNull();
  });
  it("round-trips local input values", () => {
    const d = fromLocalParts("2026-11-12", "10:15");
    expect(toLocalInputValue(d)).toBe("2026-11-12T10:15");
    expect(parseServerDateTime(toServerDateTime(d)).getTime()).toBe(d.getTime());
  });
});

describe("calendarMeetings", () => {
  const m = (id, start, mins, extra = {}) => ({ id, title: id, meetingDate: start, durationMins: mins, ...extra });

  it("defaults a meeting with no duration to 30 minutes", () => {
    expect(meetingEnd(m("a", "2026-11-12T04:30:00", null)).toISOString()).toBe("2026-11-12T05:00:00.000Z");
  });

  it("makes completed meetings read-only on the calendar", () => {
    expect(meetingToEvent(m("a", "2026-11-12T04:30:00", 60)).editable).toBe(true);
    expect(meetingToEvent(m("a", "2026-11-12T04:30:00", 60, { status: "COMPLETED" })).editable).toBe(false);
    expect(meetingToEvent(m("a", null, 60))).toBeNull();
  });

  it("starts a whole-day click at 9:00 for 30 minutes", () => {
    const { start, end } = slotFromClick(new Date(2026, 10, 12), true);
    expect([start.getHours(), start.getMinutes()]).toEqual([9, 0]);
    expect(end - start).toBe(30 * 60000);
  });

  it("keeps the clicked time in the time grid", () => {
    const { start } = slotFromClick(new Date(2026, 10, 12, 14, 30), false);
    expect([start.getHours(), start.getMinutes()]).toEqual([14, 30]);
  });

  it("uses a dragged range as-is", () => {
    const s = new Date(2026, 10, 12, 10, 0);
    const e = new Date(2026, 10, 12, 11, 30);
    const slot = slotFromSelection(s, e, false);
    expect(slot.end - slot.start).toBe(90 * 60000);
  });

  it("rounds New meeting up to the next half hour", () => {
    expect(nextHalfHour(new Date(2026, 10, 12, 10, 5)).start.getMinutes()).toBe(30);
    const r = nextHalfHour(new Date(2026, 10, 12, 10, 40)).start;
    expect([r.getHours(), r.getMinutes()]).toEqual([11, 0]);
  });

  it("finds overlapping meetings but not touching or cancelled ones", () => {
    const list = [
      m("overlap", "2026-11-12T04:45:00", 30),
      m("touching", "2026-11-12T05:00:00", 30),
      m("cancelled", "2026-11-12T04:30:00", 30, { status: "CANCELLED" }),
      m("self", "2026-11-12T04:30:00", 30),
    ];
    const start = new Date("2026-11-12T04:30:00Z");
    const end = new Date("2026-11-12T05:00:00Z");
    expect(findConflicts(start, end, list, "self").map((x) => x.id)).toEqual(["overlap"]);
  });

  it("detects meeting links", () => {
    expect(isLink("https://teams.microsoft.com/l/meetup-join/abc")).toBe(true);
    expect(isLink("Room 4B")).toBe(false);
  });

  it("formats durations", () => {
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(60)).toBe("1 hr");
    expect(formatDuration(90)).toBe("1 hr 30 min");
  });

  it("splits and de-duplicates attendees", () => {
    expect(parseAttendees("a@x.com, B@y.com; a@X.com\n c@z.com,")).toEqual(["a@x.com", "B@y.com", "c@z.com"]);
  });
});
