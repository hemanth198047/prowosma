import { describe, it, expect } from "vitest";
import { extractLink } from "../../utils/calendarMeetings";

describe("extractLink", () => {
  it("finds a meeting link even when the location has other words", () => {
    expect(extractLink("Room 2 - https://meet.google.com/abc-defg-hij (dial-in below)")).toBe("https://meet.google.com/abc-defg-hij");
  });
  it("returns the bare link as before", () => {
    expect(extractLink("https://zoom.us/j/123")).toBe("https://zoom.us/j/123");
  });
  it("is null when there is no web link, and never accepts other schemes", () => {
    expect(extractLink("Boardroom")).toBeNull();
    expect(extractLink("javascript:alert(1)")).toBeNull();
    expect(extractLink(null)).toBeNull();
  });
});
