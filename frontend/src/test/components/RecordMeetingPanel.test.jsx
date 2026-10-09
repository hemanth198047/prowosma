import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import { axe } from "vitest-axe";

const { toastShow } = vi.hoisted(() => ({ toastShow: vi.fn() }));
vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: toastShow }) }));
vi.mock("../../api/meetingAssistant", () => ({
  startRecording: vi.fn(), uploadRecordingChunk: vi.fn(), finishRecording: vi.fn(), uploadRecordingFile: vi.fn(),
}));

import * as api from "../../api/meetingAssistant";
import RecordMeetingPanel from "../../components/RecordMeetingPanel";
import { ANNOUNCEMENT, retentionText } from "../../utils/recordingText";

// ── fake browser media ──────────────────────────────────────────────────────

const makeTrack = (kind) => {
  const handlers = {};
  return { kind, stopped: false, stop() { this.stopped = true; }, addEventListener(ev, fn) { (handlers[ev] ||= []).push(fn); }, fire(ev) { (handlers[ev] || []).forEach((f) => f()); } };
};
const makeStream = (tracks) => ({ tracks, getTracks: () => tracks, getAudioTracks: () => tracks.filter((t) => t.kind === "audio"), getVideoTracks: () => tracks.filter((t) => t.kind === "video") });
class FakeMediaStream { constructor(tracks) { this.tracks = tracks; } getTracks() { return this.tracks; } }
class FakeMR {
  static isTypeSupported() { return true; }
  constructor() { this.state = "inactive"; }
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob([new Uint8Array(500)]) }); this.onstop?.(); }
}

let display, mic, md;
const CAPS = { ready: true, segmentSeconds: 0.05, retentionHours: 24, maxUploadBytes: 25_000_000 };   // 50 ms "three-minute" pieces, so tests run in real time

beforeEach(() => {
  vi.clearAllMocks();
  display = makeStream([makeTrack("video"), makeTrack("audio")]);
  mic = makeStream([makeTrack("audio")]);
  md = { getDisplayMedia: vi.fn().mockResolvedValue(display), getUserMedia: vi.fn().mockResolvedValue(mic) };
  Object.defineProperty(navigator, "mediaDevices", { value: md, configurable: true });
  globalThis.MediaRecorder = FakeMR;
  globalThis.MediaStream = FakeMediaStream;
  api.startRecording.mockResolvedValue({ data: { id: "s1" } });
  api.uploadRecordingChunk.mockResolvedValue({ data: { ok: true } });
  api.finishRecording.mockResolvedValue({ data: {} });
});
afterEach(() => { cleanup(); delete globalThis.MediaRecorder; delete globalThis.MediaStream; });

const mount = (props = {}) => render(<RecordMeetingPanel recording={CAPS} onCreated={vi.fn()} {...props} />);
const tick = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function startNow({ mic: useMic = true, title } = {}) {
  if (!useMic) fireEvent.click(screen.getByLabelText(/Also record my microphone/));
  if (title) fireEvent.change(screen.getByLabelText(/Title/, { selector: "#rec-title" }), { target: { value: title } });
  fireEvent.click(screen.getByLabelText(/Everyone in the meeting knows/));
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  await screen.findByText(/Recording 0:0/);
}

describe("RecordMeetingPanel — before recording", () => {
  it("explains the steps in plain words, says it works for any platform, and states when the audio is deleted", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Record a meeting" })).toBeInTheDocument();
    expect(screen.getByText(/Works with Google Meet, Teams, Zoom/)).toBeInTheDocument();
    expect(screen.getByText(/no Google Workspace needed/)).toBeInTheDocument();
    expect(screen.getByText(/deletes the audio 24 hours after the meeting ends/)).toBeInTheDocument();
    expect(screen.getByText(/Share tab audio/)).toBeInTheDocument();
    expect(retentionText(0)).toBe("as soon as it has been turned into text");
    expect(retentionText(1)).toBe("1 hour after the meeting ends");
    cleanup();
    mount({ recording: { ...CAPS, retentionHours: 0 } });
    expect(screen.getByText(/deletes the audio as soon as it has been turned into text/)).toBeInTheDocument();
  });

  it("will not start without the person confirming that everyone knows — and asks for nothing from the browser", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("confirm that everyone in the meeting knows");
    expect(md.getDisplayMedia).not.toHaveBeenCalled();
    expect(api.startRecording).not.toHaveBeenCalled();
  });

  it("says plainly when the browser can't do it, and disables the button", () => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent("Use Chrome or Edge on a computer");
    expect(screen.getByRole("button", { name: "Start recording" })).toBeDisabled();
  });

  it("opens the meeting link in a new tab only for a real https link", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    mount();
    const input = screen.getByLabelText(/Meeting link/);
    fireEvent.change(input, { target: { value: "http://meet.example.com/abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Open meeting" }));
    expect(screen.getByRole("alert")).toHaveTextContent("starting with https://");
    fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Open meeting" }));
    fireEvent.change(input, { target: { value: "not a link" } });
    fireEvent.click(screen.getByRole("button", { name: "Open meeting" }));
    expect(open).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "https://meet.google.com/abc-defg-hij" } });
    fireEvent.click(screen.getByRole("button", { name: "Open meeting" }));
    expect(open).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("offers uploading a recording instead, inside the same card", () => {
    mount();
    expect(screen.getByText("Already have a recording? Upload it instead")).toBeInTheDocument();
  });

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = mount();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("RecordMeetingPanel — recording", () => {
  it("asks the browser for the meeting tab WITH audio, confirms with the server, then sends audio pieces as they complete", async () => {
    mount();
    await startNow({ title: "Weekly sync" });
    expect(md.getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: true, selfBrowserSurface: "exclude" }));
    expect(md.getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true } });
    expect(api.startRecording).toHaveBeenCalledWith({ title: "Weekly sync", consent: true });
    expect(screen.getByText(/Keep the meeting tab and this page open/)).toBeInTheDocument();
    await waitFor(() => expect(api.uploadRecordingChunk).toHaveBeenCalled(), { timeout: 2000 });
    const [id, track, seq, blob, startMs] = api.uploadRecordingChunk.mock.calls[0];
    expect(id).toBe("s1");
    expect(["TAB", "MIC"]).toContain(track);
    expect(seq).toBe(0);
    expect(blob).toBeInstanceOf(Blob);
    expect(startMs).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Stop and make the transcript" }));
  });

  it("stopping delivers the last piece, finishes on the server, releases the screen share and microphone, and tells the page", async () => {
    const onCreated = vi.fn();
    mount({ onCreated });
    await startNow();
    await tick(120);
    fireEvent.click(screen.getByRole("button", { name: "Stop and make the transcript" }));
    expect(await screen.findByText(/Recording sent/)).toBeInTheDocument();
    expect(api.finishRecording).toHaveBeenCalledWith("s1");
    expect(onCreated).toHaveBeenCalledWith("s1");
    expect(display.getTracks().every((t) => t.stopped)).toBe(true);        // the browser's "sharing" indicator goes away
    expect(mic.getTracks().every((t) => t.stopped)).toBe(true);
    const tracksSent = new Set(api.uploadRecordingChunk.mock.calls.map((c) => c[1]));
    expect(tracksSent).toEqual(new Set(["TAB", "MIC"]));                    // both the meeting audio and the person's own voice
    expect(toastShow).toHaveBeenCalledWith("Recording finished", "success");
  });

  it("if the browser's own 'Stop sharing' button is pressed, the recording is finished automatically — nothing is lost", async () => {
    const onCreated = vi.fn();
    mount({ onCreated });
    await startNow();
    await tick(80);
    act(() => { display.getVideoTracks()[0].fire("ended"); });
    expect(await screen.findByText(/Recording sent/)).toBeInTheDocument();
    expect(api.finishRecording).toHaveBeenCalledTimes(1);
    expect(toastShow).toHaveBeenCalledWith("Sharing ended, so the recording was finished", "success");
  });

  it("records only the meeting audio when the microphone is switched off, and doesn't even ask for it", async () => {
    mount();
    await startNow({ mic: false });
    expect(md.getUserMedia).not.toHaveBeenCalled();
    await waitFor(() => expect(api.uploadRecordingChunk).toHaveBeenCalled(), { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: "Stop and make the transcript" }));
    await screen.findByText(/Recording sent/);
    expect(api.uploadRecordingChunk.mock.calls.every((c) => c[1] === "TAB")).toBe(true);
  });

  it("carries on with the meeting audio if the microphone is refused, and says what that means", async () => {
    md.getUserMedia.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    mount();
    await startNow();
    expect(screen.getByText(/microphone isn't available/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop and make the transcript" }));
    await screen.findByText(/Recording sent/);
    expect(api.uploadRecordingChunk.mock.calls.every((c) => c[1] === "TAB")).toBe(true);
  });

  it("shows the meeting is being heard, so people notice a muted or wrong tab early", async () => {
    mount();
    await startNow();
    expect(screen.getByText(/Meeting audio: /)).toBeInTheDocument();
    expect(screen.getByText(/Your microphone: /)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop and make the transcript" }));
    await screen.findByText(/Recording sent/);
  });

  it("warns before the page is closed while recording, and stops warning afterwards", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    mount();
    await startNow();
    expect(add.mock.calls.some(([ev]) => ev === "beforeunload")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Stop and make the transcript" }));
    await screen.findByText(/Recording sent/);
    expect(remove.mock.calls.some(([ev]) => ev === "beforeunload")).toBe(true);
    add.mockRestore(); remove.mockRestore();
  });

  it("leaving the page mid-recording releases the screen share and microphone", async () => {
    const { unmount } = mount();
    await startNow();
    unmount();
    expect(display.getTracks().every((t) => t.stopped)).toBe(true);
    expect(mic.getTracks().every((t) => t.stopped)).toBe(true);
  });

  it("copies a ready-made announcement for the meeting", async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount();
    await startNow();
    fireEvent.click(screen.getByRole("button", { name: "Copy announcement for the meeting" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ANNOUNCEMENT));
    expect(ANNOUNCEMENT).toMatch(/recording this meeting and turning it into text/);
    fireEvent.click(screen.getByRole("button", { name: "Stop and make the transcript" }));
    await screen.findByText(/Recording sent/);
  });
});

describe("RecordMeetingPanel — when something goes wrong", () => {
  it("no meeting audio shared (the 'Share tab audio' box wasn't ticked): explains exactly what to do, releases the share, and never contacts the server", async () => {
    display = makeStream([makeTrack("video")]);
    md.getDisplayMedia.mockResolvedValue(display);
    mount();
    fireEvent.click(screen.getByLabelText(/Everyone in the meeting knows/));
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("tick “Share tab audio”");
    expect(display.getTracks().every((t) => t.stopped)).toBe(true);
    expect(api.startRecording).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start recording" })).toBeEnabled();                   // they can try again
  });

  it("cancelling the browser's sharing box gives a friendly message, not an error", async () => {
    md.getDisplayMedia.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    mount();
    fireEvent.click(screen.getByLabelText(/Everyone in the meeting knows/));
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sharing was cancelled");
    expect(api.startRecording).not.toHaveBeenCalled();
  });

  it("if the server refuses to start (for example recording was just switched off), the share and microphone are released and the reason is shown", async () => {
    api.startRecording.mockRejectedValue({ response: { status: 409, data: { error: "RECORDING_NOT_READY", message: "Recording isn't turned on for this workspace." } } });
    mount();
    fireEvent.click(screen.getByLabelText(/Everyone in the meeting knows/));
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Recording isn't turned on|Couldn't start the recording/);
    expect(display.getTracks().every((t) => t.stopped)).toBe(true);
    expect(mic.getTracks().every((t) => t.stopped)).toBe(true);
    expect(screen.getByRole("button", { name: "Start recording" })).toBeEnabled();
  });

  it("a piece the server keeps refusing is reported at the end, but the recording still finishes", async () => {
    api.uploadRecordingChunk.mockRejectedValue(Object.assign(new Error("bad"), { response: { status: 415 } }));    // permanent: no waiting around
    const onCreated = vi.fn();
    mount({ onCreated });
    await startNow({ mic: false });
    await tick(120);
    fireEvent.click(screen.getByRole("button", { name: "Stop and make the transcript" }));
    expect(await screen.findByText(/Recording sent/)).toBeInTheDocument();
    expect(screen.getByText(/couldn't be sent, so those moments may be missing/)).toBeInTheDocument();
    expect(api.finishRecording).toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalled();
  });

  it("if 'finish' itself fails, the person is told the audio is safe and will be finished automatically", async () => {
    api.finishRecording.mockRejectedValue({ response: { status: 500, data: { message: "boom" } } });
    mount();
    await startNow({ mic: false });
    await tick(80);
    fireEvent.click(screen.getByRole("button", { name: "Stop and make the transcript" }));
    expect(await screen.findByText(/Recording sent/)).toBeInTheDocument();
    expect(screen.getByText(/Prowosma will finish it automatically in a few minutes/)).toBeInTheDocument();
  });

  it("'Record another' returns to the start with the confirmation cleared", async () => {
    mount();
    await startNow({ mic: false });
    fireEvent.click(screen.getByRole("button", { name: "Stop and make the transcript" }));
    await screen.findByText(/Recording sent/);
    fireEvent.click(screen.getByRole("button", { name: "Record another" }));
    expect(screen.getByLabelText(/Everyone in the meeting knows/)).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Start recording" })).toBeInTheDocument();
  });
});
