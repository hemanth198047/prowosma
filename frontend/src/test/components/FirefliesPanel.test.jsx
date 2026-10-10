import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";

const { toastShow } = vi.hoisted(() => ({ toastShow: vi.fn() }));
vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: toastShow }) }));
vi.mock("../../api/meetingAssistant", () => ({ sendFirefliesNotetaker: vi.fn(), getFirefliesRecent: vi.fn(), importFirefliesTranscript: vi.fn() }));

import * as api from "../../api/meetingAssistant";
import FirefliesPanel from "../../components/FirefliesPanel";

const MEET = "https://meet.google.com/abc-defg-hij";
const mount = (onCreated = vi.fn()) => { render(<FirefliesPanel onCreated={onCreated} />); return { onCreated }; };
const typeLink = (v) => fireEvent.change(screen.getByLabelText(/Meeting link/), { target: { value: v } });
const consent = () => fireEvent.click(screen.getByLabelText(/Everyone in the meeting knows a Fireflies notetaker/));
const sendBtn = () => screen.getByRole("button", { name: "Send notetaker" });

beforeEach(() => { vi.clearAllMocks(); api.sendFirefliesNotetaker.mockResolvedValue({ data: { id: "s1", platform: "GOOGLE_MEET" } }); });
afterEach(cleanup);

describe("FirefliesPanel — sending the notetaker", () => {
  it("explains the three steps, including that the host must admit it and that the meeting must be running", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Fireflies notetaker" })).toBeInTheDocument();
    expect(screen.getByText(/while the meeting is/)).toBeInTheDocument();
    expect(screen.getByText(/admit it/)).toBeInTheDocument();
    expect(screen.getByText(/any account/)).toBeInTheDocument();
  });

  it("tells the person at once whether the link can work: a green tick with the platform, or what is supported", () => {
    mount();
    typeLink("https://zoom.us/j/84511223344");
    expect(screen.getByText("✓ Zoom meeting")).toBeInTheDocument();
    typeLink("https://example.com/room");
    expect(screen.queryByText(/✓/)).toBeNull();
    expect(screen.getByText(/Fireflies works with Google Meet, Zoom, Microsoft Teams and Webex/)).toBeInTheDocument();
    typeLink("");
    expect(screen.queryByText(/Fireflies works with/)).toBeNull();                            // nothing nagging an empty box
  });

  it("will not send without a valid link or without the confirmation — and sends nothing", () => {
    mount();
    fireEvent.click(sendBtn());
    expect(screen.getByRole("alert")).toHaveTextContent("Paste the link of the meeting that is running right now");
    typeLink("https://example.com/room");
    fireEvent.click(sendBtn());
    expect(screen.getByRole("alert")).toHaveTextContent("Fireflies works with");
    typeLink(MEET);
    fireEvent.click(sendBtn());
    expect(screen.getByRole("alert")).toHaveTextContent("everyone in the meeting knows a Fireflies notetaker will join");
    expect(api.sendFirefliesNotetaker).not.toHaveBeenCalled();
  });

  it("sends the link and title with consent, shows what to do next, tells the page, and clears the form", async () => {
    const { onCreated } = mount();
    typeLink(`  ${MEET}  `);
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: " Weekly sync " } });
    consent();
    fireEvent.click(sendBtn());
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("s1"));
    expect(api.sendFirefliesNotetaker).toHaveBeenCalledWith({ meetingUrl: MEET, title: "Weekly sync", consent: true });
    expect(screen.getByText(/The notetaker was sent to your Google Meet meeting/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Meeting link/)).toHaveValue("");
    expect(screen.getByLabelText(/Everyone in the meeting knows a Fireflies notetaker/)).not.toBeChecked();
    expect(toastShow).toHaveBeenCalledWith("Notetaker sent", "success");
  });

  it("shows the server's plain reason when Fireflies refuses, and keeps what was typed so it can be tried again", async () => {
    api.sendFirefliesNotetaker.mockRejectedValue({ response: { status: 409, data: { error: "MEETING_NOT_RUNNING", message: "Fireflies didn't accept this meeting. It has to be running right now for the notetaker to join." } } });
    mount();
    typeLink(MEET); consent();
    fireEvent.click(sendBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent(/has to be running right now|Couldn't send/);
    expect(screen.getByLabelText(/Meeting link/)).toHaveValue(MEET);
    expect(sendBtn()).toBeEnabled();
  });

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = render(<FirefliesPanel onCreated={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("FirefliesPanel — importing a meeting Fireflies already has", () => {
  const RECENT = [
    { id: "t1", title: "Calendar call", date: "2026-10-07T10:00:00Z", platform: "GOOGLE_MEET", live: false, imported: false },
    { id: "t2", title: "Old sync", date: "2026-10-01T10:00:00Z", platform: "ZOOM", live: false, imported: true },
    { id: "t3", title: "Running now", date: "2026-10-08T10:00:00Z", platform: null, live: true, imported: false },
  ];

  it("loads the recent meetings and marks the ones already imported or still running, which can't be imported", async () => {
    api.getFirefliesRecent.mockResolvedValue({ data: RECENT });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Load my recent Fireflies meetings" }));
    expect(await screen.findByText("Calendar call")).toBeInTheDocument();
    expect(screen.getByText(/Zoom · already imported|· Zoom · already imported/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import Calendar call" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Import Old sync" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import Running now" })).toBeDisabled();
    expect(screen.getByText(/in progress/)).toBeInTheDocument();
  });

  it("needs the person's confirmation, then imports that meeting, marks it imported, and tells the page", async () => {
    api.getFirefliesRecent.mockResolvedValue({ data: RECENT });
    api.importFirefliesTranscript.mockResolvedValue({ data: { id: "new1" } });
    const { onCreated } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Load my recent Fireflies meetings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import Calendar call" }));
    expect(screen.getByRole("alert")).toHaveTextContent("confirm you have the right to import");
    expect(api.importFirefliesTranscript).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/I have the right to import these transcripts/));
    fireEvent.click(screen.getByRole("button", { name: "Import Calendar call" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new1"));
    expect(api.importFirefliesTranscript).toHaveBeenCalledWith({ transcriptId: "t1", consent: true });
    expect(screen.getByRole("button", { name: "Import Calendar call" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import Calendar call" })).toHaveTextContent("Imported");
  });

  it("explains an empty account, and shows the server's reason when loading or importing fails", async () => {
    api.getFirefliesRecent.mockResolvedValueOnce({ data: [] });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Load my recent Fireflies meetings" }));
    expect(await screen.findByText(/No recent meetings were found/)).toBeInTheDocument();
    cleanup();
    api.getFirefliesRecent.mockRejectedValueOnce({ response: { status: 409, data: { error: "FIREFLIES_KEY_REJECTED", message: "Fireflies rejected the saved API key. An admin needs to enter a new one." } } });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Load my recent Fireflies meetings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/rejected the saved API key|Couldn't load/);
    cleanup();
    api.getFirefliesRecent.mockResolvedValue({ data: RECENT });
    api.importFirefliesTranscript.mockRejectedValue({ response: { status: 409, data: { error: "FIREFLIES_PROCESSING", message: "Fireflies is still processing that meeting." } } });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Load my recent Fireflies meetings" }));
    fireEvent.click(await screen.findByLabelText(/I have the right to import/));
    fireEvent.click(screen.getByRole("button", { name: "Import Calendar call" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/still processing|Couldn't import/);
    expect(screen.getByRole("button", { name: "Import Calendar call" })).toBeEnabled();                    // can try again later
  });
});
