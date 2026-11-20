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
vi.mock("recharts", () => {
  const Box = ({ children }) => <div>{children}</div>;
  return { ResponsiveContainer: Box, PieChart: Box, Pie: Box, Cell: () => null, Tooltip: () => null };
});
import Dashboard from "../../pages/Dashboard";

const PROJECTS = Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}`, name: `Film ${i + 1}`, progress: 10 * i, status: "ACTIVE", description: i === 0 ? "Wedding film for the Sharmas" : "" }));

describe("Dashboard", () => {
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

  it("shortcut icons have names and tooltips; expanding shows the full details in a side panel", async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Today" });
    for (const g of ["Work", "Insights", "Knowledge", "Automate", "Quick actions"]) expect(screen.getByRole("group", { name: g })).toBeInTheDocument();
    const kanban = within(screen.getByRole("group", { name: "Work" })).getByRole("button", { name: /^Kanban/ });
    fireEvent.mouseEnter(kanban.parentElement);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Kanban");
    expect(within(screen.getByRole("group", { name: "Quick actions" })).getByRole("button", { name: "New task" })).toBeInTheDocument();

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
});
