import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";

const { toastShow } = vi.hoisted(() => ({ toastShow: vi.fn() }));
vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: toastShow }) }));
vi.mock("../../api/meetingAssistant", () => ({ getAssistantSettings: vi.fn(), updateAssistantSettings: vi.fn(), testSpeechToText: vi.fn() }));

import * as api from "../../api/meetingAssistant";
import RecordingSettingsCard from "../../components/RecordingSettingsCard";

const SAVED = { recordingEnabled: true, sttBaseUrl: "https://stt.example.com", sttKeySaved: true, sttModel: "whisper-1", sttLanguage: "en", audioRetentionHours: 24 };

beforeEach(() => {
  vi.clearAllMocks();
  api.getAssistantSettings.mockResolvedValue({ data: SAVED });
  api.updateAssistantSettings.mockImplementation(async (patch) => ({ data: { ...SAVED, ...patch, sttApiKey: undefined, sttKeySaved: !patch.clearSttApiKey } }));
  api.testSpeechToText.mockResolvedValue({ data: { ok: true, message: "The speech-to-text server answered correctly." } });
});
afterEach(cleanup);

const mount = (recording = { ready: true }, onChanged = vi.fn()) => { render(<RecordingSettingsCard recording={recording} onChanged={onChanged} />); return { onChanged }; };
const loaded = () => screen.findByLabelText(/Speech-to-text server address/);

describe("RecordingSettingsCard", () => {
  it("shows the current settings — and never the key, only that one is saved", async () => {
    mount();
    expect(await loaded()).toHaveValue("https://stt.example.com");
    expect(screen.getByLabelText(/Model name/)).toHaveValue("whisper-1");
    expect(screen.getByLabelText(/Language/)).toHaveValue("en");
    expect(screen.getByLabelText(/Allow recording/)).toBeChecked();
    const key = screen.getByLabelText(/API key/);
    expect(key).toHaveValue("");
    expect(key).toHaveAttribute("type", "password");
    expect(key.getAttribute("placeholder")).toContain("A key is saved");
    expect(screen.getByLabelText(/Keep the audio/)).toHaveValue("24");
    expect(screen.getByText(/— on/)).toBeInTheDocument();
  });

  it("says when recording is off, and why people can't use it yet", async () => {
    mount({ ready: false, reason: "No speech-to-text server is set up yet." });
    await loaded();
    expect(screen.getByText(/— off/)).toBeInTheDocument();
    expect(screen.getByText("No speech-to-text server is set up yet.")).toBeInTheDocument();
  });

  it("saving sends the settings WITHOUT touching the key unless a new one was typed, then refreshes the page's capabilities", async () => {
    const { onChanged } = mount();
    await loaded();
    fireEvent.change(screen.getByLabelText(/Model name/), { target: { value: " Systran/faster-whisper-small " } });
    fireEvent.change(screen.getByLabelText(/Keep the audio/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateAssistantSettings).toHaveBeenCalled());
    const patch = api.updateAssistantSettings.mock.calls[0][0];
    expect(patch).toMatchObject({ recordingEnabled: true, sttBaseUrl: "https://stt.example.com", sttModel: "Systran/faster-whisper-small", sttLanguage: "en", audioRetentionHours: 0 });
    expect("sttApiKey" in patch).toBe(false);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toastShow).toHaveBeenCalledWith("Recording settings saved", "success");
  });

  it("a newly typed key is sent once, and the box is emptied afterwards", async () => {
    mount();
    await loaded();
    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: "  sk-new-key  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateAssistantSettings).toHaveBeenCalled());
    expect(api.updateAssistantSettings.mock.calls[0][0].sttApiKey).toBe("sk-new-key");
    await waitFor(() => expect(screen.getByLabelText(/API key/)).toHaveValue(""));
  });

  it("the saved key can be removed explicitly", async () => {
    mount();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Remove the saved key" }));
    await waitFor(() => expect(api.updateAssistantSettings).toHaveBeenCalled());
    expect(api.updateAssistantSettings.mock.calls[0][0]).toMatchObject({ clearSttApiKey: true });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove the saved key" })).toBeNull());
  });

  it("a refused change shows the server's reason and keeps what the admin typed", async () => {
    api.updateAssistantSettings.mockRejectedValue({ response: { status: 400, data: { error: "INVALID_STT_URL", message: "The speech-to-text address must use https." } } });
    mount();
    await loaded();
    fireEvent.change(screen.getByLabelText(/Speech-to-text server address/), { target: { value: "http://insecure.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/must use https|Couldn't save/);
    expect(screen.getByLabelText(/Speech-to-text server address/)).toHaveValue("http://insecure.example.com");
  });

  it("Test connection reports success and failure in plain words; it is unavailable without an address", async () => {
    mount();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/The speech-to-text server answered correctly/)).toBeInTheDocument();
    api.testSpeechToText.mockResolvedValue({ data: { ok: false, message: "The speech-to-text server rejected the API key." } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/rejected the API key/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Speech-to-text server address/), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
  });

  it("offers the sensible retention choices, with 24 hours explained", async () => {
    mount();
    await loaded();
    const labels = [...screen.getByLabelText(/Keep the audio/).querySelectorAll("option")].map((o) => o.textContent);
    expect(labels[0]).toContain("as soon as it has been turned into text");
    expect(labels.some((l) => l.includes("24 hours") && l.includes("recommended"))).toBe(true);
    expect(labels.length).toBe(5);
  });

  it("explains what is stored and where to find the set-up guide, and has no accessibility violations", async () => {
    const { container } = render(<RecordingSettingsCard recording={{ ready: true }} onChanged={vi.fn()} />);
    await loaded();
    expect(screen.getByText(/keeps only the text, and deletes the audio/)).toBeInTheDocument();
    expect(screen.getByText("docs/RECORDING_AND_SPEECH_TO_TEXT.md")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("still shows an empty form if the settings can't be read, so an admin can enter them", async () => {
    api.getAssistantSettings.mockRejectedValue(new Error("403"));
    const { container } = render(<RecordingSettingsCard recording={{ ready: true }} onChanged={vi.fn()} />);
    await waitFor(() => expect(api.getAssistantSettings).toHaveBeenCalled());
    expect(container.querySelector("input")).not.toBeNull();         // it still renders its form once loading ends (empty values)
  });
});
