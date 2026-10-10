import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
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
  getAssistantSettings: vi.fn(),
  updateAssistantSettings: vi.fn(),
  testSpeechToText: vi.fn(),
  deleteRecordingAudio: vi.fn(),
  sendFirefliesNotetaker: vi.fn(),
  getFirefliesRecent: vi.fn(),
  importFirefliesTranscript: vi.fn(),
  testFireflies: vi.fn(),
  startRecording: vi.fn(),
  uploadRecordingChunk: vi.fn(),
  finishRecording: vi.fn(),
  uploadRecordingFile: vi.fn(),
}));
const { role } = vi.hoisted(() => ({ role: { isAdmin: false, isOwner: false } }));
vi.mock("../../hooks/useRole", () => ({ useRole: () => role }));
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



const FF_CAPS = (fireflies) => ({
  platforms: [{ provider: "GOOGLE_MEET", enabled: true, connectedForMe: true, automaticTranscript: true }], googleConfigured: true, aiReady: true, fireflies,
});
const BASE = { id: "s1", provider: "GOOGLE_MEET", title: "Weekly sync", status: "AWAITING_TRANSCRIPT", statusDetail: "Waiting.", canManage: true, requestedBy: "me@x.com", visibility: "PRIVATE",
  sharedWith: [], history: [], createdAt: "2026-10-07T10:00:00Z", meetingUrl: "https://meet.google.com/abc-defg-hij" };

const open = async (sessions, caps) => {
  api.getAssistantCapabilities.mockResolvedValue({ data: caps });
  api.listMeetingSessions.mockResolvedValue({ data: sessions });
  render(<MeetingAssistant />);
  await screen.findByRole("heading", { name: "Add a meeting" });
};
const openSession = async (s, caps) => { await open([s], caps); fireEvent.click((await screen.findAllByText(s.title))[0]); };

beforeEach(() => {
  vi.clearAllMocks();
  role.isAdmin = false;
  getProjects.mockResolvedValue({ data: [] }); getTeamMembers.mockResolvedValue({ data: [] });
  api.getMeetingTranscript.mockResolvedValue({ data: { segments: [] } }); api.getMeetingArtifacts.mockResolvedValue({ data: {} });
  api.getAssistantSettings.mockResolvedValue({ data: { firefliesEnabled: true, firefliesKeySaved: true, recordingEnabled: false } });
});

describe("Fireflies on the Meeting Assistant page", () => {
  it("the Fireflies card appears only when an admin has set it up; an older server that doesn't know about it changes nothing", async () => {
    await open([], FF_CAPS({ ready: true, enabled: true }));
    expect(screen.getByRole("region", { name: "Fireflies notetaker" })).toBeInTheDocument();
    cleanup();
    await open([], FF_CAPS({ ready: false, enabled: false, reason: "The Fireflies integration isn't turned on for this workspace." }));
    expect(screen.queryByRole("region", { name: "Fireflies notetaker" })).toBeNull();
    cleanup();
    await open([], FF_CAPS(undefined));
    expect(screen.queryByRole("region", { name: "Fireflies notetaker" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Add a meeting" })).toBeInTheDocument();
  });

  it("only admins see the Fireflies settings", async () => {
    await open([], FF_CAPS({ ready: true, enabled: true }));
    expect(screen.queryByText(/Fireflies notetaker \(admins\)|\(admins\) — /)).toBeNull();
    cleanup();
    role.isAdmin = true;
    await open([], FF_CAPS({ ready: false, enabled: false, reason: "No Fireflies API key is saved yet." }));
    expect(await screen.findByLabelText(/Fireflies API key/)).toBeInTheDocument();
  });

  it("saving the admin settings refreshes what the page knows, so the card appears straight away", async () => {
    role.isAdmin = true;
    api.updateAssistantSettings.mockResolvedValue({ data: { firefliesEnabled: true, firefliesKeySaved: true } });
    await open([], FF_CAPS({ ready: false, enabled: false, reason: "No Fireflies API key is saved yet." }));
    expect(screen.queryByRole("region", { name: "Fireflies notetaker" })).toBeNull();
    api.getAssistantCapabilities.mockResolvedValue({ data: FF_CAPS({ ready: true, enabled: true }) });
    const buttons = await screen.findAllByRole("button", { name: "Save" });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByRole("region", { name: "Fireflies notetaker" })).toBeInTheDocument();
  });

  it("a meeting with a notetaker shows 'What Prowosma found at Fireflies' and what Fireflies is doing", async () => {
    await openSession({ ...BASE, provider: "FIREFLIES", platform: "ZOOM", fireflies: { state: "SENT", platformName: "Zoom", sentAt: "2026-10-08T10:15:00Z" },
      lastCheck: { at: new Date().toISOString(), code: "FIREFLIES_WAITING", message: "Fireflies has no transcript for this meeting yet.", facts: { recentMeetingsChecked: 25, fromThisLink: 0 } } }, FF_CAPS({ ready: true }));
    const panel = (await screen.findByRole("heading", { name: "What Prowosma found at Fireflies" })).closest(".ma-check");
    expect(panel).toHaveTextContent("Fireflies has no transcript for this meeting yet.");
    expect(screen.getByLabelText("Fireflies")).toHaveTextContent("The notetaker was sent to your Zoom meeting");
    expect(screen.queryByText("How to turn on a transcript in Google Meet (step by step)")).toBeNull();
  });

  it("a waiting Google Meet meeting offers to send a notetaker, right next to the Google guidance — a way out when the account has no transcripts", async () => {
    await openSession(BASE, FF_CAPS({ ready: true }));
    expect(await screen.findByText("No transcript? Send a Fireflies notetaker to this meeting")).toBeInTheDocument();
    expect(screen.getByText("How to turn on a transcript in Google Meet (step by step)")).toBeInTheDocument();         // existing guidance is untouched
  });

  it("without Fireflies, a Google Meet meeting looks exactly as before", async () => {
    await openSession(BASE, FF_CAPS({ ready: false }));
    await screen.findByRole("heading", { name: "What Prowosma found at Google Meet" });
    expect(screen.queryByText(/Send a Fireflies notetaker/)).toBeNull();
    expect(screen.queryByLabelText("Fireflies")).toBeNull();
    expect(screen.getByRole("button", { name: "Check Google Meet now" })).toBeInTheDocument();
  });

  it("sending the notetaker from a meeting calls the server for THAT meeting", async () => {
    api.sendFirefliesNotetaker.mockResolvedValue({ data: {} });
    await openSession(BASE, FF_CAPS({ ready: true }));
    const box = (await screen.findByText("No transcript? Send a Fireflies notetaker to this meeting")).closest("details");   // the card at the top has its own button
    fireEvent.click(within(box).getByLabelText(/Everyone in the meeting knows a Fireflies notetaker/));
    fireEvent.click(within(box).getByRole("button", { name: "Send notetaker" }));
    await waitFor(() => expect(api.sendFirefliesNotetaker).toHaveBeenCalledWith({ sessionId: "s1", consent: true }));
  });
});
