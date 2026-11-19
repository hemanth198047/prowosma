import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const summary = vi.fn();
const tasks = vi.fn();
vi.mock("../../api/dashboard", () => ({ getDashboardSummary: () => summary(), getDashboardMeetingPulse: () => Promise.resolve({ data: { todaysMeetings: [], carryForwardCounts: {}, recentlyCompleted: [] } }) }));
vi.mock("../../api/tasks", () => ({ getTasks: () => tasks() }));
vi.mock("../../api/workSessions", () => ({ getMyWork: () => Promise.resolve({ data: { running: null, todayMinutes: 95 } }), startWork: vi.fn(), stopWork: vi.fn() }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { name: "Bo Chen", email: "bo@demo.test" }, activeWorkspace: { id: "w1" } }) }));
vi.mock("../../context/PeopleContext", () => ({ usePeople: () => ({ byEmail: new Map([["bo@demo.test", { id: "m-bo", email: "bo@demo.test" }]]), ensureLoaded: () => {} }) }));
import Dashboard from "../../pages/Dashboard";

const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(12, 0, 0, 0); return d.toISOString(); };

describe("Dashboard - what needs me today", () => {
  beforeEach(() => {
    summary.mockResolvedValue({ data: { overdueCount: 3, projectsWithProgress: [{ id: "p1", name: "Wedding film", progress: 40, memberEmails: ["bo@demo.test"] }], activeGoalList: [] } });
    tasks.mockResolvedValue({ data: [
      { id: "t1", title: "Colour grade", status: "TODO", dueDate: day(-2), assigneeIds: ["m-bo"] },
      { id: "t2", title: "Export teaser", status: "IN_PROGRESS", dueDate: day(0), assigneeIds: ["m-bo"] },
      { id: "t3", title: "Someone else's", status: "TODO", dueDate: day(-1), assigneeIds: ["m-other"] },
      { id: "t4", title: "Finished", status: "DONE", dueDate: day(-5), assigneeIds: ["m-bo"] },
    ] });
  });

  it("shows my tasks, starting with what's overdue, and counts only mine", async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByText("My work")).toBeInTheDocument();
    const work = screen.getByRole("region", { name: "My work" });
    expect(await within(work).findByText("Colour grade")).toBeInTheDocument();
    expect(within(work).queryByText("Someone else's")).not.toBeInTheDocument();
    expect(within(work).queryByText("Finished")).not.toBeInTheDocument();
    fireEvent.click(within(work).getByRole("tab", { name: /Due today/ }));
    expect(within(work).getByText("Export teaser")).toBeInTheDocument();
    // the workspace-wide number is labelled as such
    expect(screen.getByText("3 tasks overdue in the workspace")).toBeInTheDocument();
  });

  it("has none of the old hub tiles, and shows today's tracked time and projects", async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByText("1 h 35 min tracked today")).toBeInTheDocument();
    expect(await screen.findAllByText("Wedding film")).not.toHaveLength(0);
    for (const gone of ["WORK HUB", "INSIGHTS HUB", "CONFIGURE", "QUICK ACTIONS", "AI Hub"]) expect(screen.queryByText(gone)).not.toBeInTheDocument();
  });
});
