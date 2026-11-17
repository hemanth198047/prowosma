import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const status = vi.fn();
vi.mock("../../api/aiMeetingAssistant", () => ({ getUmaStatus: () => status() }));
vi.mock("../../components/WorkspaceSwitcher", () => ({ default: () => null }));
vi.mock("../../components/SidebarBadge", () => ({ default: () => null }));
import SidebarNav from "../../components/shell/SidebarNav";
import { resetAiMeetingAssistantEnabled } from "../../hooks/useAiMeetingAssistantEnabled";

describe("sidebar: AI Meeting Assistant item", () => {
  beforeEach(() => { status.mockReset(); resetAiMeetingAssistantEnabled(); });

  it("is hidden while the feature flag is off", async () => {
    status.mockResolvedValue({ data: { enabled: false } });
    render(<MemoryRouter><SidebarNav /></MemoryRouter>);
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    await Promise.resolve();
    expect(screen.queryByText("AI Meeting Assistant")).not.toBeInTheDocument();
    expect(screen.getByText("Meeting Assistant")).toBeInTheDocument();   // the existing feature is untouched
  });

  it("appears when the flag is on", async () => {
    status.mockResolvedValue({ data: { enabled: true } });
    render(<MemoryRouter><SidebarNav /></MemoryRouter>);
    expect(await screen.findByText("AI Meeting Assistant")).toBeInTheDocument();
  });

  it("stays hidden if the status check fails", async () => {
    status.mockRejectedValue(new Error("network"));
    render(<MemoryRouter><SidebarNav /></MemoryRouter>);
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(screen.queryByText("AI Meeting Assistant")).not.toBeInTheDocument();
  });
});
