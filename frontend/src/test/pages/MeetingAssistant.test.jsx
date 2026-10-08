import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";

vi.mock("../../api/meetingAssistant", () => ({
  getAssistantCapabilities: vi.fn(),
  validateMeetingUrl: vi.fn(),
  listMeetingSessions: vi.fn(),
  createMeetingSession: vi.fn(),
  cancelMeetingSession: vi.fn(),
  retryMeetingSession: vi.fn(),
  updateMeetingAccess: vi.fn(),
  devAdvanceMeetingSession: vi.fn(),
  addMeetingTranscript: vi.fn(),
  getMeetingTranscript: vi.fn(),
  deleteMeetingTranscript: vi.fn(),
  fetchMeetingTranscriptNow: vi.fn(),
  generateMeetingOutputs: vi.fn(),
  getMeetingArtifacts: vi.fn(),
  getArtifactVersions: vi.fn(),
  getArtifactVersion: vi.fn(),
  getArtifactDiff: vi.fn(),
  saveArtifact: vi.fn(),
  restoreArtifact: vi.fn(),
  acceptPendingArtifact: vi.fn(),
  dismissPendingArtifact: vi.fn(),
  extractMeetingActions: vi.fn(),
  getMeetingActions: vi.fn(),
  getMeetingActionsPreview: vi.fn(),
  patchMeetingAction: vi.fn(),
  decideMeetingAction: vi.fn(),
  mergeMeetingAction: vi.fn(),
  approveValidMeetingActions: vi.fn(),
  resolveMeetingActionsDiff: vi.fn(),
  patchProposedProject: vi.fn(),
  decideProposedProject: vi.fn(),
  createMeetingRecords: vi.fn(),
}));
vi.mock("../../api/projects", () => ({ getProjects: vi.fn() }));
vi.mock("../../api/team", () => ({ getTeamMembers: vi.fn() }));

import * as api from "../../api/meetingAssistant";
import { getProjects } from "../../api/projects";
import { getTeamMembers } from "../../api/team";
import MeetingAssistant from "../../pages/MeetingAssistant";

const CAPS = {
  assistantName: "Prowosma Meeting Assistant",
  platforms: [{ provider: "GOOGLE_MEET", enabled: true, liveJoin: false, automaticTranscript: false, manualTranscriptUpload: true, connectedForMe: false }],
  googleConfigured: false,
  aiReady: true,
  aiReason: null,
  devFixturesEnabled: false,
  note: "Transcripts can be added by upload or paste. Automatic import isn't set up. The assistant can't join meetings live.",
};
const SESSION = {
  id: "s1", provider: "GOOGLE_MEET", title: "Weekly sync", status: "AWAITING_TRANSCRIPT",
  statusDetail: "Meeting registered. Transcript collection isn't connected yet.", canManage: true,
  requestedBy: "me@x.com", visibility: "PRIVATE", sharedWith: [], history: [], captureStatus: "NONE",
  createdAt: "2026-10-07T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getAssistantCapabilities.mockResolvedValue({ data: CAPS });
  api.listMeetingSessions.mockResolvedValue({ data: [] });
  getProjects.mockResolvedValue({ data: [{ id: "p1", name: "Apollo" }] });
  getTeamMembers.mockResolvedValue({ data: [] });
  api.getMeetingTranscript.mockResolvedValue({ data: { segments: [], total: 0, nextAfter: null } });
  api.getMeetingArtifacts.mockResolvedValue({ data: { SUMMARY: null, MOM: null, NOTES: null } });
  api.getMeetingActions.mockResolvedValue({ data: { status: "NONE", message: null, pendingDiff: null, actions: [], proposedProjects: [] } });
  api.getMeetingActionsPreview.mockResolvedValue({ data: { tasks: [], projects: [], waitingForReview: 0, created: [], failed: [] } });
});
afterEach(cleanup);

const typeUrl = (v) => fireEvent.change(screen.getByLabelText("Meeting link"), { target: { value: v } });

describe("MeetingAssistant page", () => {
  it("is honest: tells people live joining isn't available and labels the button 'Register meeting'", async () => {
    render(<MeetingAssistant />);
    expect(await screen.findByRole("button", { name: "Register meeting" })).toBeDisabled();
    expect(await screen.findByRole("note")).toHaveTextContent("can't join meetings live");     // appears once the capabilities have loaded
    expect(screen.queryByRole("button", { name: "Send Meeting Assistant" })).toBeNull();
  });

  it("shows the server's plain-language reason for a bad link and keeps submit disabled", async () => {
    api.validateMeetingUrl.mockResolvedValue({ data: { valid: false, errorCode: "UNSUPPORTED_PLATFORM", message: "Zoom isn't supported yet." } });
    render(<MeetingAssistant />);
    await screen.findByRole("button", { name: "Register meeting" });
    typeUrl("https://zoom.us/j/123456789");
    expect(await screen.findByText("Zoom isn't supported yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register meeting" })).toBeDisabled();
  });

  it("blocks submit and explains when the platform isn't enabled by an admin", async () => {
    api.validateMeetingUrl.mockResolvedValue({ data: { valid: true, provider: "MS_TEAMS", providerEnabled: false } });
    render(<MeetingAssistant />);
    await screen.findByRole("button", { name: "Register meeting" });
    typeUrl("https://teams.microsoft.com/meet/123456789012");
    expect(await screen.findByText(/isn't enabled yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register meeting" })).toBeDisabled();
  });

  it("registers a valid meeting with the chosen project and shows it in the list", async () => {
    api.validateMeetingUrl.mockResolvedValue({ data: { valid: true, provider: "GOOGLE_MEET", providerEnabled: true } });
    api.createMeetingSession.mockResolvedValue({ data: SESSION });
    api.listMeetingSessions.mockResolvedValueOnce({ data: [] }).mockResolvedValue({ data: [SESSION] });
    render(<MeetingAssistant />);
    await screen.findByRole("button", { name: "Register meeting" });
    typeUrl("https://meet.google.com/abc-defg-hij");
    await screen.findByText(/Google Meet link/);
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Register meeting" }));
    await waitFor(() => expect(api.createMeetingSession).toHaveBeenCalledTimes(1));
    expect(api.createMeetingSession.mock.calls[0][0]).toMatchObject({
      meetingUrl: "https://meet.google.com/abc-defg-hij", projectId: "p1", scheduledFor: null, simulated: false,
    });
    expect((await screen.findAllByText("Weekly sync")).length).toBeGreaterThan(0);
  });

  it("explains a duplicate request using the server's message", async () => {
    api.validateMeetingUrl.mockResolvedValue({ data: { valid: true, provider: "GOOGLE_MEET", providerEnabled: true } });
    api.createMeetingSession.mockRejectedValue({ response: { status: 409, data: { error: "DUPLICATE_SESSION",
      message: "The assistant is already assigned to this meeting occurrence." } } });
    render(<MeetingAssistant />);
    await screen.findByRole("button", { name: "Register meeting" });
    typeUrl("https://meet.google.com/abc-defg-hij");
    await screen.findByText(/Google Meet link/);
    fireEvent.click(screen.getByRole("button", { name: "Register meeting" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already assigned");
  });

  it("offers Retry with a plain explanation after a failure, and Cancel only while in flight", async () => {
    const failed = { ...SESSION, id: "s2", title: "Failed one", status: "FAILED", statusDetail: "Simulated failure.", recoveryAction: "Use Retry to try again." };
    api.listMeetingSessions.mockResolvedValue({ data: [SESSION, failed] });
    render(<MeetingAssistant />);
    await screen.findByText("Failed one");
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    fireEvent.click(screen.getByText("Failed one"));
    expect(await screen.findByText(/Use Retry to try again/)).toBeInTheDocument();
  });

  it("results tabs are keyboard-operable and never invent content", async () => {
    api.listMeetingSessions.mockResolvedValue({ data: [SESSION] });
    render(<MeetingAssistant />);
    fireEvent.click(await screen.findByText("Weekly sync"));
    await screen.findByRole("tablist", { name: "Meeting results" });
    expect(screen.getAllByRole("tab")).toHaveLength(6);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Summary" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "MOM" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByRole("tabpanel")).toHaveTextContent("No transcript has been collected"));
  });

  // ── Transcripts ──────────────────────────────────────────────────────────
  const openSession = async (session) => {
    api.listMeetingSessions.mockResolvedValue({ data: [session] });
    render(<MeetingAssistant />);
    fireEvent.click(await screen.findByText(session.title));
  };

  it("adds a pasted transcript, auto-detecting the format, and tells the person what happened", async () => {
    api.addMeetingTranscript.mockResolvedValue({ data: { ...SESSION, status: "TRANSCRIPT_RECEIVED", segmentCount: 2, warnings: ["No speaker names were found; speakers are shown as unknown."] } });
    await openSession(SESSION);
    const send = await screen.findByRole("button", { name: "Add transcript" });
    expect(send).toBeDisabled();                                             // nothing to send yet
    fireEvent.change(screen.getByLabelText("Or paste the transcript"), { target: { value: "hello team\nsecond line" } });
    fireEvent.click(screen.getByRole("button", { name: "Add transcript" }));
    await waitFor(() => expect(api.addMeetingTranscript).toHaveBeenCalledWith("s1", { content: "hello team\nsecond line", format: null }));
    expect(await screen.findByRole("status")).toHaveTextContent("speakers are shown as unknown");
  });

  it("reads a chosen .vtt file into the box without sending it yet", async () => {
    await openSession(SESSION);
    const file = new File(["WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi"], "meeting.vtt", { type: "text/vtt" });
    fireEvent.change(await screen.findByLabelText("Transcript file"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByLabelText("Or paste the transcript")).toHaveValue("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi"));
    expect(api.addMeetingTranscript).not.toHaveBeenCalled();
  });

  it("refuses an oversized file up front with a plain message", async () => {
    await openSession(SESSION);
    const big = new File(["x"], "huge.txt", { type: "text/plain" });
    Object.defineProperty(big, "size", { value: 6_000_000 });
    fireEvent.change(await screen.findByLabelText("Transcript file"), { target: { files: [big] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("larger than 5 MB");
    expect(screen.getByLabelText("Or paste the transcript")).toHaveValue("");
  });

  it("shows the server's reason when a transcript is rejected", async () => {
    api.addMeetingTranscript.mockRejectedValue({ response: { status: 400, data: { error: "NO_SEGMENTS", message: "No spoken text could be found in that file." } } });
    await openSession(SESSION);
    fireEvent.change(await screen.findByLabelText("Or paste the transcript"), { target: { value: "WEBVTT" } });
    fireEvent.click(screen.getByRole("button", { name: "Add transcript" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No spoken text");
  });

  it("does not offer to add a transcript to a finished meeting, or to someone else's meeting", async () => {
    await openSession({ ...SESSION, status: "COMPLETED" });
    await screen.findByRole("tablist", { name: "Meeting results" });
    expect(screen.queryByRole("form", { name: /transcript/i })).toBeNull();
    cleanup();
    await openSession({ ...SESSION, canManage: false });
    await screen.findByRole("tablist", { name: "Meeting results" });
    expect(screen.queryByRole("form", { name: /transcript/i })).toBeNull();
  });

  it("the Transcript tab shows each line with its speaker, and unknown speakers as unknown", async () => {
    api.getMeetingTranscript.mockResolvedValue({ data: { total: 2, nextAfter: null, captureStatus: "UPLOADED",
      note: "Uploaded by me@x.com. Whether it covers the whole meeting can't be verified.",
      segments: [{ seq: 1, startMs: 83000, speaker: "Priya Nair", text: "I will send the budget." }, { seq: 2, startMs: null, speaker: null, text: "Sounds good." }] } });
    await openSession({ ...SESSION, status: "TRANSCRIPT_RECEIVED", segmentCount: 2 });
    fireEvent.click(await screen.findByRole("tab", { name: "Transcript" }));
    expect(await screen.findByText("Priya Nair")).toBeInTheDocument();
    expect(screen.getByText("01:23")).toBeInTheDocument();
    expect(screen.getByText("Unknown speaker")).toBeInTheDocument();
    expect(screen.getByText(/can't be verified/)).toBeInTheDocument();
  });

  it("flags a partial import clearly", async () => {
    api.getMeetingTranscript.mockResolvedValue({ data: { total: 1, nextAfter: null, captureStatus: "PARTIAL",
      note: "Transcription covered about 58% of the meeting. It started 25 min after the meeting began.",
      segments: [{ seq: 1, startMs: 1000, speaker: "Tom", text: "hi" }] } });
    await openSession({ ...SESSION, status: "TRANSCRIPT_RECEIVED", segmentCount: 1 });
    fireEvent.click(await screen.findByRole("tab", { name: "Transcript" }));
    expect(await screen.findByText(/may be incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/58%/)).toBeInTheDocument();
  });

  it("loads more lines when the transcript is long", async () => {
    api.getMeetingTranscript
      .mockResolvedValueOnce({ data: { total: 2, nextAfter: 1, captureStatus: "UPLOADED", note: "n", segments: [{ seq: 1, startMs: 0, speaker: "A", text: "first" }] } })
      .mockResolvedValueOnce({ data: { total: 2, nextAfter: null, captureStatus: "UPLOADED", note: "n", segments: [{ seq: 2, startMs: 1000, speaker: "A", text: "second" }] } });
    await openSession({ ...SESSION, status: "TRANSCRIPT_RECEIVED", segmentCount: 2 });
    fireEvent.click(await screen.findByRole("tab", { name: "Transcript" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText("second")).toBeInTheDocument();
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(api.getMeetingTranscript.mock.calls[1][1]).toMatchObject({ after: 1 });
  });

  it("a meeting with a transcript offers to generate the documents when AI is ready", async () => {
    api.generateMeetingOutputs.mockResolvedValue({ data: SESSION });
    await openSession({ ...SESSION, status: "TRANSCRIPT_RECEIVED", segmentCount: 3, canGenerate: true });
    fireEvent.click(await screen.findByRole("tab", { name: "MOM" }));
    fireEvent.click(await screen.findByRole("button", { name: "Generate summary, minutes and notes" }));
    await waitFor(() => expect(api.generateMeetingOutputs).toHaveBeenCalledWith("s1"));
  });

  it("explains why nothing is generated when AI isn't ready, instead of offering a button that can't work", async () => {
    api.getAssistantCapabilities.mockResolvedValue({ data: { ...CAPS, aiReady: false, aiReason: "AI isn't turned on. An admin can enable it under AI Settings." } });
    await openSession({ ...SESSION, status: "TRANSCRIPT_RECEIVED", segmentCount: 3, canGenerate: true });
    fireEvent.click(await screen.findByRole("tab", { name: "Summary" }));
    expect(await screen.findByText(/isn't turned on/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate summary, minutes and notes" })).toBeNull();
  });

  it("shows progress while the documents are being generated", async () => {
    await openSession({ ...SESSION, status: "PROCESSING", segmentCount: 3 });
    fireEvent.click(await screen.findByRole("tab", { name: "Summary" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Generating/);
  });

  it("offers Regenerate once documents exist, and warns that replacing the transcript makes them stale", async () => {
    api.generateMeetingOutputs.mockResolvedValue({ data: SESSION });
    await openSession({ ...SESSION, status: "READY_FOR_REVIEW", segmentCount: 3, canGenerate: true });
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(api.generateMeetingOutputs).toHaveBeenCalledWith("s1"));
    expect(screen.getByText(/out of date/)).toBeInTheDocument();
  });

  it("the Actions tab offers to extract actions, and the Projects and Tasks tab says nothing is created yet", async () => {
    api.extractMeetingActions.mockResolvedValue({ data: SESSION });
    await openSession({ ...SESSION, status: "READY_FOR_REVIEW", segmentCount: 3, canExtract: true, canManage: true });
    fireEvent.click(await screen.findByRole("tab", { name: "Actions" }));
    fireEvent.click(await screen.findByRole("button", { name: "Extract actions" }));
    await waitFor(() => expect(api.extractMeetingActions).toHaveBeenCalledWith("s1"));
    fireEvent.click(screen.getByRole("tab", { name: "Projects and Tasks" }));
    expect(await screen.findByText(/Nothing is created until you press Create/)).toBeInTheDocument();
  });

  // ── Google ───────────────────────────────────────────────────────────────
  it("prompts people to connect Google only when it is set up, enabled, and they haven't connected", async () => {
    api.getAssistantCapabilities.mockResolvedValue({ data: { ...CAPS, googleConfigured: true } });
    render(<MeetingAssistant />);
    expect(await screen.findByText(/Connect your Google account to import/)).toBeInTheDocument();
    cleanup();
    api.getAssistantCapabilities.mockResolvedValue({ data: { ...CAPS, googleConfigured: true,
      platforms: [{ ...CAPS.platforms[0], connectedForMe: true }] } });
    render(<MeetingAssistant />);
    await screen.findByRole("button", { name: "Register meeting" });
    expect(screen.queryByText(/Connect your Google account to import/)).toBeNull();
  });

  it("'Check Google Meet now' appears only for a connected person on a waiting Google meeting", async () => {
    api.getAssistantCapabilities.mockResolvedValue({ data: { ...CAPS, googleConfigured: true,
      platforms: [{ ...CAPS.platforms[0], connectedForMe: true }] } });
    api.fetchMeetingTranscriptNow.mockResolvedValue({ data: SESSION });
    await openSession(SESSION);
    fireEvent.click(await screen.findByRole("button", { name: "Check Google Meet now" }));
    await waitFor(() => expect(api.fetchMeetingTranscriptNow).toHaveBeenCalledWith("s1"));
    cleanup();
    api.getAssistantCapabilities.mockResolvedValue({ data: CAPS });          // not connected
    await openSession(SESSION);
    await screen.findByRole("tablist", { name: "Meeting results" });
    expect(screen.queryByRole("button", { name: "Check Google Meet now" })).toBeNull();
  });

  it("a link written into a created task (?session=<id>) opens that meeting straight away", async () => {
    window.history.pushState({}, "", "/meeting-assistant?session=s1");
    try {
      api.listMeetingSessions.mockResolvedValue({ data: [SESSION] });
      render(<MeetingAssistant />);
      expect(await screen.findByRole("region", { name: "Details for Weekly sync" })).toBeInTheDocument();
    } finally {
      window.history.pushState({}, "", "/");
    }
  });

  it("has no automatically detectable accessibility violations", async () => {
    api.listMeetingSessions.mockResolvedValue({ data: [SESSION] });
    const { container } = render(<MeetingAssistant />);
    await screen.findByText("Weekly sync");
    expect(await axe(container)).toHaveNoViolations();
  });
});
