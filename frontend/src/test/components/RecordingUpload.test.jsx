import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";

const { toastShow } = vi.hoisted(() => ({ toastShow: vi.fn() }));
vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: toastShow }) }));
vi.mock("../../api/meetingAssistant", () => ({ uploadRecordingFile: vi.fn() }));

import * as api from "../../api/meetingAssistant";
import RecordingUpload from "../../components/RecordingUpload";

const CAPS = { maxUploadBytes: 25_000_000 };
const audio = (name = "meeting.webm", size = 1000) => { const f = new File([new Uint8Array(10)], name, { type: "audio/webm" }); Object.defineProperty(f, "size", { value: size }); return f; };
const choose = (file) => fireEvent.change(screen.getByLabelText(/Audio or video file/), { target: { files: [file] } });
const consent = () => fireEvent.click(screen.getByLabelText(/I have the right to use this recording/));
const upload = () => fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));

beforeEach(() => { vi.clearAllMocks(); api.uploadRecordingFile.mockResolvedValue({ data: { id: "new1" } }); });
afterEach(cleanup);

describe("RecordingUpload", () => {
  it("states the size limit and that speakers can't be told apart in a file", () => {
    render(<RecordingUpload recording={CAPS} />);
    expect(screen.getByText(/up to 25 MB/)).toBeInTheDocument();
    expect(screen.getByText(/Speakers can't be told apart/)).toBeInTheDocument();
  });

  it("refuses a file over the limit before sending anything, and says how big it was", () => {
    render(<RecordingUpload recording={CAPS} />);
    choose(audio("huge.mp3", 40_000_000));
    expect(screen.getByRole("alert")).toHaveTextContent("That file is 40 MB. The limit is 25 MB");
    consent(); upload();
    expect(api.uploadRecordingFile).not.toHaveBeenCalled();
  });

  it("needs a file and the person's confirmation — and sends nothing without both", () => {
    render(<RecordingUpload recording={CAPS} />);
    upload();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a recording first");
    choose(audio());
    upload();
    expect(screen.getByRole("alert")).toHaveTextContent("confirm you have the right to use this recording");
    expect(api.uploadRecordingFile).not.toHaveBeenCalled();
  });

  it("uploads as a NEW meeting with its title, tells the page, and clears the form", async () => {
    const onDone = vi.fn();
    render(<RecordingUpload recording={CAPS} onDone={onDone} />);
    const file = audio();
    choose(file);
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: " Standup " } });
    consent(); upload();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("new1"));
    expect(api.uploadRecordingFile).toHaveBeenCalledWith(undefined, file, expect.objectContaining({ consent: true, title: "Standup" }));
    expect(toastShow).toHaveBeenCalledWith("Recording uploaded. Prowosma is turning it into text.", "success");
    expect(screen.getByLabelText(/I have the right to use this recording/)).not.toBeChecked();
  });

  it("attached to an EXISTING meeting there is no title field, and it uploads to that meeting", async () => {
    const onDone = vi.fn();
    render(<RecordingUpload recording={CAPS} sessionId="s9" onDone={onDone} />);
    expect(screen.queryByLabelText(/Title/)).toBeNull();
    const file = audio();
    choose(file); consent(); upload();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.uploadRecordingFile).toHaveBeenCalledWith("s9", file, expect.objectContaining({ consent: true }));
  });

  it("shows upload progress while sending, and the server's reason if it is refused", async () => {
    let resolve;
    api.uploadRecordingFile.mockImplementation((id, f, opts) => new Promise((r) => { resolve = r; opts.onProgress(0.4); }));
    render(<RecordingUpload recording={CAPS} />);
    choose(audio()); consent(); upload();
    const bar = await screen.findByLabelText("Upload progress");
    expect(bar).toHaveAttribute("value", "0.4");
    expect(screen.getByRole("button", { name: "Uploading…" })).toBeDisabled();
    resolve({ data: { id: "x" } });
    await waitFor(() => expect(screen.queryByLabelText("Upload progress")).toBeNull());

    api.uploadRecordingFile.mockRejectedValue({ response: { status: 415, data: { error: "NOT_AUDIO", message: "That doesn't look like an audio or video recording." } } });
    choose(audio()); consent(); upload();
    expect(await screen.findByRole("alert")).toHaveTextContent("doesn't look like an audio or video recording");
  });

  it("falls back to 25 MB when the server doesn't say, and has no accessibility violations", async () => {
    const { container } = render(<RecordingUpload />);
    expect(screen.getByText(/up to 25 MB/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
