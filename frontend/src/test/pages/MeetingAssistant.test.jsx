import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
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
}));
vi.mock("../../api/projects", () => ({ getProjects: vi.fn() }));
vi.mock("../../api/team", () => ({ getTeamMembers: vi.fn() }));

import * as api from "../../api/meetingAssistant";
import { getProjects } from "../../api/projects";
import { getTeamMembers } from "../../api/team";
import MeetingAssistant from "../../pages/MeetingAssistant";

const CAPS = {
  assistantName: "Prowosma Meeting Assistant",
  platforms: [{ provider: "GOOGLE_MEET", enabled: true, liveJoin: false }],
  devFixturesEnabled: false,
  note: "Meetings can be registered, but no transcript source is connected yet, so nothing is collected automatically.",
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
});
afterEach(cleanup);

const typeUrl = (v) => fireEvent.change(screen.getByLabelText("Meeting link"), { target: { value: v } });

describe("MeetingAssistant page", () => {
  it("is honest: tells people live joining isn't available and labels the button 'Register meeting'", async () => {
    render(<MeetingAssistant />);
    expect(await screen.findByRole("button", { name: "Register meeting" })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("can't join meetings live");
    expect(screen.queryByRole("button", { name: "Send Meeting Assistant" })).toBeNull();
  });

  it("shows the server's plain-language reason for a bad link and keeps submit disabled", async () => {
    api.validateMeetingUrl.mockResolvedValue({ data: { valid: false, errorCode: "UNSUPPORTED_PLATFORM", message: "Zoom isn't supported yet." } });
    render(<MeetingAssistant />);
    await screen.findByRole("button", { name: "Register meeting" });
    typeUrl("https://zoom.us/j/123456789");
    expect(await screen.findByText("Zoom isn't supported yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register meeting" })).toBeDisabled();
  });

  it("blocks submit and explains when the platform isn't enabled by an admin", async () => {
    api.validateMeetingUrl.mockResolvedValue({ data: { valid: true, provider: "MS_TEAMS", providerEnabled: false } });
    render(<MeetingAssistant />);
    await screen.findByRole("button", { name: "Register meeting" });
    typeUrl("https://teams.microsoft.com/meet/123456789012");
    expect(await screen.findByText(/isn't enabled yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register meeting" })).toBeDisabled();
  });

  it("registers a valid meeting with the chosen project and shows it in the list", async () => {
    api.validateMeetingUrl.mockResolvedValue({ data: { valid: true, provider: "GOOGLE_MEET", providerEnabled: true } });
    api.createMeetingSession.mockResolvedValue({ data: SESSION });
    api.listMeetingSessions.mockResolvedValueOnce({ data: [] }).mockResolvedValue({ data: [SESSION] });
    render(<MeetingAssistant />);
    await screen.findByRole("button", { name: "Register meeting" });
    typeUrl("https://meet.google.com/abc-defg-hij");
    await screen.findByText(/Google Meet link/);
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Register meeting" }));
    await waitFor(() => expect(api.createMeetingSession).toHaveBeenCalledTimes(1));
    expect(api.createMeetingSession.mock.calls[0][0]).toMatchObject({
      meetingUrl: "https://meet.google.com/abc-defg-hij", projectId: "p1", scheduledFor: null, simulated: false,
    });
    expect((await screen.findAllByText("Weekly sync")).length).toBeGreaterThan(0);
  });

  it("explains a duplicate request using the server's message", async () => {
    api.validateMeetingUrl.mockResolvedValue({ data: { valid: true, provider: "GOOGLE_MEET", providerEnabled: true } });
    api.createMeetingSession.mockRejectedValue({ response: { status: 409, data: { error: "DUPLICATE_SESSION",
      message: "The assistant is already assigned to this meeting occurrence." } } });
    render(<MeetingAssistant />);
    await screen.findByRole("button", { name: "Register meeting" });
    typeUrl("https://meet.google.com/abc-defg-hij");
    await screen.findByText(/Google Meet link/);
    fireEvent.click(screen.getByRole("button", { name: "Register meeting" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already assigned");
  });

  it("offers Retry with a plain explanation after a failure, and Cancel only while in flight", async () => {
    const failed = { ...SESSION, id: "s2", title: "Failed one", status: "FAILED", statusDetail: "Simulated failure.", recoveryAction: "Use Retry to try again." };
    api.listMeetingSessions.mockResolvedValue({ data: [SESSION, failed] });
    render(<MeetingAssistant />);
    await screen.findByText("Failed one");
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    fireEvent.click(screen.getByText("Failed one"));
    expect(await screen.findByText(/Use Retry to try again/)).toBeInTheDocument();
  });

  it("results tabs are keyboard-operable and never invent content", async () => {
    api.listMeetingSessions.mockResolvedValue({ data: [SESSION] });
    render(<MeetingAssistant />);
    fireEvent.click(await screen.findByText("Weekly sync"));
    await screen.findByRole("tablist", { name: "Meeting results" });
    expect(screen.getAllByRole("tab")).toHaveLength(6);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Summary" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "MOM" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("No transcript has been collected");
  });

  it("has no automatically detectable accessibility violations", async () => {
    api.listMeetingSessions.mockResolvedValue({ data: [SESSION] });
    const { container } = render(<MeetingAssistant />);
    await screen.findByText("Weekly sync");
    expect(await axe(container)).toHaveNoViolations();
  });
});
