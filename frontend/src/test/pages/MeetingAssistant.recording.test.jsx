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



const REC_CAPS = { ready: true, enabled: true, segmentSeconds: 180, retentionHours: 24, maxUploadBytes: 25_000_000, reason: null };
const CAPS_WITH = (recording) => ({ ...CAPS, platforms: [{ ...CAPS.platforms[0], connectedForMe: true, automaticTranscript: true }], googleConfigured: true, recording });
const WAITING = { ...SESSION, statusDetail: "Waiting for the meeting to finish." };
const RECORDED = { ...SESSION, id: "r1", title: "Quick call", provider: "RECORDING", meetingUrl: null, status: "AWAITING_TRANSCRIPT", statusDetail: "Waiting for the recording.",
  recording: { state: "TRANSCRIBING", audioExpiresAt: "2099-01-01T12:00:00Z", audioDeletedAt: null },
  lastCheck: { at: new Date().toISOString(), code: "RECORDING_PROGRESS", message: "Turning your recording into text: 2 of 5 parts done.", facts: { partsDone: 2, partsTotal: 5 } } };

const open = async (sessions, caps) => {
  api.getAssistantCapabilities.mockResolvedValue({ data: caps });
  api.listMeetingSessions.mockResolvedValue({ data: sessions });
  render(<MeetingAssistant />);
  await screen.findByRole("heading", { name: "Add a meeting" });
};
const openSession = async (session, caps) => { await open([session], caps); fireEvent.click((await screen.findAllByText(session.title))[0]); };

beforeEach(() => {
  role.isAdmin = false; role.isOwner = false;
  api.getAssistantSettings.mockResolvedValue({ data: { recordingEnabled: true, sttBaseUrl: "https://stt.example.com", sttKeySaved: true, sttModel: "whisper-1", audioRetentionHours: 24 } });
});

describe("Recording on the Meeting Assistant page", () => {
  it("the record card appears only when an admin has turned recording on and set up speech-to-text", async () => {
    await open([], CAPS_WITH(REC_CAPS));
    fireEvent.click(await screen.findByRole("button", { name: /Record in your browser/ }));                // one way at a time: choose it
    expect(screen.getByRole("region", { name: "Record a meeting" })).toBeInTheDocument();
    cleanup();
    await open([], CAPS_WITH({ ...REC_CAPS, ready: false, reason: "Recording isn't turned on for this workspace." }));
    expect(screen.queryByRole("region", { name: "Record a meeting" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Record in your browser/ })).toBeNull();      // not even offered
    cleanup();
    await open([], CAPS_WITH(undefined));                                                   // an older server that doesn't know about recording
    expect(screen.queryByRole("region", { name: "Record a meeting" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Add a meeting" })).toBeInTheDocument();      // everything else is exactly as before
  });

  it("only admins see the settings card", async () => {
    await open([], CAPS_WITH(REC_CAPS));
    expect(screen.queryByText(/Recording & speech-to-text/)).toBeNull();
    cleanup();
    role.isAdmin = true;
    await open([], CAPS_WITH({ ...REC_CAPS, ready: false, reason: "No speech-to-text server is set up yet." }));
    expect(await screen.findByText(/Recording & speech-to-text/)).toBeInTheDocument();
    expect(await screen.findByLabelText(/Speech-to-text server address/)).toHaveValue("https://stt.example.com");
  });

  it("saving the admin settings refreshes what the page knows, so people can record straight away", async () => {
    role.isAdmin = true;
    api.updateAssistantSettings.mockResolvedValue({ data: { recordingEnabled: true, sttBaseUrl: "https://stt.example.com", sttKeySaved: true, audioRetentionHours: 24 } });
    await open([], CAPS_WITH({ ...REC_CAPS, ready: false, reason: "Recording isn't turned on." }));
    expect(screen.queryByRole("region", { name: "Record a meeting" })).toBeNull();
    api.getAssistantCapabilities.mockResolvedValue({ data: CAPS_WITH(REC_CAPS) });          // the server now says it is ready
    const card = (await screen.findByText(/Recording & speech-to-text/)).closest("details");        // the page now has more than one admin card, each with its own Save
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: /Record in your browser/ }));                // the way to record is offered at once
    expect(await screen.findByRole("region", { name: "Record a meeting" })).toBeInTheDocument();
  });

  it("a recorded meeting shows its progress in words, its platform as 'Recording', how long the audio is kept — and no Google guidance", async () => {
    await openSession(RECORDED, CAPS_WITH(REC_CAPS));
    const panel = (await screen.findByRole("heading", { name: "Recording progress" })).closest(".ma-check");
    expect(panel).toHaveTextContent("2 of 5 parts done");
    expect(screen.getAllByText(/Recording ·/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Recording")).toHaveTextContent("Turning the recording into text…");
    expect(screen.getByText(/stored encrypted until/)).toBeInTheDocument();
    expect(screen.queryByText("How to turn on a transcript in Google Meet (step by step)")).toBeNull();
    expect(screen.queryByRole("button", { name: /Check Google Meet now/ })).toBeNull();
  });

  it("deleting the audio from the meeting calls the server for that meeting", async () => {
    api.deleteRecordingAudio.mockResolvedValue({ data: {} });
    await openSession(RECORDED, CAPS_WITH(REC_CAPS));
    fireEvent.click(await screen.findByRole("button", { name: "Delete audio now" }));
    // no confirm provider in this test, so the page's default (decline) applies — nothing is deleted without an explicit yes
    await new Promise((r) => setTimeout(r, 30));
    expect(api.deleteRecordingAudio).not.toHaveBeenCalled();
  });

  it("a waiting Google meeting offers 'upload a recording' only when recording is ready, and only to people who manage it", async () => {
    await openSession(WAITING, CAPS_WITH(REC_CAPS));
    expect(await screen.findByText("Have a recording of this meeting? Upload it")).toBeInTheDocument();
    cleanup();
    await openSession(WAITING, CAPS_WITH({ ...REC_CAPS, ready: false }));
    await screen.findByRole("heading", { name: "What Prowosma found at Google Meet" });
    expect(screen.queryByText("Have a recording of this meeting? Upload it")).toBeNull();
    cleanup();
    await openSession({ ...WAITING, canManage: false }, CAPS_WITH(REC_CAPS));
    await screen.findByRole("heading", { name: "What Prowosma found at Google Meet" });
    expect(screen.queryByText("Have a recording of this meeting? Upload it")).toBeNull();
  });

  it("…and not once a recording is already on its way for that meeting", async () => {
    await openSession({ ...WAITING, recording: { state: "UPLOADED", audioExpiresAt: "2099-01-01T12:00:00Z" } }, CAPS_WITH(REC_CAPS));
    await screen.findByLabelText("Recording");
    expect(screen.queryByText("Have a recording of this meeting? Upload it")).toBeNull();
  });

  it("a Google Meet meeting WITHOUT any recording looks exactly as it did before: the Google guide and Check button are still there", async () => {
    await openSession(WAITING, CAPS_WITH(REC_CAPS));
    expect(await screen.findByText("How to turn on a transcript in Google Meet (step by step)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check Google Meet now" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Recording")).toBeNull();
  });

  it("the whole page, with the record card, has no accessibility violations in the parts this change added", async () => {
    await open([], CAPS_WITH(REC_CAPS));
    fireEvent.click(await screen.findByRole("button", { name: /Record in your browser/ }));
    expect(await axe(screen.getByRole("region", { name: "Record a meeting" }))).toHaveNoViolations();
  });
});
