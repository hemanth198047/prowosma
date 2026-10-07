import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { axe } from "vitest-axe";

vi.mock("../../api/meetingAssistant", () => ({
  getMeetingPlatforms: vi.fn(), setMeetingPlatformEnabled: vi.fn(), testMeetingPlatform: vi.fn(),
  disconnectMeetingPlatform: vi.fn(), getAssistantSettings: vi.fn(), updateAssistantSettings: vi.fn(),
}));

import * as api from "../../api/meetingAssistant";
import { RoleContext } from "../../context/RoleContext";
import MeetingPlatforms from "../../pages/MeetingPlatforms";

const PLATFORMS = [
  { provider: "GOOGLE_MEET", enabled: false, connectionStatus: "NOT_CONNECTED" },
  { provider: "MS_TEAMS", enabled: true, connectionStatus: "NOT_CONNECTED" },
];
const SETTINGS = {
  assistantName: "Prowosma Meeting Assistant", sendRoles: ["OWNER", "ADMIN", "MEMBER"], defaultVisibility: "PRIVATE",
  transcriptRetentionDays: 90, generatedContentRetentionDays: 365, retainRawAudio: false, rawAudioRetentionDays: 0, outputLanguage: "en",
};
const renderAs = (role) => render(
  <MemoryRouter><RoleContext.Provider value={role}><MeetingPlatforms /></RoleContext.Provider></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  api.getMeetingPlatforms.mockResolvedValue({ data: PLATFORMS });
  api.getAssistantSettings.mockResolvedValue({ data: SETTINGS });
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

  it("does not pretend a connection exists: Connect is disabled, limits are listed, and Test says so", async () => {
    api.testMeetingPlatform.mockResolvedValue({ data: { healthy: false, message: "Platform sign-in isn't set up yet, so transcripts can't be fetched automatically." } });
    renderAs({ isOwner: true });
    const connect = (await screen.findAllByRole("button", { name: "Connect" }))[0];
    expect(connect).toBeDisabled();
    expect(screen.getAllByText(/Live joining: not available/).length).toBe(2);
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

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = renderAs({ isAdmin: true });
    await screen.findByLabelText("Assistant name");
    expect(await axe(container)).toHaveNoViolations();
  });
});
