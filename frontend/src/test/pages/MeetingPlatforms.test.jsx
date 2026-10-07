import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { axe } from "vitest-axe";

vi.mock("../../api/meetingAssistant", () => ({
  getMeetingPlatforms: vi.fn(), setMeetingPlatformEnabled: vi.fn(), testMeetingPlatform: vi.fn(),
  disconnectMeetingPlatform: vi.fn(), getAssistantSettings: vi.fn(), updateAssistantSettings: vi.fn(),
  getAssistantCapabilities: vi.fn(), getGoogleConnection: vi.fn(), startGoogleConnect: vi.fn(), disconnectGoogle: vi.fn(),
  getAiUsage: vi.fn(),
}));

import * as api from "../../api/meetingAssistant";
import { RoleContext } from "../../context/RoleContext";
import MeetingPlatforms from "../../pages/MeetingPlatforms";

const PLATFORMS = [
  { provider: "GOOGLE_MEET", enabled: false, connectionStatus: "NOT_CONNECTED" },
  { provider: "MS_TEAMS", enabled: true, connectionStatus: "NOT_CONNECTED" },
];
const SETTINGS = {
  assistantName: "Prowosma Meeting Assistant", sendRoles: ["OWNER", "ADMIN", "MEMBER"], defaultVisibility: "PRIVATE", autoGenerateOutputs: true, autoExtractActions: true,
  transcriptRetentionDays: 90, generatedContentRetentionDays: 365, retainRawAudio: false, rawAudioRetentionDays: 0, outputLanguage: "en",
};
const CAPS_OFF = { googleConfigured: false, aiReady: false, aiReason: "AI isn't turned on. An admin can enable it under AI Settings.", platforms: [
  { provider: "GOOGLE_MEET", manualTranscriptUpload: true }, { provider: "MS_TEAMS", manualTranscriptUpload: true }] };
const CAPS_ON = { ...CAPS_OFF, googleConfigured: true };
const renderAs = (role) => render(
  <MemoryRouter><RoleContext.Provider value={role}><MeetingPlatforms /></RoleContext.Provider></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  api.getMeetingPlatforms.mockResolvedValue({ data: PLATFORMS });
  api.getAssistantSettings.mockResolvedValue({ data: SETTINGS });
  api.getAssistantCapabilities.mockResolvedValue({ data: CAPS_OFF });
  api.getGoogleConnection.mockResolvedValue({ data: { configured: false, connected: false, status: "NOT_CONNECTED" } });
  api.getAiUsage.mockResolvedValue({ data: { days: 30, runs: 4, failed: 1, modelCalls: 9, inputTokens: 12000, outputTokens: 3400 } });
});
afterEach(cleanup);

describe("MeetingPlatforms page", () => {
  it("non-admins see a clear message and no admin API is called", () => {
    renderAs({ isAdmin: false, isOwner: false });
    expect(screen.getByRole("alert")).toHaveTextContent("Only workspace admins");
    expect(api.getMeetingPlatforms).not.toHaveBeenCalled();
    expect(api.getAssistantSettings).not.toHaveBeenCalled();
  });

  it("admins can enable a platform", async () => {
    api.setMeetingPlatformEnabled.mockResolvedValue({ data: {} });
    renderAs({ isAdmin: true });
    const boxes = await screen.findAllByRole("checkbox", { name: /Allow people to register/ });
    fireEvent.click(boxes[0]);
    await waitFor(() => expect(api.setMeetingPlatformEnabled).toHaveBeenCalledWith("GOOGLE_MEET", true));
  });

  it("Google sign-in is disabled with an explanation until the server is set up; Teams never offers a connect", async () => {
    renderAs({ isOwner: true });
    const google = await screen.findByRole("button", { name: "Connect my Google account" });
    expect(google).toBeDisabled();
    expect(screen.getByText(/needs server setup/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();       // Teams
  });

  it("starts Google sign-in and sends the browser to Google", async () => {
    api.getAssistantCapabilities.mockResolvedValue({ data: CAPS_ON });
    api.startGoogleConnect.mockResolvedValue({ data: { url: "https://accounts.google.com/o/oauth2/v2/auth?state=s" } });
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { assign } });
    try {
      renderAs({ isAdmin: true });
      const btn = await screen.findByRole("button", { name: "Connect my Google account" });
      await waitFor(() => expect(btn).toBeEnabled());
      fireEvent.click(btn);
      await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?state=s"));
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });

  it("shows which Google account is connected and lets the person disconnect it", async () => {
    api.getAssistantCapabilities.mockResolvedValue({ data: CAPS_ON });
    api.getGoogleConnection.mockResolvedValue({ data: { configured: true, connected: true, account: "me@corp.com", status: "ACTIVE" } });
    renderAs({ isAdmin: true });
    expect(await screen.findByRole("button", { name: "Disconnect my Google account" })).toBeInTheDocument();
    expect(screen.getByText(/on for your account \(me@corp.com\)/)).toBeInTheDocument();
  });

  it("does not pretend a connection exists: Test says what is actually wrong", async () => {
    api.testMeetingPlatform.mockResolvedValue({ data: { healthy: false, message: "Platform sign-in isn't set up yet, so transcripts can't be fetched automatically." } });
    renderAs({ isOwner: true });
    expect((await screen.findAllByText(/Live joining: not available/)).length).toBe(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[0]);
    expect(await screen.findByText(/sign-in isn't set up yet/)).toBeInTheDocument();
  });

  it("automatic creation cannot be switched on from the UI", async () => {
    renderAs({ isAdmin: true });
    const auto = await screen.findByRole("checkbox", { name: /Create tasks automatically/ });
    expect(auto).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Create projects automatically/ })).toBeDisabled();
  });

  it("saves settings and shows the server's validation message when rejected", async () => {
    api.updateAssistantSettings.mockRejectedValue({ response: { data: { error: "INVALID_LANGUAGE",
      message: "Use a language code such as en or pt-BR." } } });
    renderAs({ isAdmin: true });
    fireEvent.change(await screen.findByLabelText("Output language"), { target: { value: "english!" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("language code");
  });

  it("saves valid settings and confirms", async () => {
    api.updateAssistantSettings.mockResolvedValue({ data: { ...SETTINGS, assistantName: "Scribe" } });
    renderAs({ isAdmin: true });
    fireEvent.change(await screen.findByLabelText("Assistant name"), { target: { value: "Scribe" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(api.updateAssistantSettings).toHaveBeenCalledTimes(1));
    expect(api.updateAssistantSettings.mock.calls[0][0]).toMatchObject({ assistantName: "Scribe", retainRawAudio: false, rawAudioRetentionDays: 0 });
  });

  it("shows whether AI is ready, with the reason when it isn't, and the token usage", async () => {
    renderAs({ isAdmin: true });
    expect(await screen.findByText(/AI isn't ready: AI isn't turned on/)).toBeInTheDocument();
    expect(await screen.findByText(/4 runs \(1 failed\), 9 model calls/)).toBeInTheDocument();
    expect(screen.getByText(/Tokens, not money/)).toBeInTheDocument();
  });

  it("lets an admin switch automatic generation off, and saves it", async () => {
    api.getAssistantCapabilities.mockResolvedValue({ data: { ...CAPS_OFF, aiReady: true, aiReason: null } });
    api.updateAssistantSettings.mockResolvedValue({ data: { ...SETTINGS, autoGenerateOutputs: false } });
    renderAs({ isAdmin: true });
    expect(await screen.findByText(/AI is ready/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Create them automatically/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(api.updateAssistantSettings).toHaveBeenCalledTimes(1));
    expect(api.updateAssistantSettings.mock.calls[0][0]).toMatchObject({ autoGenerateOutputs: false, autoExtractActions: true });
  });

  it("has its own switch for automatic action extraction, which explains the extra cost", async () => {
    api.updateAssistantSettings.mockResolvedValue({ data: { ...SETTINGS, autoExtractActions: false } });
    renderAs({ isAdmin: true });
    fireEvent.click(await screen.findByRole("checkbox", { name: /extract action items/ }));
    expect(screen.getByText(/one more AI pass/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(api.updateAssistantSettings).toHaveBeenCalled());
    expect(api.updateAssistantSettings.mock.calls[0][0]).toMatchObject({ autoExtractActions: false });
  });

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = renderAs({ isAdmin: true });
    await screen.findByLabelText("Assistant name");
    expect(await axe(container)).toHaveNoViolations();
  });
});
