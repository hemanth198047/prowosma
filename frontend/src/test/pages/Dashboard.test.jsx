import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const summary = vi.fn();
vi.mock("../../api/dashboard", () => ({
  getDashboardSummary: () => summary(),
  getDashboardMeetingPulse: () => Promise.resolve({ data: { todaysMeetings: [], carryForwardCounts: {}, recentlyCompleted: [] } }),
}));
vi.mock("../../api/tasks", () => ({ getTasks: () => Promise.resolve({ data: [{ id: "t1", title: "Colour grade", status: "IN_PROGRESS", projectId: "p1" }] }) }));
vi.mock("../../api/client", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { name: "Bo Chen" }, activeWorkspace: { id: "w1" } }) }));
vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: vi.fn() }) }));
const attendance = vi.hoisted(() => ({ me: vi.fn(), status: vi.fn(), clockIn: vi.fn() }));
vi.mock("../../api/attendance", () => ({
  getAttendanceStatus: () => attendance.status(), getMyAttendance: () => attendance.me(), clockIn: (b) => attendance.clockIn(b),
  clockOut: vi.fn(), startBreak: vi.fn(), endBreak: vi.fn(), reportIdle: vi.fn(),
}));
vi.mock("../../api/projects", () => ({ getProjects: () => Promise.resolve({ data: [] }) }));
vi.mock("recharts", () => {
  const Box = ({ children }) => <div>{children}</div>;
  return { ResponsiveContainer: Box, PieChart: Box, Pie: Box, Cell: () => null, Tooltip: () => null };
});
import Dashboard from "../../pages/Dashboard";

const PROJECTS = Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}`, name: `Film ${i + 1}`, progress: 10 * i, status: "ACTIVE", description: i === 0 ? "Wedding film for the Sharmas" : "" }));

describe("Dashboard", () => {
  beforeEach(() => {
    attendance.status.mockResolvedValue({ data: { enabled: true } });
    attendance.me.mockResolvedValue({ data: { state: "OFF", log: null, date: "2026-11-26", timezone: "UTC", shift: { start: "10:00", end: "19:00", graceMinutes: 15 },
      today: { dayType: "WORKDAY", onLeave: false, expectedStart: "2000-01-01T10:00:00Z", graceMinutes: 15 }, rules: { askWorkMode: false, locationMode: "OFF", workModes: ["IN_OFFICE", "REMOTE"] } } });
    attendance.clockIn.mockResolvedValue({ data: { state: "WORKING", log: { sessions: [{ in: new Date().toISOString() }], breaks: [] }, today: {}, rules: { locationMode: "OFF" } } });
  });
  beforeEach(() => summary.mockResolvedValue({ data: {
    totalTasks: 4, todoTasks: 2, inProgressTasks: 1, doneTasks: 1, totalProjects: 6,
    projectsWithProgress: PROJECTS, activeGoalList: [{ id: "g1", title: "Ship 10 films", progress: 40, status: "ACTIVE" }],
  } }));

  it("keeps the header and puts projects, goals and tasks in one card with tabs; no Team / Configure / meeting card / status banner", async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
    const work = screen.getByRole("region", { name: "Work overview" });
    expect(within(work).getByRole("tab", { name: /Projects/ })).toHaveAttribute("aria-selected", "true");
    expect(within(work).getByText("Film 1")).toBeInTheDocument();
    expect(within(work).queryByText("Wedding film for the Sharmas")).not.toBeInTheDocument();
    fireEvent.click(within(work).getByRole("tab", { name: /Goals/ }));
    expect(within(work).getByText("Ship 10 films")).toBeInTheDocument();
    fireEvent.click(within(work).getByRole("tab", { name: /Tasks/ }));
    expect(await within(work).findByText("Colour grade")).toBeInTheDocument();
    for (const gone of ["TEAM", "CONFIGURE", "MEETING ASSISTANT", "WORK HUB", "Loading workspace status…"]) expect(screen.queryByText(gone)).not.toBeInTheDocument();
  });

  it("shortcuts sit in tabs, each option named (what it is for in a tooltip); expanding shows the full details in a side panel", async () => {
    try { localStorage.removeItem("prowosma.dashboard.shortcutTab"); } catch { /* storage blocked */ }
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Today" });
    const shortcuts = screen.getByRole("region", { name: "Shortcuts" });
    for (const g of ["Work", "Insights", "Knowledge", "Automate", "Quick actions"]) expect(within(shortcuts).getByRole("tab", { name: new RegExp(`^${g}`) })).toBeInTheDocument();
    expect(within(shortcuts).getByRole("tab", { name: /^Work/ })).toHaveAttribute("aria-selected", "true");
    const work = within(shortcuts).getByRole("group", { name: "Work" });
    expect(within(work).getByText("Kanban")).toBeVisible();
    const gantt = within(work).getByRole("button", { name: "Gantt - Timeline of tasks and goals" });
    fireEvent.mouseEnter(gantt.parentElement);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Timeline of tasks and goals");
    expect(within(shortcuts).queryByRole("group", { name: "Quick actions" })).not.toBeInTheDocument();

    fireEvent.click(within(shortcuts).getByRole("tab", { name: "Quick actions" }));
    expect(within(shortcuts).getByRole("tab", { name: "Quick actions" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("group", { name: "Quick actions" })).getByRole("button", { name: "New task - Add a task" })).toBeInTheDocument();
    fireEvent.keyDown(within(shortcuts).getByRole("tab", { name: "Quick actions" }), { key: "ArrowRight" });
    expect(within(shortcuts).getByRole("tab", { name: /^Work/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: /Show all projects in detail/ }));
    const panel = screen.getByRole("dialog", { name: "Active projects (6)" });
    expect(within(panel).getByText("Film 6")).toBeInTheDocument();
    expect(within(panel).getByText("Wedding film for the Sharmas")).toBeInTheDocument();
  });

  it("charts keep tasks, projects and goals", async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Today" });
    const charts = screen.getByRole("region", { name: "Charts" });
    expect(within(charts).getByText("25%")).toBeInTheDocument();          // 1 of 4 done
    fireEvent.click(within(charts).getByRole("tab", { name: "Goals" }));
    expect(within(charts).getByText("Ship 10 films")).toBeInTheDocument();
  });

  it("shows Attendance to everyone, reminds a person who has not clocked in, and clocks in from the dashboard", async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const card = await screen.findByRole("region", { name: "Attendance" });
    expect(await within(card).findByRole("alert")).toHaveTextContent("You haven't clocked in yet");
    fireEvent.click(within(card).getByRole("button", { name: /Clock in/ }));
    await vi.waitFor(() => expect(attendance.clockIn).toHaveBeenCalled());
    expect(await within(card).findByText(/Clocked in/)).toBeInTheDocument();
    expect(within(card).queryByRole("alert")).not.toBeInTheDocument();
  });
});
