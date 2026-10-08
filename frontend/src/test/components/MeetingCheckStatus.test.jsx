import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import MeetingCheckStatus from "../../components/MeetingCheckStatus";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const NOW = new Date("2026-10-08T12:00:00Z");
const base = { provider: "GOOGLE_MEET", canManage: true };
const check = (over = {}) => ({
  at: "2026-10-08T11:57:00Z", code: "NO_TRANSCRIPT_YET",
  message: "The meeting ended 8 minutes ago, but Google has no transcript for it.",
  facts: { connectedAccount: "me@gmail.com", accountType: "PERSONAL", meetingStarted: "2026-10-08T11:20:00Z", meetingEnded: "2026-10-08T11:49:00Z", transcriptSessions: 0 },
  ...over,
});

describe("MeetingCheckStatus", () => {
  it("shows what Google said at the last check, and how long ago", () => {
    vi.useFakeTimers({ now: NOW });
    render(<MeetingCheckStatus session={{ ...base, lastCheck: check() }} />);
    expect(screen.getByRole("heading", { name: "What Prowosma found at Google Meet" })).toBeInTheDocument();
    expect(screen.getByText(/Last checked 3 minutes ago/)).toBeInTheDocument();
    expect(screen.getByText(/Google has no transcript for it/)).toBeInTheDocument();
  });

  it("says plainly that no check has happened yet, and tells managers they can press the button", () => {
    render(<MeetingCheckStatus session={{ ...base }} />);
    expect(screen.getByText(/hasn.t looked yet/)).toBeInTheDocument();
    expect(screen.getByText(/press the check button below/)).toBeInTheDocument();
    cleanup();
    render(<MeetingCheckStatus session={{ ...base, canManage: false }} />);
    expect(screen.queryByText(/press the check button below/)).toBeNull();
  });

  it("shows when Prowosma will look again", () => {
    render(<MeetingCheckStatus session={{ ...base, lastCheck: check(), nextCheckAt: "2026-10-08T12:03:00Z" }} />);
    expect(screen.getByText(/Next automatic check: about/)).toBeInTheDocument();
  });

  it("offers the technical details in plain labels — what Google returned, the account type, times", () => {
    render(<MeetingCheckStatus session={{ ...base, lastCheck: check() }} />);
    const details = screen.getByText("Technical details").closest("details");
    expect(within(details).getByText("Connected account")).toBeInTheDocument();
    expect(within(details).getByText("me@gmail.com")).toBeInTheDocument();
    expect(within(details).getByText("Personal Google account")).toBeInTheDocument();       // not the raw code PERSONAL
    expect(within(details).getByText("Transcription sessions at Google")).toBeInTheDocument();
    expect(within(details).queryByText("PERSONAL")).toBeNull();
  });

  it("leaves out the details when there are none, and names Teams for Teams meetings", () => {
    render(<MeetingCheckStatus session={{ ...base, provider: "MS_TEAMS", lastCheck: check({ facts: {} }) }} />);
    expect(screen.queryByText("Technical details")).toBeNull();
    expect(screen.getByRole("heading", { name: /What Prowosma found at/ }).textContent).not.toContain("Google Meet");
  });

  it("marks a successful import, and problems that need the person to act, differently from 'still waiting'", () => {
    const { container, rerender } = render(<MeetingCheckStatus session={{ ...base, lastCheck: check({ code: "IMPORTED" }) }} />);
    expect(container.querySelector(".ma-check")).toHaveClass("ok");
    rerender(<MeetingCheckStatus session={{ ...base, lastCheck: check({ code: "GOOGLE_SIGN_IN_EXPIRED" }) }} />);
    expect(container.querySelector(".ma-check")).toHaveClass("bad");
    rerender(<MeetingCheckStatus session={{ ...base, lastCheck: check({ code: "MEETING_IN_PROGRESS" }) }} />);
    expect(container.querySelector(".ma-check")).not.toHaveClass("ok");
    expect(container.querySelector(".ma-check")).not.toHaveClass("bad");
  });

  it("is announced politely to screen readers and has no detectable accessibility violations", async () => {
    const { container } = render(<MeetingCheckStatus session={{ ...base, lastCheck: check() }} />);
    expect(container.querySelector("[aria-live='polite']")).not.toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
