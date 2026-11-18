import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const status = vi.fn();
vi.mock("../../api/attendance", () => ({ getAttendanceStatus: () => status() }));
vi.mock("../../api/aiMeetingAssistant", () => ({ getUmaStatus: () => Promise.resolve({ data: { enabled: false } }) }));
vi.mock("../../components/WorkspaceSwitcher", () => ({ default: () => null }));
vi.mock("../../components/SidebarBadge", () => ({ default: () => null }));
import SidebarNav from "../../components/shell/SidebarNav";
import { resetAttendanceEnabled } from "../../hooks/useAttendance";

describe("sidebar: Attendance item under People", () => {
  beforeEach(() => { status.mockReset(); resetAttendanceEnabled(); });

  it("is hidden while the attendance flag is off", async () => {
    status.mockResolvedValue({ data: { enabled: false } });
    render(<MemoryRouter><SidebarNav /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "People" }));
    expect(await screen.findByText("Members")).toBeInTheDocument();
    await Promise.resolve();
    expect(screen.queryByText("Attendance")).not.toBeInTheDocument();
  });

  it("appears under People when the flag is on", async () => {
    status.mockResolvedValue({ data: { enabled: true } });
    render(<MemoryRouter><SidebarNav /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "People" }));
    expect(await screen.findByText("Attendance")).toBeInTheDocument();
  });
});
