import { describe, it, expect } from "vitest";
import { parseAvailability, statusFor, suggestTimes, combineBusy, tzOffsetMinutes, workingWindow } from "../../utils/availability";

// All times are the test machine's local time, so these pass in any time zone.
const day = new Date(2026, 10, 12);
const at = (h, m = 0) => new Date(2026, 10, 12, h, m);
const rows = [
  { email: "Priya@x.com", busy: [{ start: at(10).toISOString(), end: at(11).toISOString() }] },
  { email: "sam@x.com", busy: [{ start: at(9).toISOString(), end: at(9, 30).toISOString() }, { start: at(10, 30).toISOString(), end: at(12).toISOString() }] },
];

describe("availability", () => {
  const av = parseAvailability(rows);

  it("parses and looks up case-insensitively", () => {
    expect(av.get("priya@x.com").busy).toHaveLength(1);
  });

  it("reports free / busy / unknown", () => {
    expect(statusFor(av.get("priya@x.com"), at(10, 30), at(11))).toBe("busy");
    expect(statusFor(av.get("priya@x.com"), at(11), at(11, 30))).toBe("free");
    expect(statusFor(undefined, at(9), at(10))).toBe("unknown");
  });

  it("suggests times when everyone is free, skipping the past", () => {
    const s = suggestTimes({ availability: av, emails: ["priya@x.com", "sam@x.com"], dayStart: day, durationMins: 60, now: at(8), limit: 3 });
    expect(s.map((d) => d.getHours() + ":" + d.getMinutes())).toEqual(["12:0", "12:30", "13:0"]);
    const later = suggestTimes({ availability: av, emails: ["priya@x.com"], dayStart: day, durationMins: 30, now: at(16, 10) });
    expect(later.map((d) => d.getHours() + ":" + d.getMinutes())).toEqual(["16:30", "17:0", "17:30"]);
  });

  it("combines everyone's busy blocks", () => {
    const c = combineBusy([av.get("priya@x.com"), av.get("sam@x.com")]);
    expect(c.map((b) => [b.start.getHours() * 60 + b.start.getMinutes(), b.end.getHours() * 60 + b.end.getMinutes()])).toEqual([[540, 570], [600, 720]]);
  });

  it("knows time-zone offsets and shifts working hours", () => {
    expect(tzOffsetMinutes("Asia/Kolkata", at(12))).toBe(330);
    expect(tzOffsetMinutes("Bad/Zone", at(12))).toBeNull();
    const london = workingWindow("Europe/London", day); // London is on UTC in November
    expect(london.start.toISOString()).toBe("2026-11-12T09:00:00.000Z");
    expect(london.end.toISOString()).toBe("2026-11-12T18:00:00.000Z");
    expect(workingWindow(null, day).own).toBe(true);
  });
});
