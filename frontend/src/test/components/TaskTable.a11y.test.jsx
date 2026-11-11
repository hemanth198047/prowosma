import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TaskTable from "../../components/TaskTable";

vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: vi.fn() }) }));

const tasks = [{ id: "t1", title: "Review hero visuals", status: "IN_PROGRESS", priority: "MEDIUM", projectId: "p1", assigneeIds: [], tags: [] }];

describe("TaskTable controls have names screen readers can announce", () => {
  it("names each row's checkbox and inline dropdowns after the task", () => {
    render(<TaskTable tasks={tasks} projects={[{ id: "p1", name: "Website relaunch" }]} teamMembers={[]}
      selectedIds={new Set()} toggleSelect={vi.fn()} onSelectAll={vi.fn()}
      onUpdate={vi.fn()} onDelete={vi.fn()} onOpenDrawer={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Select all tasks" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Review hero visuals" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status of Review hero visuals" })).toHaveValue("IN_PROGRESS");
    expect(screen.getByRole("combobox", { name: "Priority of Review hero visuals" })).toHaveValue("MEDIUM");
    expect(screen.getByRole("combobox", { name: "Project of Review hero visuals" })).toHaveValue("p1");
  });
});
