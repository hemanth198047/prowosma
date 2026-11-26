// SIMULATED: the API is mocked. These tests check what the top-bar clock shows and sends; the rules themselves are covered by the backend tests.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const toastShow = vi.fn();
vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: toastShow }) }));
vi.mock("../../api/projects", () => ({ getProjects: () => Promise.resolve({ data: [{ id: "p1", name: "Ad shoot", status: "ACTIVE" }] }) }));
const api = vi.hoisted(() => ({
  getAttendanceStatus: vi.fn(), getMyAttendance: vi.fn(), clockIn: vi.fn(), clockOut: vi.fn(), startBreak: vi.fn(), endBreak: vi.fn(), reportIdle: vi.fn(),
}));
vi.mock("../../api/attendance", () => api);

const desktop = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock("../../utils/desktopNotify", () => ({ showDesktopNotification: (n) => desktop.show(n) }));
import ClockWidget from "../../components/ClockWidget";
import { resetAttendanceEnabled, resetMyAttendance } from "../../hooks/useAttendance";

const rules = { askWorkMode: true, locationMode: "OFF", idleMinutes: 0, idleAction: "REMIND", endOfDayReminderMinutes: 15,
  workModes: ["IN_OFFICE", "REMOTE", "ON_LOCATION"], breakTypes: ["LUNCH", "TEA", "OTHER"] };
const later = (h) => new Date(Date.now() + h * 3600000).toISOString();
const me = (over = {}) => ({
  state: "OFF", log: null, date: "2026-11-18", timezone: "UTC",
  shift: { name: "Standard", start: "10:00", end: "19:00", days: ["MON"], graceMinutes: 15 },
  today: { dayType: "WORKDAY", expectedStart: later(1), expectedEnd: later(9), graceMinutes: 15, onLeave: false },
  rules, canManage: false, isManager: false, ...over,
});
const working = (over = {}) => me({
  state: "WORKING",
  log: { id: "l1", workMode: "REMOTE", sessions: [{ in: new Date(Date.now() - 3723000).toISOString() }], breaks: [], late: false },
  ...over,
});

const show = () => render(<MemoryRouter><ClockWidget /></MemoryRouter>);

describe("top-bar clock", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    toastShow.mockReset();
    resetAttendanceEnabled();
    resetMyAttendance();
    api.getAttendanceStatus.mockResolvedValue({ data: { enabled: true } });
  });
  afterEach(() => vi.useRealTimers());

  it("shows nothing while the attendance flag is off", async () => {
    api.getAttendanceStatus.mockResolvedValue({ data: { enabled: false } });
    const { container } = show();
    await waitFor(() => expect(api.getAttendanceStatus).toHaveBeenCalled());
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    expect(api.getMyAttendance).not.toHaveBeenCalled();
  });

  it("when the start time has passed and you have not clocked in, it pops up on the desktop and says so on screen, once", async () => {
    desktop.show.mockReset(); try { sessionStorage.clear(); } catch { /* ignore */ }
    api.getMyAttendance.mockResolvedValue({ data: me({ today: { dayType: "WORKDAY", expectedStart: new Date(Date.now() - 3600000).toISOString(), expectedEnd: later(8), graceMinutes: 15, onLeave: false } }) });
    show();
    await waitFor(() => expect(desktop.show).toHaveBeenCalledTimes(1));
    expect(desktop.show).toHaveBeenCalledWith(expect.objectContaining({ title: "You haven't clocked in", url: "/attendance" }));
    expect(toastShow).toHaveBeenCalledWith(expect.stringContaining("You haven't clocked in yet"), "error");
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
    expect(desktop.show).toHaveBeenCalledTimes(1);
  });

  it("asks where you're working before clocking in, then sends it with the project", async () => {
    api.getMyAttendance.mockResolvedValue({ data: me() });
    api.clockIn.mockResolvedValue({ data: working() });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Clock in/ }).at(-1));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose where you're working today.");
    expect(api.clockIn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Remote / WFH"));
    await screen.findByRole("option", { name: "Ad shoot" });
    fireEvent.change(screen.getByLabelText(/Project/), { target: { value: "p1" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Clock in/ }).at(-1));
    await waitFor(() => expect(api.clockIn).toHaveBeenCalledWith({ workMode: "REMOTE", projectId: "p1" }));
    expect(await screen.findByRole("button", { name: /Clocked in, 01:02:0\d worked today/ })).toBeInTheDocument();
  });

  it("while working: shows the shift timer, starts a lunch break and clocks out", async () => {
    api.getMyAttendance.mockResolvedValue({ data: working() });
    api.startBreak.mockResolvedValue({ data: me({ state: "ON_BREAK", log: { ...working().log, breaks: [{ type: "LUNCH", start: new Date().toISOString() }] } }) });
    api.clockOut.mockResolvedValue({ data: me({ log: working().log }) });
    show();
    const pill = await screen.findByRole("button", { name: /Clocked in/ });
    expect(pill).toHaveTextContent(/01:02:0\d/);
    fireEvent.click(pill);
    expect(screen.getByText("Remote / WFH")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lunch" }));
    await waitFor(() => expect(api.startBreak).toHaveBeenCalledWith("LUNCH"));
    fireEvent.click(await screen.findByRole("button", { name: "Clock out" }));
    await waitFor(() => expect(api.clockOut).toHaveBeenCalledWith({}));
  });

  it("on a break: ends the break", async () => {
    api.getMyAttendance.mockResolvedValue({ data: me({ state: "ON_BREAK", log: { ...working().log, breaks: [{ type: "TEA", start: new Date().toISOString() }] } }) });
    api.endBreak.mockResolvedValue({ data: working() });
    show();
    fireEvent.click(await screen.findByRole("button", { name: /On a Tea \/ coffee/ }));
    fireEvent.click(screen.getByRole("button", { name: "End break" }));
    await waitFor(() => expect(api.endBreak).toHaveBeenCalledWith(false));
  });

  it("shows the server's refusal in plain words", async () => {
    api.getMyAttendance.mockResolvedValue({ data: me({ rules: { ...rules, askWorkMode: false } }) });
    api.clockIn.mockRejectedValue({ response: { status: 409, data: { code: "ALREADY_CLOCKED_IN", message: "You're already clocked in. Clock out first." } } });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Clock in/ }).at(-1));
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith("You're already clocked in. Clock out first.", "error"));
  });

  it("asks 'still working?' after the workspace's idle minutes without activity", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });   // the test library's own waiting keeps real timeouts
    api.getMyAttendance.mockResolvedValue({ data: working({ rules: { ...rules, idleMinutes: 1 } }) });
    show();
    await screen.findByRole("button", { name: /Clocked in/ });
    await act(async () => { await vi.advanceTimersByTimeAsync(80000); });
    expect(await screen.findByRole("alertdialog", { name: "Are you still working?" })).toBeInTheDocument();
    expect(api.reportIdle).not.toHaveBeenCalled();
  });

  it("with 'pause' rules, reports the idle time back-dated to the last activity", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });   // the test library's own waiting keeps real timeouts
    api.getMyAttendance.mockResolvedValue({ data: working({ rules: { ...rules, idleMinutes: 1, idleAction: "PAUSE" } }) });
    api.reportIdle.mockResolvedValue({ data: working() });
    show();
    await screen.findByRole("button", { name: /Clocked in/ });
    const before = Date.now();
    // Keep the clock moving until the check fires (under a busy test run the first tick can land late).
    await act(async () => { await vi.advanceTimersByTimeAsync(80000); });
    await waitFor(() => expect(api.reportIdle).toHaveBeenCalledTimes(1));
    const since = Date.parse(api.reportIdle.mock.calls[0][0]);
    expect(since).toBeLessThanOrEqual(before + 1000);
  });

  it("reminds once when the shift has ended and you're still clocked in", async () => {
    api.getMyAttendance.mockResolvedValue({ data: working({ today: { dayType: "WORKDAY", expectedStart: later(-10), expectedEnd: later(-1), graceMinutes: 15 } }) });
    try { sessionStorage.clear(); } catch { /* ignore */ }
    show();
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith(expect.stringContaining("Your shift has ended"), "info"));
    fireEvent.click(screen.getByRole("button", { name: /Clocked in/ }));
    expect(screen.getByText(/Your shift ended at/)).toBeInTheDocument();
  });
});
