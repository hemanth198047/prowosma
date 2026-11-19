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

  it("keeps the header, shows compact projects / goals / tasks at the top, and drops Team, Configure and the meeting card", async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByText(/Bo/)).toBeInTheDocument();
    const projects = screen.getByRole("region", { name: "Active projects" });
    expect(within(projects).getAllByRole("listitem").length).toBe(5);         // 4 + "more"
    expect(within(projects).getByText("+2 more")).toBeInTheDocument();
    expect(within(projects).queryByText("Wedding film for the Sharmas")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Active goals" })).toHaveTextContent("Ship 10 films");
    expect(await within(screen.getByRole("region", { name: "Tasks" })).findByText("Colour grade")).toBeInTheDocument();
    for (const gone of ["TEAM", "CONFIGURE", "MEETING ASSISTANT", "WORK HUB"]) expect(screen.queryByText(gone)).not.toBeInTheDocument();
  });

  it("hubs and quick actions are icons with names; expanding shows full details in a side panel", async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText(/Bo/);
    for (const g of ["Work", "Insights", "Knowledge", "Automate", "Quick actions"]) expect(screen.getByRole("group", { name: g })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Work" })).getByRole("button", { name: /^Kanban/ })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Quick actions" })).getByRole("button", { name: "New task" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Show all active projects/ }));
    const panel = screen.getByRole("dialog", { name: "Active projects (6)" });
    expect(within(panel).getByText("Film 6")).toBeInTheDocument();
    expect(within(panel).getByText("Wedding film for the Sharmas")).toBeInTheDocument();
  });

  it("charts keep tasks, projects and goals", async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText(/Bo/);
    const charts = screen.getByRole("region", { name: "Charts" });
    expect(within(charts).getByText("25%")).toBeInTheDocument();          // 1 of 4 done
    fireEvent.click(within(charts).getByRole("tab", { name: "Goals" }));
    expect(within(charts).getByText("Ship 10 films")).toBeInTheDocument();
  });
});
