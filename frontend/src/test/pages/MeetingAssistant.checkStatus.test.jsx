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


const GOOGLE_CAPS = { ...CAPS, platforms: [{ ...CAPS.platforms[0], connectedForMe: true, automaticTranscript: true }], googleConfigured: true };
const WAITING = { ...SESSION, statusDetail: "Waiting for the meeting to finish. Prowosma will import the transcript from Google Meet if transcription was turned on." };
const CHECK = (code, message, over = {}) => ({ at: new Date(Date.now() - 2 * 60000).toISOString(), code, message, facts: { connectedAccount: "me@x.com", accountType: "WORKSPACE_OR_OTHER", recordsReturned: 0 }, ...over });

const openSession = async (session, caps = GOOGLE_CAPS) => {
  api.getAssistantCapabilities.mockResolvedValue({ data: caps });
  api.listMeetingSessions.mockResolvedValue({ data: [session] });
  render(<MeetingAssistant />);
  fireEvent.click(await screen.findByText(session.title));
};
const DETAIL_GUIDE = "How to turn on a transcript in Google Meet (step by step)";
const FORM_GUIDE = "Before you start your meeting: how to turn on a transcript in Google Meet";
const guideOf = () => screen.getByText(DETAIL_GUIDE).closest("details");

describe("A waiting meeting says what the platform actually answered", () => {
  it("shows the last check's message instead of only repeating the registration text", async () => {
    await openSession({ ...WAITING, lastCheck: CHECK("NO_CONFERENCE_YET", "Google has no record of this meeting under the connected Google account (me@x.com) yet.") });
    const panel = await screen.findByRole("heading", { name: "What Prowosma found at Google Meet" });
    expect(panel.closest(".ma-check")).toHaveTextContent("Google has no record of this meeting");
    expect(screen.getAllByText(/Waiting for the meeting to finish/).length).toBeGreaterThan(0);   // the old line is still there — but no longer the only thing
  });

  it("says plainly when no check has run yet", async () => {
    await openSession(WAITING);
    expect(await screen.findByText(/hasn.t looked yet/)).toBeInTheDocument();
  });

  it("opens the how-to guide by itself when Google says there is no transcript, and keeps it folded otherwise", async () => {
    await openSession({ ...WAITING, lastCheck: CHECK("NO_TRANSCRIPT_YET", "The meeting ended 8 minutes ago, but Google has no transcript for it.") });
    await screen.findByRole("heading", { name: "What Prowosma found at Google Meet" });
    expect(guideOf()).toHaveAttribute("open");
    cleanup();
    await openSession({ ...WAITING, lastCheck: CHECK("MEETING_IN_PROGRESS", "Google still shows this meeting as running.") });
    await screen.findByRole("heading", { name: "What Prowosma found at Google Meet" });
    expect(guideOf()).not.toHaveAttribute("open");
  });

  it("shows the guide, open, for a Google meeting that failed because no transcript existed", async () => {
    await openSession({ ...SESSION, status: "FAILED", statusDetail: "Google Meet has no transcript for this meeting.", recoveryAction: "Upload or paste the transcript instead." });
    expect(await screen.findByText("What you can do:")).toBeInTheDocument();
    expect(guideOf()).toHaveAttribute("open");
  });

  it("shows the check panel for Teams too, but no Google guide on the meeting", async () => {
    await openSession({ ...WAITING, provider: "MS_TEAMS", title: "Teams sync", lastCheck: CHECK("NO_TRANSCRIPT_YET", "Microsoft has no transcript for this meeting yet.") });
    expect(await screen.findByRole("heading", { name: "What Prowosma found at Microsoft Teams" })).toBeInTheDocument();
    expect(screen.queryByText(DETAIL_GUIDE)).toBeNull();
  });

  it("shows neither for a meeting that isn't waiting or is simulated", async () => {
    await openSession({ ...SESSION, status: "READY_FOR_REVIEW", segmentCount: 3 });
    await screen.findByRole("tablist", { name: "Meeting results" });
    expect(screen.queryByRole("heading", { name: /What Prowosma found/ })).toBeNull();
    expect(screen.queryByText(DETAIL_GUIDE)).toBeNull();
    cleanup();
    await openSession({ ...WAITING, simulated: true });
    await screen.findByRole("region", { name: "Details for Weekly sync" });
    expect(screen.queryByRole("heading", { name: /What Prowosma found/ })).toBeNull();
  });
});

describe("'Check Google Meet now'", () => {
  it("shows that it is working, then refreshes the meeting so the new answer appears", async () => {
    let finish;
    api.fetchMeetingTranscriptNow.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await openSession({ ...WAITING, lastCheck: CHECK("NO_CONFERENCE_YET", "Google has no record of this meeting yet.") });
    const button = await screen.findByRole("button", { name: "Check Google Meet now" });
    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "Checking Google…" })).toBeDisabled();
    const callsBefore = api.listMeetingSessions.mock.calls.length;
    api.listMeetingSessions.mockResolvedValue({ data: [{ ...WAITING, lastCheck: CHECK("MEETING_IN_PROGRESS", "Google still shows this meeting as running (it started 25 minutes ago).") }] });
    finish({ data: {} });
    const panel = (await screen.findByRole("heading", { name: "What Prowosma found at Google Meet" })).closest(".ma-check");
    await waitFor(() => expect(panel).toHaveTextContent("started 25 minutes ago"));                 // the new answer, not the old one
    expect(api.fetchMeetingTranscriptNow).toHaveBeenCalledWith("s1");
    expect(api.listMeetingSessions.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(screen.getByRole("button", { name: "Check Google Meet now" })).toBeEnabled();
  });

  it("is still only offered to a connected person on a waiting Google meeting", async () => {
    await openSession(WAITING, { ...GOOGLE_CAPS, platforms: [{ ...GOOGLE_CAPS.platforms[0], connectedForMe: false }] });
    await screen.findByRole("heading", { name: "What Prowosma found at Google Meet" });
    expect(screen.queryByRole("button", { name: /Check Google Meet now/ })).toBeNull();
  });
});

describe("The guide on the registration form", () => {
  it("is there before a link is pasted, so people read it before their meeting", async () => {
    render(<MeetingAssistant />);
    fireEvent.click(await screen.findByRole("button", { name: /Register a meeting link/ }));
    await screen.findByLabelText("Meeting link");
    expect(screen.getByText(FORM_GUIDE)).toBeInTheDocument();
    expect(screen.getByText(FORM_GUIDE).closest("details")).not.toHaveAttribute("open");
  });

  it("stays for a Google Meet link and goes away for a Teams link", async () => {
    api.validateMeetingUrl.mockResolvedValue({ data: { valid: true, provider: "GOOGLE_MEET" } });
    render(<MeetingAssistant />);
    fireEvent.click(await screen.findByRole("button", { name: /Register a meeting link/ }));
    await screen.findByLabelText("Meeting link");
    typeUrl("https://meet.google.com/abc-defg-hij");
    expect(await screen.findByText(/Google Meet link/)).toBeInTheDocument();
    expect(screen.getByText(FORM_GUIDE)).toBeInTheDocument();
    api.validateMeetingUrl.mockResolvedValue({ data: { valid: true, provider: "MS_TEAMS" } });
    typeUrl("https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0");
    await waitFor(() => expect(screen.queryByText(FORM_GUIDE)).toBeNull());
  });

  it("opening it does not submit the form or change anything", async () => {
    render(<MeetingAssistant />);
    fireEvent.click(await screen.findByRole("button", { name: /Register a meeting link/ }));
    await screen.findByLabelText("Meeting link");
    fireEvent.click(screen.getByText(FORM_GUIDE));
    expect(api.createMeetingSession).not.toHaveBeenCalled();
  });
});

describe("accessibility", () => {
  it("a waiting meeting with its status panel and guide has no detectable violations", async () => {
    await openSession({ ...WAITING, lastCheck: CHECK("NO_TRANSCRIPT_YET", "The meeting ended 8 minutes ago, but Google has no transcript for it.") });
    await screen.findByRole("heading", { name: "What Prowosma found at Google Meet" });
    // scoped to the meeting's detail — the page header and shell are outside what this change touches
    expect(await axe(screen.getByRole("region", { name: "Details for Weekly sync" }))).toHaveNoViolations();
  });
});
