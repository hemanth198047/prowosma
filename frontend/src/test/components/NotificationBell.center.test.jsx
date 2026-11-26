import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock("../../api/client", () => ({ default: api }));
vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("../../hooks/useConfirm", () => ({ useConfirm: () => () => Promise.resolve(true) }));
vi.mock("../../utils/push", () => ({ getPushState: () => Promise.resolve({ subscribed: false }) }));
vi.mock("../../utils/desktopNotify", () => ({
  desktopAllowed: () => false, awayFromApp: () => false, showDesktopNotification: () => Promise.resolve(false),
  notificationUrl: (n) => (n?.entityId ? `/tasks?highlight=${n.entityId}` : "/"),
}));
import NotificationBell from "../../components/NotificationBell";

const now = new Date().toISOString();
let count, list;
beforeEach(() => {
  document.title = "Prowosma";
  count = 3;
  list = [
    { id: "a", title: "Task Assigned", message: "Reel was assigned to you", read: false, category: "ASSIGNMENT", entityType: "TASK", entityId: "t1", createdAt: now },
    { id: "b", title: "Weekly digest", message: "Nothing urgent", read: false, category: "SYSTEM", type: "INFO", createdAt: now },
    { id: "c", title: "Old news", message: "m", read: true, category: "SYSTEM", type: "INFO", createdAt: now },
  ];
  api.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/count") ? { count } : list }));
  api.patch.mockResolvedValue({ data: {} });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const bell = () => render(<MemoryRouter><NotificationBell /></MemoryRouter>);

describe("notification centre", () => {
  it("writes the unread count on the bell itself, and in the browser tab title", async () => {
    bell();
    expect(await screen.findByText("3")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("(3) Prowosma"));
  });

  it("shows 99+ for a very large count", async () => {
    count = 250;
    bell();
    expect(await screen.findByText("99+")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("(99+) Prowosma"));
  });

  it("opens on what needs the person, with the next step on the row", async () => {
    bell();
    fireEvent.click(await screen.findByRole("button", { name: /Notifications, 3 unread/ }));
    expect(await screen.findByRole("tab", { name: /Needs action/, selected: true })).toBeInTheDocument();
    expect(await screen.findByText("Reel was assigned to you")).toBeInTheDocument();
    expect(screen.queryByText("Nothing urgent")).not.toBeInTheDocument();      // not an action item
    expect(screen.getByRole("button", { name: "Open task" })).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("marks a notification read from its row without opening it", async () => {
    bell();
    fireEvent.click(await screen.findByRole("button", { name: /Notifications, 3 unread/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark read" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/notifications/a/read"));
  });

  it("restores the tab title when there is nothing unread", async () => {
    count = 0;
    bell();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(document.title).toBe("Prowosma");
  });
});
