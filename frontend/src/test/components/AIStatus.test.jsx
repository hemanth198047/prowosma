import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { axe } from "vitest-axe";

vi.mock("../../api/ai", () => ({ getAIStatus: vi.fn(), AI_SETTINGS_CHANGED: "prowosma:ai-settings-changed" }));
vi.mock("../../hooks/useRole", () => ({ useRole: vi.fn() }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));

import { getAIStatus } from "../../api/ai";
import { useRole } from "../../hooks/useRole";
import { useAuth } from "../../hooks/useAuth";
import AIStatus from "../../components/AIStatus";

const ON = { data: { state: "ON", enabled: true, configured: true, provider: "ANTHROPIC", model: "claude-sonnet-4", message: "AI is on for this workspace." } };
const OFF = { data: { state: "OFF", enabled: false, configured: false, provider: "ANTHROPIC", model: "", message: "AI is off for this workspace. An admin can turn it on in AI Settings." } };
const SETUP = { data: { state: "NEEDS_SETUP", enabled: true, configured: false, provider: "ANTHROPIC", model: "", message: "AI is turned on but isn't ready: No API key is saved. An admin can fix this in AI Settings." } };

const mount = () => render(<MemoryRouter><AIStatus /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  useRole.mockReturnValue({ isAdmin: false });
  useAuth.mockReturnValue({ activeWorkspace: { id: "w1" } });
  getAIStatus.mockResolvedValue(ON);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("AIStatus badge", () => {
  it("says AI is on, with the provider and model in the tooltip", async () => {
    mount();
    const badge = await screen.findByRole("status");
    expect(badge).toHaveTextContent("AI On");
    expect(badge).toHaveClass("ai-on");
    expect(badge).toHaveAttribute("title", expect.stringContaining("Anthropic (Claude) · claude-sonnet-4"));
  });

  it("says AI is off, and what to do about it", async () => {
    getAIStatus.mockResolvedValue(OFF);
    mount();
    const badge = await screen.findByRole("status");
    expect(badge).toHaveTextContent("AI Off");
    expect(badge).toHaveClass("ai-off");
    expect(badge).toHaveAttribute("title", expect.stringContaining("An admin can turn it on"));
  });

  it("says AI needs setup when it's switched on but not ready, and explains why", async () => {
    getAIStatus.mockResolvedValue(SETUP);
    mount();
    const badge = await screen.findByRole("status");
    expect(badge).toHaveTextContent("AI Setup");
    expect(badge).toHaveClass("ai-setup");
    expect(badge).toHaveAttribute("title", expect.stringContaining("No API key is saved"));
  });

  it("is a link to AI Settings for admins only", async () => {
    useRole.mockReturnValue({ isAdmin: true });
    mount();
    const link = await screen.findByRole("link", { name: /AI On/ });
    expect(link).toHaveAttribute("href", "/ai-settings");
    expect(link).toHaveAttribute("title", expect.stringContaining("Click to manage AI Settings"));
    cleanup();
    useRole.mockReturnValue({ isAdmin: false });
    mount();
    await screen.findByRole("status");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows nothing until it knows, and nothing if it can't find out", async () => {
    getAIStatus.mockRejectedValue(new Error("offline"));
    const { container } = mount();
    await waitFor(() => expect(getAIStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the last known state when a later refresh fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount();
    expect(await screen.findByRole("status")).toHaveTextContent("AI On");
    getAIStatus.mockRejectedValue(new Error("offline"));
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(screen.getByRole("status")).toHaveTextContent("AI On");
  });

  it("refreshes every minute, when the window regains focus, and right after AI Settings change", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount();
    expect(await screen.findByRole("status")).toHaveTextContent("AI On");
    expect(getAIStatus).toHaveBeenCalledTimes(1);

    getAIStatus.mockResolvedValue(OFF);
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(await screen.findByText("AI Off")).toBeInTheDocument();                           // the minute-by-minute refresh

    getAIStatus.mockResolvedValue(SETUP);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(await screen.findByText("AI Setup")).toBeInTheDocument();                         // coming back to the tab

    getAIStatus.mockResolvedValue(ON);
    await act(async () => { window.dispatchEvent(new Event("prowosma:ai-settings-changed")); });
    expect(await screen.findByText("AI On")).toBeInTheDocument();                            // an admin just saved settings
  });

  it("never shows another workspace's state after switching", async () => {
    const { rerender } = mount();
    expect(await screen.findByRole("status")).toHaveTextContent("AI On");
    getAIStatus.mockImplementation(() => new Promise(() => {}));                              // the new workspace's answer hasn't arrived yet
    useAuth.mockReturnValue({ activeWorkspace: { id: "w2" } });
    rerender(<MemoryRouter><AIStatus /></MemoryRouter>);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    getAIStatus.mockResolvedValue(OFF);
    useAuth.mockReturnValue({ activeWorkspace: { id: "w3" } });
    rerender(<MemoryRouter><AIStatus /></MemoryRouter>);
    expect(await screen.findByText("AI Off")).toBeInTheDocument();
  });

  it("has no automatically detectable accessibility violations, and states the answer in words (not colour alone)", async () => {
    const { container } = mount();
    const badge = await screen.findByRole("status");
    expect(badge).toHaveAccessibleName(expect.stringContaining("AI On"));
    expect(await axe(container)).toHaveNoViolations();
  });
});
