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
  getUmaFireflies: vi.fn(), sendUmaNotetaker: vi.fn(), fetchUmaGoogle: vi.fn(),
  getUmaGoogle: vi.fn(), checkUmaMeeting: vi.fn(), startUmaInstantMeeting: vi.fn(), detectUmaLink: vi.fn(), registerUmaLink: vi.fn(), scheduleUmaMeeting: vi.fn(), setUmaAutoFireflies: vi.fn(),
  getUmaMicrosoft: vi.fn(), getUmaAutomationSettings: vi.fn(), saveUmaMyPreferences: vi.fn(), saveUmaWorkspaceAutomation: vi.fn(), decideUmaProject: vi.fn(),
}));
vi.mock("../../api/aiMeetingAssistant", () => ({
  ...Object.fromEntries(["addUmaRecording", "importUmaTranscriptText", "importUmaTranscriptFile", "completeUmaGoogle", "setUmaGooglePrefs", "syncUmaCalendar",
    "regenerateUmaMeeting", "cancelUmaMeeting", "completeUmaMeeting", "deleteUmaMeeting", "shareUmaMeeting", "editUmaSegment",
    "rejectUmaAction", "approveUmaActions", "exportUma", "getUmaFirefliesRecent", "importUmaFireflies",
    "startUmaCapture", "uploadUmaPiece", "finishUmaCapture", "saveUmaFirefliesKey", "removeUmaFireflies", "getUmaGoogle",
    "authorizeUmaGoogle", "disconnectUmaGoogle"].map((k) => [k, vi.fn()])),
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
    api.getUmaFireflies.mockResolvedValue({ data: { connected: false } });
    api.getUmaGoogle.mockResolvedValue({ data: { connected: false, configured: true } });
    api.getUmaMicrosoft.mockResolvedValue({ data: { connected: false, configured: true } });
    api.getUmaAutomationSettings.mockResolvedValue({ data: { mine: { defaultPlatform: "GOOGLE_MEET", autoTasks: true },
      workspace: { autoCreateTasks: true, autoAssign: true, autoCreateProjects: true, maxAutoTasksPerMeeting: 25 }, canChangeWorkspace: true } });
  });

  it("explains honestly how a linked meeting gets captured, and offers Fireflies at the start time", async () => {
    api.getUmaFireflies.mockResolvedValue({ data: { connected: true } });
    api.getUmaGoogle.mockResolvedValue({ data: { connected: true, calendar: true, account: "me@acme.test" } });
    api.detectUmaLink.mockResolvedValue({ data: { provider: "GOOGLE_MEET", name: "Google Meet", url: "https://meet.google.com/ftz-epuc-hxb" } });
    api.registerUmaLink.mockResolvedValue({ data: { id: "x1" } });
    api.getUmaMeeting.mockResolvedValue(meeting());
    at("/ai-meeting-assistant");
    fireEvent.click(await screen.findByRole("button", { name: /Add/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add meeting link" }));
    const dialog = screen.getByRole("dialog", { name: "Add a meeting link" });
    fireEvent.change(within(dialog).getByLabelText("Meeting link"), { target: { value: "https://meet.google.com/ftz-epuc-hxb" } });
    expect(await within(dialog).findByText(/Fireflies' notetaker can join it automatically when it starts/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Google Meet's own transcript is read after it ends/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/can't join this meeting/)).not.toBeInTheDocument();
    const when = within(dialog).getByLabelText("When it happened");
    fireEvent.change(when, { target: { value: "2099-01-01T10:00" } });
    expect(within(dialog).getByLabelText(/Send the Fireflies notetaker automatically/)).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: /Add meeting/ }));
    await waitFor(() => expect(api.registerUmaLink).toHaveBeenCalled());
    expect(api.registerUmaLink.mock.calls[0][0]).toMatchObject({ autoFireflies: true, durationMinutes: 60 });
  });

  it("schedules a Google Meet with invitations and the Fireflies choice", async () => {
    api.getUmaFireflies.mockResolvedValue({ data: { connected: true } });
    api.getUmaGoogle.mockResolvedValue({ data: { connected: true, calendar: true, account: "me@acme.test" } });
    api.scheduleUmaMeeting.mockResolvedValue({ data: { id: "x1" } });
    api.getUmaMeeting.mockResolvedValue(meeting());
    at("/ai-meeting-assistant");
    fireEvent.click(await screen.findByRole("button", { name: /Add/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Schedule a meeting" }));
    const dialog = await screen.findByRole("dialog", { name: "Schedule a meeting" });
    fireEvent.change(await within(dialog).findByLabelText("Title"), { target: { value: "Launch review" } });
    fireEvent.change(within(dialog).getByLabelText(/Invite/), { target: { value: "priya@acme.test, ravi@acme.test" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Create meeting/ }));
    await waitFor(() => expect(api.scheduleUmaMeeting).toHaveBeenCalled());
    expect(api.scheduleUmaMeeting.mock.calls[0][0]).toMatchObject({
      title: "Launch review", attendees: ["priya@acme.test", "ravi@acme.test"], autoFireflies: true, durationMinutes: 30 });
  });

  it("after the meeting, says it's waiting for the transcript and offers Check now", async () => {
    api.getUmaMeeting.mockResolvedValue(meeting({
      meeting: { id: "x1", title: "Test", status: "CREATED", source: "MEETING_LINK", meetingUrl: "https://meet.google.com/abc-defg-hij",
        meetingAt: "2026-11-17T13:42:00Z", meetingEndAt: "2026-11-17T14:12:00Z", autoFireflies: true,
        statusDetail: "Waiting for Fireflies' transcript - it usually arrives a few minutes after the meeting ends (checked 19:19)." },
      statusLabel: "Waiting for transcript", insights: null, segments: [],
      capture: { pending: ["FETCH_FIREFLIES"], lastCheckAt: "2026-11-17T13:49:00Z", nextCheckAt: "2099-01-01T00:00:00Z" },
    }));
    api.checkUmaMeeting.mockResolvedValue({ data: { checks: 1 } });
    at("/ai-meeting-assistant/x1");
    expect(await screen.findByText("Waiting for transcript")).toBeInTheDocument();
    expect(screen.getByText(/Last checked/)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Check now/ }));
    await waitFor(() => expect(api.checkUmaMeeting).toHaveBeenCalledWith("x1"));
  });

  describe("Meet now", () => {
    const connected = () => {
      api.getUmaFireflies.mockResolvedValue({ data: { connected: true } });
      api.getUmaGoogle.mockResolvedValue({ data: { connected: true, calendar: true, account: "me@acme.test" } });
      api.getUmaMeeting.mockResolvedValue(meeting());
    };
    const openDialog = async () => {
      at("/ai-meeting-assistant");
      fireEvent.click(await screen.findByRole("button", { name: /Meet now/ }));
      return screen.findByRole("dialog", { name: "Start a meeting now" });
    };

    it("opens a tab at the click, then points it at the new Meet", async () => {
      connected();
      const tab = { closed: false, close: vi.fn(), location: { href: "" }, document: { write: vi.fn() } };
      const open = vi.spyOn(window, "open").mockReturnValue(tab);
      api.startUmaInstantMeeting.mockResolvedValue({ data: { id: "x1", meetingUrl: "https://meet.google.com/abc-defg-hij" } });
      const dialog = await openDialog();
      fireEvent.change(await within(dialog).findByLabelText(/Invite/), { target: { value: "priya@acme.test" } });
      fireEvent.click(within(dialog).getByRole("button", { name: /Start meeting/ }));
      expect(open).toHaveBeenCalledTimes(1);                       // synchronously, inside the click
      await waitFor(() => expect(tab.location.href).toBe("https://meet.google.com/abc-defg-hij"));
      expect(api.startUmaInstantMeeting.mock.calls[0][0]).toMatchObject({ attendees: ["priya@acme.test"], autoFireflies: true, durationMinutes: 30 });
      open.mockRestore();
    });

    it("shows a Join button when the browser blocks the new tab", async () => {
      connected();
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      api.startUmaInstantMeeting.mockResolvedValue({ data: { id: "x1", meetingUrl: "https://meet.google.com/abc-defg-hij" } });
      const dialog = await openDialog();
      fireEvent.click(await within(dialog).findByRole("button", { name: /Start meeting/ }));
      const join = await screen.findByRole("link", { name: /Join the meeting/ });
      expect(join).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");
      open.mockRestore();
    });

    it("closes the empty tab and explains when the meeting can't be created", async () => {
      connected();
      const tab = { closed: false, close: vi.fn(), location: { href: "" }, document: { write: vi.fn() } };
      const open = vi.spyOn(window, "open").mockReturnValue(tab);
      api.startUmaInstantMeeting.mockRejectedValue({ response: { data: { message: "Google Calendar is busy." } } });
      const dialog = await openDialog();
      fireEvent.click(await within(dialog).findByRole("button", { name: /Start meeting/ }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("Google Calendar is busy.");
      expect(tab.close).toHaveBeenCalled();
      open.mockRestore();
    });

    it("asks to connect Google first", async () => {
      await openDialog();
      expect(await screen.findByText(/Connect your Google account first/)).toBeInTheDocument();
      expect(api.startUmaInstantMeeting).not.toHaveBeenCalled();
    });
  });

  it("asks to connect Google before scheduling", async () => {
    at("/ai-meeting-assistant");
    fireEvent.click(await screen.findByRole("button", { name: /Add/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Schedule a meeting" }));
    expect(await screen.findByText(/Connect your Google account first/)).toBeInTheDocument();
    expect(api.scheduleUmaMeeting).not.toHaveBeenCalled();
  });

  it("starts with a clear empty state and the three ways in", async () => {
    api.getUmaDashboard.mockResolvedValue(dash());
    at("/ai-meeting-assistant");
    expect(await screen.findByText("Turn a meeting into notes and tasks")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Upload recording/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Import transcript/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Record meeting/ }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Add/ }));
    expect(screen.getByRole("menuitem", { name: "Add meeting link" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Import from Fireflies" })).toBeInTheDocument();
  });

  const linkMeeting = (meetingOver, capture) => meeting({
    meeting: { id: "x1", title: "Design review", status: "CREATED", source: "MEETING_LINK", provider: "GOOGLE_MEET",
      meetingUrl: "https://meet.google.com/abc-defg-hij", calendarLink: "https://calendar.google.com/e", autoFireflies: true,
      meetingAt: "2099-01-01T10:00:00Z", meetingEndAt: "2099-01-01T10:30:00Z", ...meetingOver },
    statusLabel: "Scheduled", insights: null, segments: [], capture,
  });

  it("before the meeting: when it starts, that Fireflies joins by itself, and one Join button", async () => {
    api.getUmaFireflies.mockResolvedValue({ data: { connected: true } });
    api.getUmaMeeting.mockResolvedValue(linkMeeting({}, { phase: "SCHEDULED", pending: ["FIREFLIES_JOIN", "FETCH_GOOGLE"], firefliesJoining: true }));
    at("/ai-meeting-assistant/x1");
    expect(await screen.findByText(/^Starts /)).toBeInTheDocument();
    expect(await screen.findByText(/joins by itself when it starts/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Join/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Send it now/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Get Google Meet/ })).not.toBeInTheDocument();
  });

  it("during the meeting: says how it ends, and offers Fireflies again only if it isn't in the call", async () => {
    api.getUmaFireflies.mockResolvedValue({ data: { connected: true } });
    api.sendUmaNotetaker.mockResolvedValue({ data: {} });
    api.getUmaMeeting.mockResolvedValue(linkMeeting({ meetingAt: "2026-01-01T10:00:00Z" },
      { phase: "IN_PROGRESS", startedAt: "2026-01-01T10:01:00Z", pending: ["FETCH_FIREFLIES", "FETCH_GOOGLE"], firefliesSent: true, firefliesInMeeting: false }));
    at("/ai-meeting-assistant/x1");
    expect(await screen.findByText(/^In progress since/)).toBeInTheDocument();
    expect(screen.getByText(/End call for everyone/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /Fireflies didn't arrive\? Send it now/ }));
    await waitFor(() => expect(api.sendUmaNotetaker).toHaveBeenCalledWith("x1"));
    expect(screen.getByRole("button", { name: /Record from this browser/ })).toBeInTheDocument();
  });

  it("after the meeting: says when it ended and that the transcript is on its way, no Join button", async () => {
    api.getUmaMeeting.mockResolvedValue(linkMeeting({ meetingAt: "2026-01-01T10:00:00Z" },
      { phase: "ENDED", endedAt: "2026-01-01T10:14:00Z", liveSource: "Google Meet", pending: ["FETCH_GOOGLE"], lastCheckAt: "2026-01-01T10:15:00Z" }));
    api.checkUmaMeeting.mockResolvedValue({ data: { checks: 1 } });
    at("/ai-meeting-assistant/x1");
    expect(await screen.findByText(/^Ended at .* Getting the transcript/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Join meeting/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Record from this browser/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(api.checkUmaMeeting).toHaveBeenCalledWith("x1"));
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

  it("schedules a Teams meeting when Teams is chosen, and asks to connect Microsoft when it isn't", async () => {
    api.getUmaGoogle.mockResolvedValue({ data: { connected: true, calendar: true, account: "me@acme.test" } });
    api.getUmaMicrosoft.mockResolvedValue({ data: { connected: false, configured: true } });
    at("/ai-meeting-assistant");
    fireEvent.click(await screen.findByRole("button", { name: /Add/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Schedule a meeting" }));
    const dialog = await screen.findByRole("dialog", { name: "Schedule a meeting" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Microsoft Teams" }));
    expect(within(dialog).getByText(/Connect your Microsoft 365 account first/)).toBeInTheDocument();

    // connected: the request says Teams
    api.getUmaMicrosoft.mockResolvedValue({ data: { connected: true, canSchedule: true, account: "me@contoso.test" } });
    api.getUmaAutomationSettings.mockResolvedValue({ data: { mine: { defaultPlatform: "MS_TEAMS", autoTasks: true }, workspace: {}, canChangeWorkspace: false } });
    api.scheduleUmaMeeting.mockResolvedValue({ data: { id: "x1" } });
    api.getUmaMeeting.mockResolvedValue(meeting());
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /Add/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Schedule a meeting" }));
    const again = await screen.findByRole("dialog", { name: "Schedule a meeting" });
    expect(await within(again).findByRole("button", { name: "Microsoft Teams" })).toHaveAttribute("aria-pressed", "true");   // the person's default
    expect(within(again).getByText(/me@contoso.test's Outlook/)).toBeInTheDocument();
    fireEvent.change(within(again).getByLabelText("Title"), { target: { value: "Kickoff" } });
    fireEvent.click(within(again).getByRole("button", { name: /Create meeting/ }));
    await waitFor(() => expect(api.scheduleUmaMeeting).toHaveBeenCalled());
    expect(api.scheduleUmaMeeting.mock.calls[0][0]).toMatchObject({ title: "Kickoff", platform: "MS_TEAMS" });
    expect(toastShow).toHaveBeenCalledWith("Meeting created in Outlook.", "success");
  });

  it("shows what was done automatically, why the rest waits, and lets a suggested project be created", async () => {
    const base = meeting().data;
    api.getUmaMeeting.mockResolvedValue({ data: { ...base, insights: { ...base.insights,
      automation: { tasksCreated: 3, tasksAssigned: 3, projectsCreated: 1, projectsLinked: 0, needsReview: 1, failed: 0, tasksEnabled: true,
        notes: ["\"Develop the React frontend\" was created without a deadline: \"next Friday\" is ambiguous (probably 2026-11-27). Set it on the task."] },
      projects: [{ id: "p1", name: "Customer Portal Development", intent: "PROPOSAL", status: "PROPOSED", evidence: [2],
        reviewReason: "Suggested in the meeting, not clearly asked for. Create it if you want it." }],
      actions: [{ ...base.insights.actions[0], reviewReason: "\"Ravi\" isn't one of the people invited to this meeting. Confirm the owner.", dependsOn: "after the API specifications are finalized" }],
    } } });
    api.decideUmaProject.mockResolvedValue({ data: {} });
    at("/ai-meeting-assistant/x1");
    const report = await screen.findByRole("region", { name: "What was done automatically" });
    expect(within(report).getByText(/task.*created/)).toBeInTheDocument();
    expect(within(report).getByText(/next Friday/)).toBeInTheDocument();
    expect(within(report).getByRole("button", { name: /needs your review/ })).toBeInTheDocument();
    expect(screen.getByText(/Suggested in the meeting/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(api.decideUmaProject).toHaveBeenCalledWith("x1", "p1", "create", undefined));

    fireEvent.click(screen.getByRole("tab", { name: /Action items/ }));
    expect(await screen.findByText(/isn't one of the people invited/)).toBeInTheDocument();
    expect(screen.getByText("Depends on: after the API specifications are finalized")).toBeInTheDocument();
  });

  it("settings: people choose their meeting app and automatic tasks; workspace rules are read-only for non-admins", async () => {
    api.getUmaAutomationSettings.mockResolvedValue({ data: { mine: { defaultPlatform: "GOOGLE_MEET", autoTasks: true },
      workspace: { autoCreateTasks: true, autoAssign: true, autoCreateProjects: true, maxAutoTasksPerMeeting: 25 }, canChangeWorkspace: false } });
    api.saveUmaMyPreferences.mockResolvedValue({ data: { mine: { defaultPlatform: "MS_TEAMS", autoTasks: true },
      workspace: { autoCreateTasks: true, autoAssign: true, autoCreateProjects: true, maxAutoTasksPerMeeting: 25 }, canChangeWorkspace: false } });
    at("/ai-meeting-assistant");
    fireEvent.click(await screen.findByRole("button", { name: /Settings/ }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Microsoft Teams" }));
    await waitFor(() => expect(api.saveUmaMyPreferences).toHaveBeenCalledWith({ defaultPlatform: "MS_TEAMS" }));
    expect(within(dialog).getByRole("checkbox", { name: /Create a project when someone clearly asks/ })).toBeDisabled();
    expect(within(dialog).getByRole("checkbox", { name: /Create clearly agreed tasks from my meetings/ })).toBeEnabled();
  });
});
