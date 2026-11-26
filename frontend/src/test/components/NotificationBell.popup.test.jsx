import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock("../../api/client", () => ({ default: api }));
vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("../../hooks/useConfirm", () => ({ useConfirm: () => () => Promise.resolve(true) }));
const pushState = vi.hoisted(() => vi.fn());
vi.mock("../../utils/push", () => ({ getPushState: () => pushState() }));
const notify = vi.hoisted(() => ({ show: vi.fn(), allowed: vi.fn(), away: vi.fn() }));
vi.mock("../../utils/desktopNotify", () => ({
  desktopAllowed: () => notify.allowed(), awayFromApp: () => notify.away(), showDesktopNotification: (n) => notify.show(n),
  notificationUrl: (n) => (n?.entityId ? `/tasks?highlight=${n.entityId}` : "/"),
}));
import NotificationBell from "../../components/NotificationBell";

let count, list;
beforeEach(() => {
  vi.useFakeTimers();
  count = 1; list = [{ id: "old", title: "Old one", message: "m", read: false, entityType: "TASK", entityId: "t0" }];
  notify.allowed.mockReturnValue(true); notify.away.mockReturnValue(true); notify.show.mockResolvedValue(true);
  pushState.mockResolvedValue({ subscribed: false });
  api.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/count") ? { count } : list }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

async function tick(ms) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

describe("NotificationBell pop-ups", () => {
  it("never pops up what was already there when the page opened", async () => {
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    await tick(100);
    expect(notify.show).not.toHaveBeenCalled();
  });

  it("pops up a notification that arrives while the person is away from the window, once", async () => {
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    await tick(100);
    list = [{ id: "new", title: "Task Status Changed", message: "Reel -> DONE", read: false, entityType: "TASK", entityId: "t9" }, ...list]; count = 2;
    await tick(15000);
    expect(notify.show).toHaveBeenCalledTimes(1);
    expect(notify.show).toHaveBeenCalledWith(expect.objectContaining({ title: "Task Status Changed", body: "Reel -> DONE", url: "/tasks?highlight=t9" }));
    await tick(15000);                                   // the same notification is not shown again
    expect(notify.show).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while the person is looking at Prowosma, and when pop-ups are not allowed", async () => {
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    await tick(100);
    notify.away.mockReturnValue(false);
    list = [{ id: "n1", title: "A", message: "", read: false }, ...list]; count = 2;
    await tick(15000);
    expect(notify.show).not.toHaveBeenCalled();
    notify.away.mockReturnValue(true); notify.allowed.mockReturnValue(false);
    list = [{ id: "n2", title: "B", message: "", read: false }, ...list]; count = 3;
    await tick(15000);
    expect(notify.show).not.toHaveBeenCalled();
  });

  it("folds a burst into one pop-up, and leaves assignments to the server's own push when this device has it", async () => {
    pushState.mockResolvedValue({ subscribed: true });
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    await tick(100);
    list = [{ id: "a", title: "Assigned to you", message: "", read: false, category: "ASSIGNMENT" }, ...list]; count = 2;
    await tick(15000);
    expect(notify.show).not.toHaveBeenCalled();
    list = ["b", "c", "d", "e"].map((id) => ({ id, title: `T${id}`, message: "", read: false })).concat(list); count = 6;
    await tick(15000);
    expect(notify.show).toHaveBeenCalledTimes(1);
    expect(notify.show).toHaveBeenCalledWith(expect.objectContaining({ title: "4 new notifications" }));
  });
});
