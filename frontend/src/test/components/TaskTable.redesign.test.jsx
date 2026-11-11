import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TaskTable from "../../components/TaskTable";

vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: vi.fn() }) }));

const future = new Date(Date.now() + 5 * 864e5).toISOString();
const past = new Date(Date.now() - 5 * 864e5).toISOString();
const tasks = [
  { id: "t1", title: "Review hero visuals", status: "IN_PROGRESS", priority: "MEDIUM", projectId: "p1", dueDate: past, assigneeIds: ["m1"], tags: ["design"] },
  { id: "t2", title: "Ship release", status: "DONE", priority: "HIGH", projectId: "p1", dueDate: past, assigneeIds: [], tags: [] },
  { id: "t3", title: "Plan sprint", status: "TODO", priority: "LOW", projectId: "", dueDate: future, assigneeIds: [], tags: [] },
];
const props = (over = {}) => ({
  tasks, projects: [{ id: "p1", name: "Website relaunch" }], teamMembers: [{ id: "m1", name: "Priya Nair" }],
  selectedIds: new Set(), toggleSelect: vi.fn(), onSelectAll: vi.fn(),
  onUpdate: vi.fn().mockResolvedValue(), onDelete: vi.fn(), onOpenDrawer: vi.fn(), ...over,
});

describe("TaskTable (redesign keeps behaviour)", () => {
  it("shows readable labels but saves the same stored values", () => {
    const p = props();
    render(<TaskTable {...p} />);
    const status = screen.getAllByLabelText("Status")[0];
    expect(status).toHaveDisplayValue("In progress");
    fireEvent.change(status, { target: { value: "DONE" } });
    expect(p.onUpdate).toHaveBeenCalledWith("t1", { status: "DONE" });
    const priority = screen.getAllByLabelText("Priority")[0];
    expect(priority).toHaveDisplayValue("Medium");
    fireEvent.change(priority, { target: { value: "HIGH" } });
    expect(p.onUpdate).toHaveBeenCalledWith("t1", { priority: "HIGH" });
  });

  it("marks overdue open tasks, but not finished ones", () => {
    render(<TaskTable {...props()} />);
    expect(screen.getAllByLabelText("Due date (overdue)")).toHaveLength(1);
  });

  it("keeps row actions reachable by name", () => {
    const p = props();
    render(<TaskTable {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Open details for Review hero visuals" }));
    expect(p.onOpenDrawer).toHaveBeenCalledWith(tasks[0]);
    fireEvent.click(screen.getByRole("button", { name: "Delete Plan sprint" }));
    expect(p.onDelete).toHaveBeenCalledWith("t3");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all tasks" }));
    expect(p.onSelectAll).toHaveBeenCalledWith(true);
  });

  it("names assignees for screen readers", () => {
    render(<TaskTable {...props()} />);
    expect(screen.getByRole("button", { name: "Assignees: Priya Nair. Change" })).toBeInTheDocument();
  });

  it("sorts from the column header and reports the sort state", () => {
    render(<TaskTable {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /Task/ }));
    expect(screen.getByRole("columnheader", { name: /Task/ })).toHaveAttribute("aria-sort", "ascending");
  });
});
