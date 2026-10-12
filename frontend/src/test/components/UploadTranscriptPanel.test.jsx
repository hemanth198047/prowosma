import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";

const { toastShow } = vi.hoisted(() => ({ toastShow: vi.fn() }));
vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: toastShow }) }));
vi.mock("../../api/meetingAssistant", () => ({ createMeetingFromTranscriptFile: vi.fn(), createMeetingFromTranscriptText: vi.fn() }));

import * as api from "../../api/meetingAssistant";
import UploadTranscriptPanel from "../../components/UploadTranscriptPanel";

const PROJECTS = [{ id: "p1", name: "Billing" }];
const mount = (props = {}) => { const onCreated = vi.fn(); render(<UploadTranscriptPanel projects={PROJECTS} onCreated={onCreated} {...props} />); return { onCreated }; };
const file = (name = "Weekly sync.vtt", size = 1000) => { const f = new File(["WEBVTT"], name, { type: "text/vtt" }); Object.defineProperty(f, "size", { value: size }); return f; };
const choose = (f) => fireEvent.change(screen.getByLabelText(/Transcript file/), { target: { files: [f] } });
const paste = (t) => fireEvent.change(screen.getByLabelText(/Or paste the transcript/), { target: { value: t } });
const consent = () => fireEvent.click(screen.getByLabelText(/I have the right to use this transcript/));
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Create meeting from transcript" }));

beforeEach(() => {
  vi.clearAllMocks();
  api.createMeetingFromTranscriptFile.mockResolvedValue({ data: { id: "m1", warnings: [] } });
  api.createMeetingFromTranscriptText.mockResolvedValue({ data: { id: "m2", warnings: ["Some lines had no speaker."] } });
});
afterEach(cleanup);

describe("UploadTranscriptPanel", () => {
  it("says no meeting link is needed and the meeting need not be running, and what happens next", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Upload a transcript" })).toBeInTheDocument();
    expect(screen.getByText(/no meeting link is needed/)).toBeInTheDocument();
    expect(screen.getByText(/review them before any task or project is created/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Transcript file/)).toHaveAttribute("accept", expect.stringContaining(".docx"));
  });

  it("explains how to get a Google Meet transcript out of Drive", () => {
    mount();
    expect(screen.getByText(/Google Meet transcripts saved in Drive/)).toBeInTheDocument();
  });

  it("warns, without blocking, when AI isn't set up", () => {
    mount({ aiReady: false, aiReason: "No AI provider is configured." });
    expect(screen.getByText(/summaries, action items and tasks need AI/)).toBeInTheDocument();
    expect(screen.getByText(/No AI provider is configured/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create meeting from transcript" })).not.toBeDisabled();
  });

  it("asks for a file or text first, then for the confirmation — and sends nothing until both are there", () => {
    mount();
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent(/Choose a transcript file or paste/);
    paste("Priya: hello");
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent(/right to use this transcript/);
    expect(api.createMeetingFromTranscriptFile).not.toHaveBeenCalled();
    expect(api.createMeetingFromTranscriptText).not.toHaveBeenCalled();
  });

  it("uploads a chosen file with its title and project, then opens the new meeting", async () => {
    const { onCreated } = mount();
    choose(file());
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Sprint planning" } });
    fireEvent.change(screen.getByLabelText("Project for the new meeting"), { target: { value: "p1" } });
    consent(); submit();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("m1"));
    expect(api.createMeetingFromTranscriptFile).toHaveBeenCalledWith(expect.objectContaining({ name: "Weekly sync.vtt" }), expect.objectContaining({ consent: true, title: "Sprint planning", projectId: "p1" }));
    expect(api.createMeetingFromTranscriptText).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith("Transcript added as a new meeting", "success");
  });

  it("sends pasted text when there is no file, and shows the server's warnings", async () => {
    const { onCreated } = mount();
    paste("Priya: Ship it by Friday.");
    consent(); submit();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("m2"));
    expect(api.createMeetingFromTranscriptText).toHaveBeenCalledWith({ content: "Priya: Ship it by Friday.", title: "", projectId: null, consent: true });
    expect(await screen.findByText(/Some lines had no speaker/)).toBeInTheDocument();
  });

  it("refuses a file over the limit before sending anything, saying how big it was", () => {
    mount({ limits: { maxBytes: 5_000_000 } });
    choose(file("huge.docx", 9_000_000));
    expect(screen.getByRole("alert")).toHaveTextContent(/9 MB.*limit is 5 MB/);
    submit();
    expect(api.createMeetingFromTranscriptFile).not.toHaveBeenCalled();
  });

  it("shows what the server says when it can't read the file, and keeps what the person entered", async () => {
    api.createMeetingFromTranscriptFile.mockRejectedValue({ response: { status: 400, data: { code: "UNSUPPORTED_FILE", message: "PDF files can't be read yet. Save it as .docx or .txt." } } });
    const { onCreated } = mount();
    choose(file("notes.pdf"));
    consent(); submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/PDF files can't be read yet/);
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/I have the right to use this transcript/)).toBeChecked();
  });

  it("a chosen file replaces any pasted text, and can be removed", () => {
    mount();
    paste("Priya: hi");
    choose(file());
    expect(screen.getByLabelText(/Or paste the transcript/)).toBeDisabled();
    expect(screen.getByLabelText(/Or paste the transcript/)).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByLabelText(/Or paste the transcript/)).not.toBeDisabled();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<UploadTranscriptPanel projects={PROJECTS} onCreated={vi.fn()} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
