import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const get = vi.fn();
vi.mock("../../api/client", () => ({ default: { get: (...a) => get(...a) } }));
import TaskHistory from "../../components/TaskHistory";

const iso = (daysAgo, h = 10) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, 0, 0, 0); return d.toISOString().replace("Z", ""); };
const ENTRIES = [
  { id: "1", at: iso(0, 11), action: "TASK_COMMENTED", kind: "COMMENT", by: "bo@x.test", byName: "Bo Chen", newValue: "Audio needs a fix" },
  { id: "2", at: iso(0, 9), action: "TASK_STATUS_CHANGED", kind: "STATUS", by: "alex@x.test", byName: "Alex Morgan", oldValue: "TODO", newValue: "IN_PROGRESS" },
  { id: "3", at: iso(3), action: "TASK_ASSIGNED", kind: "ASSIGNMENT", by: "alex@x.test", byName: "Alex Morgan", newValue: "Bo Chen" },
  { id: "4", at: iso(20), action: "TASK_DUE_CHANGED", kind: "DUE", by: "alex@x.test", byName: "Alex Morgan", oldValue: null, newValue: "27 Nov 2026" },
  { id: "5", at: iso(40), action: "TASK_CREATED", kind: "CREATED", by: "alex@x.test", byName: "Alex Morgan", newValue: "Edit film" },
];

describe("TaskHistory window", () => {
  beforeEach(() => { get.mockReset(); get.mockResolvedValue({ data: { entries: ENTRIES } }); });

  const open = async () => {
    render(<TaskHistory task={{ id: "t1", title: "Edit film" }} onClose={() => {}} />);
    await screen.findByText(/Audio needs a fix/);
    return screen.getByRole("dialog");
  };

  it("reads as plain sentences, grouped by day, newest first", async () => {
    const d = await open();
    expect(get).toHaveBeenCalledWith("/activity-logs/task/t1", expect.anything());
    expect(within(d).getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(d.textContent).toMatch(/Alex Morgan changed the status from To ?do to In progress/i);
    expect(d.textContent).toContain("set the due date to 27 Nov 2026");
    expect(within(d).getByText("5 changes")).toBeInTheDocument();
  });

  it("filters by person, type, time and search, and clears", async () => {
    const d = await open();
    fireEvent.change(within(d).getByLabelText("Person"), { target: { value: "bo@x.test" } });
    expect(within(d).getByText("Showing 1 of 5")).toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: "Clear filters" }));

    fireEvent.click(within(d).getByRole("button", { name: /Status/ }));
    fireEvent.click(within(d).getByRole("button", { name: /Assignment/ }));
    expect(within(d).getByText("Showing 2 of 5")).toBeInTheDocument();
    fireEvent.click(within(d).getAllByRole("button", { name: "Clear filters" })[0]);

    fireEvent.change(within(d).getByLabelText("When"), { target: { value: "7" } });
    expect(within(d).getByText("Showing 3 of 5")).toBeInTheDocument();
    fireEvent.change(within(d).getByLabelText("When"), { target: { value: "any" } });

    fireEvent.change(within(d).getByLabelText("Search the history"), { target: { value: "audio" } });
    expect(within(d).getByText("Showing 1 of 5")).toBeInTheDocument();
    fireEvent.change(within(d).getByLabelText("Search the history"), { target: { value: "zzz" } });
    expect(within(d).getByText("Nothing matches these filters.")).toBeInTheDocument();
  });

  it("can show oldest first", async () => {
    const d = await open();
    fireEvent.change(within(d).getByLabelText("Order"), { target: { value: "old" } });
    const items = within(d).getAllByRole("listitem");
    expect(items[0].textContent).toContain("created the task");
  });
});
