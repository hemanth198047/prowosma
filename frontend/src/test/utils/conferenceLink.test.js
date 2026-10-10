import { describe, it, expect } from "vitest";
import { detectPlatform, PLATFORM_NAMES, SUPPORTED_TEXT } from "../../utils/conferenceLink";

describe("detectPlatform (instant feedback; the server re-checks everything)", () => {
  it("recognises the four platforms and names them", () => {
    expect(detectPlatform("https://meet.google.com/abc-defg-hij")).toEqual({ platform: "GOOGLE_MEET", name: "Google Meet" });
    expect(detectPlatform("https://us02web.zoom.us/j/84511223344?pwd=abc")).toEqual({ platform: "ZOOM", name: "Zoom" });
    expect(detectPlatform("https://zoom.us/my/priya.s").platform).toBe("ZOOM");
    expect(detectPlatform("https://teams.microsoft.com/meet/123456789012").platform).toBe("MS_TEAMS");
    expect(detectPlatform("https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABCdef123456%40thread.v2/0").platform).toBe("MS_TEAMS");
    expect(detectPlatform("https://acme.webex.com/meet/priya").platform).toBe("WEBEX");
    expect(PLATFORM_NAMES.MS_TEAMS).toBe("Microsoft Teams");
    expect(SUPPORTED_TEXT).toContain("Google Meet, Zoom, Microsoft Teams and Webex");
  });

  it("surrounding spaces are fine", () => {
    expect(detectPlatform("  https://meet.google.com/abc-defg-hij  ").platform).toBe("GOOGLE_MEET");
  });

  it("refuses look-alike domains, plain http, credentials, odd paths, spaces and junk — exactly the cases the server refuses", () => {
    for (const bad of ["http://meet.google.com/abc-defg-hij", "https://meet.google.com.evil.com/abc-defg-hij", "https://evilmeet.google.com/abc-defg-hij", "https://zoom.us.evil.com/j/84511223344",
      "https://notzoom.us/j/84511223344", "https://user:pw@meet.google.com/abc-defg-hij", "https://example.com/abc-defg-hij", "https://meet.google.com/", "https://meet.google.com/not-a-code",
      "https://zoom.us/j/12", "https://teams.microsoft.com/", "ftp://meet.google.com/abc-defg-hij", "javascript:alert(1)", "https://meet.google.com/abc-defg-hij x", "not a link", "", "   ", null, undefined]) {
      expect(detectPlatform(bad), String(bad)).toBeNull();
    }
    expect(detectPlatform(`https://meet.google.com/abc-defg-hij?x=${"a".repeat(2100)}`)).toBeNull();
  });
});
