import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../api/tasks", () => ({ getTasks: vi.fn(), createTask: vi.fn(), updateTask: vi.fn(), patchTask: vi.fn(), deleteTask: vi.fn() }));
vi.mock("../../api/projects", () => ({ getProjects: vi.fn() }));
vi.mock("../../api/team", () => ({ getTeamMembers: vi.fn() }));
vi.mock("../../api/goals", () => ({ getGoals: vi.fn(), toggleStep: vi.fn(), deleteStep: vi.fn(), addStep: vi.fn(), updateSubGoal: vi.fn(), addStepComment: vi.fn(), deleteStepComment: vi.fn(), addStepAttachment: vi.fn(), deleteStepAttachment: vi.fn(), addStepDependency: vi.fn(), removeStepDependency: vi.fn() }));
vi.mock("../../api/docs", () => ({ getDocs: vi.fn() }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { email: "me@x.com" }, activeWorkspace: { id: "ws1" } }) }));
const toast = vi.fn();
vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: toast }) }));
vi.mock("../../components/TaskComments", () => ({ default: () => null }));
vi.mock("../../components/TimeTracker", () => ({ default: () => null }));
vi.mock("../../components/FileAttachments", () => ({ default: () => null }));
vi.mock("../../components/TaskDependencies", () => ({ default: () => null }));
vi.mock("../../components/IntegrationPanel", () => ({ default: () => null }));
vi.mock("../../components/CustomFieldValues", () => ({ default: () => null }));
vi.mock("../../components/TaskHistory", () => ({ default: () => null }));
vi.mock("../../components/TaskTable", () => ({ default: () => null }));

import * as tasksApi from "../../api/tasks";
import * as projectsApi from "../../api/projects";
import * as teamApi from "../../api/team";
import * as goalsApi from "../../api/goals";
import * as docsApi from "../../api/docs";
import Tasks from "../../pages/Tasks";

const MEMBERS = [{ id: "m1", name: "Maya Rao", email: "maya@x.com" }, { id: "m2", name: "Ravi K", email: "ravi@x.com" }];
const TASK = { id: "t1", title: "Edit the reel", status: "TODO", priority: "MEDIUM", assigneeIds: [], tags: [] };

const open = async () => {
  render(<MemoryRouter><Tasks /></MemoryRouter>);
  const row = await screen.findByRole("button", { name: "Edit the reel" });
  return row.closest("li");
};

beforeEach(() => {
  tasksApi.getTasks.mockResolvedValue({ data: [TASK] });
  projectsApi.getProjects.mockResolvedValue({ data: [] });
  teamApi.getTeamMembers.mockResolvedValue({ data: MEMBERS });
  goalsApi.getGoals.mockResolvedValue({ data: [] });
  docsApi.getDocs.mockResolvedValue({ data: [] });
  tasksApi.updateTask.mockResolvedValue({ data: TASK });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function openFullForm() {
  const li = await open();
  fireEvent.click(within(li).getByRole("button", { name: /More actions for Edit the reel/ }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Edit in full form/ }));
  return screen.findByRole("heading", { name: "Edit Task" });
}

describe("Tasks: assigning people", () => {
  it("the full edit form lists the team so someone can be assigned", async () => {
    await openFullForm();
    const group = screen.getByRole("group", { name: "Assignees" });
    expect(within(group).getByLabelText("Maya Rao")).not.toBeChecked();
    expect(within(group).getByLabelText("Ravi K")).toBeInTheDocument();
  });

  it("saving the form stores the assignees, which the basic save alone would drop", async () => {
    tasksApi.patchTask.mockResolvedValue({ data: { ...TASK, assigneeIds: ["m1"] } });
    await openFullForm();
    fireEvent.click(screen.getByLabelText("Maya Rao"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(tasksApi.patchTask).toHaveBeenCalled());
    expect(tasksApi.updateTask).toHaveBeenCalledWith("t1", expect.any(Object));
    expect(tasksApi.patchTask.mock.calls[0][0]).toBe("t1");
    expect(tasksApi.patchTask.mock.calls[0][1].assigneeIds).toEqual(["m1"]);
  });

  it("says so when the assignees could not be saved, and keeps the form open", async () => {
    tasksApi.patchTask.mockRejectedValue({ response: { status: 403, data: { message: "You can't assign tasks." } } });
    await openFullForm();
    fireEvent.click(screen.getByLabelText("Ravi K"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("You can't assign tasks."), "error"));
    expect(screen.getByRole("heading", { name: "Edit Task" })).toBeInTheDocument();
  });

  it("an assignment made in the side panel shows on the list straight away", async () => {
    tasksApi.patchTask.mockResolvedValue({ data: { ...TASK, assigneeIds: ["m1"] } });
    const li = await open();
    expect(within(li).getByText("Unassigned")).toBeInTheDocument();
    fireEvent.click(within(li).getByRole("button", { name: /More actions for Edit the reel/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Quick view/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Assignees/ }));
    fireEvent.click(await screen.findByLabelText(/Maya Rao/));
    await waitFor(() => expect(tasksApi.patchTask).toHaveBeenCalledWith("t1", { assigneeIds: ["m1"] }));
    await waitFor(() => expect(within(li).queryByText("Unassigned")).not.toBeInTheDocument());
  });

  it("when the server did not keep the assignment, it says so and reloads instead of pretending", async () => {
    tasksApi.patchTask.mockResolvedValue({ data: { ...TASK, assigneeIds: [] } });   // 200, but nothing was stored
    const li = await open();
    fireEvent.click(within(li).getByRole("button", { name: /More actions for Edit the reel/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Quick view/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Assignees/ }));
    fireEvent.click(await screen.findByLabelText(/Maya Rao/));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("The assignment was not saved. Please try again.", "error"));
    expect(within(li).getByText("Unassigned")).toBeInTheDocument();
  });
});
