import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../utils/staleApp", () => ({
  currentVersion: () => "abc123-xyz",
  fetchLiveVersion: vi.fn(),
  freshReload: vi.fn(),
}));
import { fetchLiveVersion, freshReload } from "../../utils/staleApp";
import AppVersion, { formatBuilt } from "../../components/AppVersion";

describe("AppVersion", () => {
  beforeEach(() => { vi.mocked(fetchLiveVersion).mockReset(); vi.mocked(freshReload).mockReset(); });

  it("shows a plain version number like v1.57", () => {
    render(<AppVersion />);
    expect(screen.getByRole("button").textContent).toMatch(/^v\d+(\.\d+)?$/);
  });

  it("says Up to date when the server has the same build", async () => {
    vi.mocked(fetchLiveVersion).mockResolvedValue("abc123-xyz");
    render(<AppVersion />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText(/Up to date/)).toBeInTheDocument());
    expect(freshReload).not.toHaveBeenCalled();
  });

  it("turns into Update when a newer build is live, and refreshes on the next click", async () => {
    vi.mocked(fetchLiveVersion).mockResolvedValue("def456-new");
    render(<AppVersion />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText(/Update/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button"));
    expect(freshReload).toHaveBeenCalledTimes(1);
  });

  it("says Offline? when the server cannot be read", async () => {
    vi.mocked(fetchLiveVersion).mockResolvedValue(null);
    render(<AppVersion />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText(/Offline/)).toBeInTheDocument());
  });

  it("formats a build time and tolerates a missing one", () => {
    expect(formatBuilt("2026-11-26T14:25:00.000Z")).toMatch(/2026/);
    expect(formatBuilt("")).toBe("");
    expect(formatBuilt("nonsense")).toBe("");
  });
});
