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

import { act } from "@testing-library/react";
import { AuthContext } from "../../context/AuthContext";

describe("sidebar: AI Meeting Assistant item across sign-out and sign-in (no page reload)", () => {
  beforeEach(() => { status.mockReset(); resetAiMeetingAssistantEnabled(); });

  const withAuth = (user, ws) => (
    <AuthContext.Provider value={{ user, activeWorkspace: ws, loading: false }}>
      <MemoryRouter><SidebarNav /></MemoryRouter>
    </AuthContext.Provider>
  );

  it("asks again after signing back in, instead of keeping the answer from before", async () => {
    status.mockResolvedValue({ data: { enabled: true } });
    const ws = { id: "w1" };
    const { rerender } = render(withAuth({ email: "a@x.com" }, ws));
    expect(await screen.findByText("AI Meeting Assistant")).toBeInTheDocument();

    rerender(withAuth(null, null));                         // signed out
    expect(screen.queryByText("AI Meeting Assistant")).not.toBeInTheDocument();

    rerender(withAuth({ email: "a@x.com" }, ws));           // signed in again, same page
    expect(await screen.findByText("AI Meeting Assistant")).toBeInTheDocument();
  });

  it("doesn't ask before a workspace is chosen, and doesn't remember a failed check", async () => {
    status.mockRejectedValueOnce(new Error("no workspace header yet")).mockResolvedValue({ data: { enabled: true } });
    const { rerender } = render(withAuth({ email: "a@x.com" }, null));
    await act(async () => {});
    expect(status).not.toHaveBeenCalled();
    rerender(withAuth({ email: "a@x.com" }, { id: "w1" }));
    await act(async () => {});
    expect(screen.queryByText("AI Meeting Assistant")).not.toBeInTheDocument();   // the first check failed
    rerender(withAuth({ email: "a@x.com" }, { id: "w2" }));                       // any later render asks again
    expect(await screen.findByText("AI Meeting Assistant")).toBeInTheDocument();
  });

  it("shows up straight after an admin turns the flag on", async () => {
    status.mockResolvedValueOnce({ data: { enabled: false } }).mockResolvedValue({ data: { enabled: true } });
    render(withAuth({ email: "a@x.com" }, { id: "w1" }));
    await act(async () => {});
    expect(screen.queryByText("AI Meeting Assistant")).not.toBeInTheDocument();
    act(() => { resetAiMeetingAssistantEnabled(); });       // what Admin Centre calls after saving the flag
    expect(await screen.findByText("AI Meeting Assistant")).toBeInTheDocument();
  });
});
