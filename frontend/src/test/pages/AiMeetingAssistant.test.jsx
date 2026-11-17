// SIMULATED: the API is mocked. These tests check what the page shows and sends, not the real backend
// (that is covered by the backend tests and the real end-to-end run in docs/universal-meeting-assistant).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const toastShow = vi.fn();
vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: toastShow }) }));
vi.mock("../../hooks/useConfirm", () => ({ useConfirm: () => () => Promise.resolve(true) }));
vi.mock("../../api/team", () => ({ getTeamMembers: () => Promise.resolve({ data: [{ id: "m1", name: "Ravi Kumar", role: "MEMBER" }, { id: "m2", name: "Jordan Lee", role: "MEMBER" }] }) }));
vi.mock("../../api/projects", () => ({ getProjects: () => Promise.resolve({ data: [{ id: "p1", name: "Website relaunch" }] }) }));

const api = vi.hoisted(() => ({
  getUmaDashboard: vi.fn(), getUmaMeeting: vi.fn(), getUmaProviders: vi.fn(), uploadUmaRecording: vi.fn(),
  approveUmaAction: vi.fn(), editUmaAction: vi.fn(), askUma: vi.fn(), retryUmaMeeting: vi.fn(),
}));
vi.mock("../../api/aiMeetingAssistant", () => ({
  ...Object.fromEntries(["detectUmaLink", "addUmaRecording", "importUmaTranscriptText", "importUmaTranscriptFile", "registerUmaLink",
    "regenerateUmaMeeting", "cancelUmaMeeting", "completeUmaMeeting", "deleteUmaMeeting", "shareUmaMeeting", "editUmaSegment",
    "rejectUmaAction", "approveUmaActions", "exportUma"].map((k) => [k, vi.fn()])),
  ...api,
}));

import AiMeetingAssistant from "../../pages/AiMeetingAssistant";

const ready = { enabled: true, transcriptionReady: true, aiReady: true, maxUploadMb: 500 };
const dash = (over = {}) => ({ data: { upcoming: [], inProgress: [], awaitingReview: [], failed: [], recent: [], pendingActions: [], readiness: ready, canCreate: true, ...over } });

const meeting = (over = {}) => ({
  data: {
    meeting: { id: "x1", title: "Weekly sync", status: "REVIEW_READY", statusDetail: "Your meeting summary is ready. 1 action item to review.",
      source: "RECORDING_UPLOAD", meetingAt: "2026-11-16T09:00:00Z", transcript: { segmentCount: 2, speakersKnown: false } },
    statusLabel: "Ready for review", canManage: true,
    segments: [
      { seq: 1, startMs: 0, text: "Good morning everyone." },
      { seq: 2, startMs: 26000, text: "Ravi will complete the authentication API by Friday." },
    ],
    questions: [],
    insights: {
      summary: "The team agreed the launch plan.", version: 1, model: "test-model", droppedForMissingEvidence: 1, warnings: [],
      notes: [], risks: [], questions: [], followUps: [],
      decisions: [{ id: "d1", text: "Launch on 20 November", evidence: [2] }],
      actions: [{ id: "a1", title: "Complete the authentication API", status: "PENDING", ownerSpoken: "Ravi", ownerState: "SUGGESTED",
        ownerMemberId: null, ownerCandidates: [{ memberId: "m1", name: "Ravi Kumar" }], dueSpoken: "by Friday", dueDate: "2026-11-20",
        priority: "HIGH", confidence: "HIGH", evidence: [2] }],
    },
    ...over,
  },
});

const at = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/ai-meeting-assistant" element={<AiMeetingAssistant />} />
      <Route path="/ai-meeting-assistant/:id" element={<AiMeetingAssistant />} />
    </Routes>
  </MemoryRouter>,
);

describe("AI Meeting Assistant (simulated API)", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    toastShow.mockReset();
    api.getUmaProviders.mockResolvedValue({ data: [] });
    api.getUmaDashboard.mockResolvedValue(dash());
  });

  it("starts with a clear empty state and the three ways in", async () => {
    api.getUmaDashboard.mockResolvedValue(dash());
    at("/ai-meeting-assistant");
    expect(await screen.findByText("Turn a meeting into notes and tasks")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Upload recording/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Import transcript/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Add meeting link/ })).toBeInTheDocument();
  });

  it("says plainly what setup is missing", async () => {
    api.getUmaDashboard.mockResolvedValue(dash({ readiness: { ...ready, transcriptionReady: false, transcriptionReason: "No speech-to-text server is set up." } }));
    at("/ai-meeting-assistant");
    expect(await screen.findByText("No speech-to-text server is set up.")).toBeInTheDocument();
    expect(screen.getByText("Imported transcripts work already.")).toBeInTheDocument();
  });

  it("won't upload until consent is confirmed", async () => {
    api.getUmaDashboard.mockResolvedValue(dash());
    at("/ai-meeting-assistant");
    fireEvent.click((await screen.findAllByRole("button", { name: /Upload recording/ }))[0]);
    const dialog = screen.getByRole("dialog", { name: "Upload a recording" });
    const file = new File(["abc"], "sync.mp3", { type: "audio/mpeg" });
    fireEvent.change(dialog.querySelector('input[type="file"]'), { target: { files: [file] } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Upload$/ }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("confirm");
    expect(api.uploadUmaRecording).not.toHaveBeenCalled();

    api.uploadUmaRecording.mockResolvedValue({ data: { id: "x1" } });
    api.getUmaMeeting.mockResolvedValue(meeting());
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Upload$/ }));
    await waitFor(() => expect(api.uploadUmaRecording).toHaveBeenCalled());
    expect(api.uploadUmaRecording.mock.calls[0][1]).toMatchObject({ consent: true });
  });

  it("shows the summary, and a line reference opens that transcript line", async () => {
    api.getUmaMeeting.mockResolvedValue(meeting());
    at("/ai-meeting-assistant/x1");
    expect(await screen.findByText("The team agreed the launch plan.")).toBeInTheDocument();
    expect(screen.getByText(/1 statement\(s\) from the AI were left out/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Show transcript line 2" })[0]);
    expect(screen.getByRole("tab", { name: "Transcript" })).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("line-2")).toHaveClass("focus");
  });

  it("never pre-assigns a suggested owner, and creates the task only on approval", async () => {
    api.getUmaMeeting.mockResolvedValue(meeting());
    api.approveUmaAction.mockResolvedValue({ data: { id: "a1", status: "CREATED", createdTaskId: "t1" } });
    at("/ai-meeting-assistant/x1?tab=actions");
    fireEvent.click(await screen.findByRole("tab", { name: /Action items/ }));
    const owner = await screen.findByDisplayValue("Choose…");
    expect(owner).toBeInTheDocument();
    expect(screen.getByText("Probably — please confirm")).toBeInTheDocument();
    expect(screen.getByText(/said: “by Friday”/)).toBeInTheDocument();
    expect(api.approveUmaAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Create task/ }));
    await waitFor(() => expect(api.approveUmaAction).toHaveBeenCalledWith("x1", "a1"));
    expect(toastShow).toHaveBeenCalledWith("Task created.", "success");
  });

  it("explains a failure and offers Retry", async () => {
    api.getUmaMeeting.mockResolvedValue(meeting({
      meeting: { id: "x1", title: "Weekly sync", status: "FAILED", statusDetail: "The speech-to-text key was rejected.",
        recoveryHint: "An admin needs to fix the speech-to-text key, then press Retry.", recording: { fileKey: "k" }, source: "RECORDING_UPLOAD" },
      statusLabel: "Needs attention", insights: null, segments: [],
    }));
    api.retryUmaMeeting.mockResolvedValue({ data: {} });
    at("/ai-meeting-assistant/x1");
    expect(await screen.findByText("The speech-to-text key was rejected.")).toBeInTheDocument();
    expect(screen.getByText(/An admin needs to fix/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await waitFor(() => expect(api.retryUmaMeeting).toHaveBeenCalledWith("x1"));
  });

  it("shows when an answer isn't in the transcript", async () => {
    api.getUmaMeeting.mockResolvedValue(meeting({ questions: [
      { id: "q1", question: "What is the budget?", answer: "This meeting's transcript doesn't clearly answer that.", grounded: false, evidence: [] },
    ] }));
    at("/ai-meeting-assistant/x1");
    fireEvent.click(await screen.findByRole("tab", { name: "Ask AI" }));
    expect(screen.getByText("This meeting's transcript doesn't clearly answer that.")).toHaveClass("uma-a--none");
  });
});
