import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import GoogleMeetTranscriptGuide from "../../components/GoogleMeetTranscriptGuide";

afterEach(cleanup);
const open = () => render(<GoogleMeetTranscriptGuide defaultOpen />);
const text = () => document.body.textContent.replace(/\s+/g, " ");

describe("GoogleMeetTranscriptGuide", () => {
  it("is collapsed by default and can start open", () => {
    const { container } = render(<GoogleMeetTranscriptGuide />);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    cleanup();
    const { container: c2 } = open();
    expect(c2.querySelector("details")).toHaveAttribute("open");
    expect(screen.getByText("How to turn on a transcript in Google Meet (step by step)")).toBeInTheDocument();
  });

  it("leads with the most common mistake: captions and Gemini notes are not a transcript", () => {
    open();
    const key = screen.getByText(/The most common mistake/).closest("div");
    expect(key.textContent).toMatch(/captions/i);
    expect(key.textContent).toMatch(/Take notes for me/);
    expect(key.textContent).toMatch(/not.*the same as/i);
    expect(key.textContent).toMatch(/Start transcription/);
  });

  it("gives every click, in order, for starting a transcript during the meeting", () => {
    open();
    const heading = screen.getByRole("heading", { name: /3\. During the meeting/ });
    const steps = [...heading.nextElementSibling.querySelectorAll("li")].map((li) => li.textContent);
    expect(steps.length).toBeGreaterThanOrEqual(8);
    const joined = steps.join(" | ");
    for (const phrase of ["Activities", "More options", "Transcripts", "Start transcription", "Start", "Transcribing", "Stop transcription", "end the meeting for everyone"]) expect(joined, phrase).toContain(phrase);
    expect(joined.indexOf("Activities")).toBeLessThan(joined.indexOf("Start transcription"));
    expect(joined.indexOf("Start transcription")).toBeLessThan(joined.indexOf("Stop transcription"));
  });

  it("covers eligibility before the meeting: account type, admin, language, device, who can start, storage", () => {
    open();
    const t = text();
    for (const phrase of ["Google Workspace", "not available on personal Google accounts", "@gmail.com", "administrator", "Language", "computer", "host management", "Google Drive"]) expect(t, phrase).toContain(phrase);
    expect(t).toMatch(/Meet mobile app can.t start a transcript/);
  });

  it("explains that the connected Google account in Prowosma must be the organizer", () => {
    open();
    expect(text()).toMatch(/Google saves the transcript for the meeting.s organizer/);
    expect(text()).toContain("Integrations → Meeting Platforms".replace("→", "→"));
  });

  it("explains what happens after the meeting and how Prowosma finds it", () => {
    open();
    expect(text()).toContain("Meet Recordings");
    expect(text()).toContain("Check Google Meet now");
    expect(text()).toMatch(/every few minutes/);
  });

  it("has a troubleshooting table that matches what Prowosma now says, row by row", () => {
    open();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(rows.length).toBeGreaterThanOrEqual(7);
    const all = rows.join(" | ");
    for (const phrase of ["no Transcripts option", "Captions were on but nothing arrived", "Gemini", "Google has no record of this meeting", "Google still shows this meeting as running",
      "Google has no transcript", "may be incomplete", "personal @gmail.com"]) expect(all.toLowerCase(), phrase).toContain(phrase.toLowerCase());
  });

  it("ends with the upload fallback, including how to download the Google Doc", () => {
    open();
    expect(text()).toContain("File → Download → Plain text (.txt)");
    expect(text()).toContain("Add transcript");
    expect(text()).toMatch(/up to 5\s?MB/);
  });

  it("links to Google's own help page, opened safely in a new tab", () => {
    open();
    const link = screen.getByRole("link", { name: "Use transcripts with Google Meet" });
    expect(link).toHaveAttribute("href", "https://support.google.com/meet/answer/12849897");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = open();
    expect(await axe(container)).toHaveNoViolations();
  });
});
