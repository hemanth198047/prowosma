// SIMULATED: the API is mocked. These tests check what the Attendance page shows and sends; the rules are covered by the backend tests.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const toastShow = vi.fn();
vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: toastShow }) }));
vi.mock("../../hooks/useConfirm", () => ({ useConfirm: () => () => Promise.resolve(true) }));
vi.mock("../../api/projects", () => ({ getProjects: () => Promise.resolve({ data: [{ id: "p1", name: "Ad shoot" }] }) }));
vi.mock("../../api/team", () => ({ getTeamMembers: () => Promise.resolve({ data: [{ id: "t1", name: "Asha", email: "asha@x.com" }, { id: "t2", name: "Bo", email: "bo@x.com" }] }) }));
const api = vi.hoisted(() => Object.fromEntries([
  "getAttendanceStatus", "getMyAttendance", "getMyLogs", "getMyRequests", "getBalances", "getMyCallTimes", "requestCorrection", "requestLeave",
  "cancelRequest", "claimOvertime", "getApprovals", "decideRequest", "decideOvertime", "getReport", "exportReport", "getFloor",
  "getAttendanceSettings", "saveAttendanceSettings", "addShift", "saveShift", "deleteShift", "getCallTimes", "addCallTime", "deleteCallTime",
  "clockIn", "clockOut", "startBreak", "endBreak", "reportIdle",
].map((k) => [k, vi.fn()])));
vi.mock("../../api/attendance", () => api);

import Attendance from "../../pages/Attendance";
import { resetAttendanceEnabled, resetMyAttendance } from "../../hooks/useAttendance";

const me = (over = {}) => ({ data: {
  state: "OFF", log: null, date: "2026-11-18", timezone: "UTC", shift: { name: "Standard", start: "10:00", end: "19:00", days: ["MON"], graceMinutes: 15 },
  today: { dayType: "WORKDAY" }, rules: { locationMode: "OFF", idleMinutes: 0 }, canManage: false, isManager: false, ...over,
} });
const sundayLog = { id: "l7", date: "2026-11-15", dayType: "WEEKEND", state: "OFF", workMode: "ON_LOCATION", projectName: "Ad shoot",
  sessions: [{ in: "2026-11-15T09:00:00Z", out: "2026-11-15T16:00:00Z" }], breaks: [], workedMinutes: 420, breakMinutes: 0,
  overtimeMinutes: 420, overtimeStatus: "NONE", late: false, lateMinutes: 0, autoClosed: false, compOffEarned: 0 };
const missedOut = { ...sundayLog, id: "l8", date: "2026-11-17", dayType: "WORKDAY", autoClosed: true, overtimeMinutes: 0, late: true, lateMinutes: 22 };
const balances = { CASUAL: { total: 12, used: 1, pending: 0, left: 11 }, SICK: { total: 12, used: 0, pending: 0, left: 12 },
  EARNED: { total: 15, used: 0, pending: 0, left: 15 }, COMP_OFF: { total: 0, used: 0, pending: 0, left: 0 } };

const show = () => render(<MemoryRouter><Attendance /></MemoryRouter>);

describe("Attendance page", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    toastShow.mockReset();
    resetAttendanceEnabled();
    resetMyAttendance();
    api.getAttendanceStatus.mockResolvedValue({ data: { enabled: true } });
    api.getMyAttendance.mockResolvedValue(me());
    api.getMyLogs.mockResolvedValue({ data: [missedOut, sundayLog] });
    api.getMyRequests.mockResolvedValue({ data: [{ id: "r1", kind: "LEAVE", leaveType: "CASUAL", fromDate: "2026-11-20", toDate: "2026-11-20", days: 1, status: "PENDING" }] });
    api.getBalances.mockResolvedValue({ data: balances });
    api.getMyCallTimes.mockResolvedValue({ data: [] });
  });

  it("explains how to turn it on while the flag is off", async () => {
    api.getAttendanceStatus.mockResolvedValue({ data: { enabled: false } });
    show();
    expect(await screen.findByText("Attendance isn't turned on")).toBeInTheDocument();
  });

  it("a member sees only their own time: logs, late and missed clock-out, balances and requests", async () => {
    show();
    expect(await screen.findByRole("tab", { name: "My time" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Who's in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Approvals" })).not.toBeInTheDocument();
    expect(await screen.findByText("Late 22 min")).toBeInTheDocument();
    expect(screen.getByText("Clock-out missed")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();                      // casual leave left
    expect(screen.getByText(/Casual leave · 2026-11-20/)).toBeInTheDocument();
  });

  it("claims overtime and cancels a pending request", async () => {
    api.claimOvertime.mockResolvedValue({ data: {} });
    api.cancelRequest.mockResolvedValue({ data: {} });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Claim overtime" }));
    await waitFor(() => expect(api.claimOvertime).toHaveBeenCalledWith("l7", ""));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(api.cancelRequest).toHaveBeenCalledWith("r1"));
  });

  it("fixes a missed clock-out from the log row, sending only the time given", async () => {
    api.requestCorrection.mockResolvedValue({ data: {} });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Fix clock-out" }));
    const dlg = screen.getByRole("dialog", { name: "Fix a missed punch" });
    expect(within(dlg).getByLabelText("Date")).toHaveValue("2026-11-17");
    fireEvent.change(within(dlg).getByLabelText(/Clock-out time/), { target: { value: "19:30" } });
    fireEvent.change(within(dlg).getByLabelText(/Why was it missed/), { target: { value: "Forgot" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Send for approval" }));
    await waitFor(() => expect(api.requestCorrection).toHaveBeenCalledWith({ date: "2026-11-17", clockIn: null, clockOut: "19:30", reason: "Forgot" }));
  });

  it("requests a half day of sick leave", async () => {
    api.requestLeave.mockResolvedValue({ data: {} });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Request leave" }));
    const dlg = screen.getByRole("dialog", { name: "Request leave" });
    fireEvent.change(within(dlg).getByLabelText("Type"), { target: { value: "SICK" } });
    fireEvent.change(within(dlg).getByLabelText("From"), { target: { value: "2026-11-24" } });
    fireEvent.click(within(dlg).getByLabelText("Half a day"));
    fireEvent.click(within(dlg).getByRole("button", { name: "Request" }));
    await waitFor(() => expect(api.requestLeave).toHaveBeenCalledWith(expect.objectContaining({ leaveType: "SICK", fromDate: "2026-11-24", toDate: "2026-11-24", halfDay: true })));
  });

  it("shows the server's refusal inside the dialog", async () => {
    api.requestLeave.mockRejectedValue({ response: { status: 409, data: { code: "NOT_ENOUGH_BALANCE", message: "You have 0 day(s) of comp-off left, and this needs 1." } } });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Request leave" }));
    const dlg = screen.getByRole("dialog", { name: "Request leave" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Request" }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("You have 0 day(s) of comp-off left");
  });

  it("an admin sees who's in, approves a request and exports for payroll", async () => {
    api.getMyAttendance.mockResolvedValue(me({ canManage: true }));
    api.getFloor.mockResolvedValue({ data: { date: "2026-11-18", holiday: "", asOf: "2026-11-18T10:30:00Z",
      counts: { WORKING: 1, ON_BREAK: 0, DONE: 0, NOT_IN: 0, LATE_NOT_IN: 1, ON_LEAVE: 0, DAY_OFF: 0, LATE: 0 },
      people: [{ email: "asha@x.com", name: "Asha", status: "WORKING", workMode: "ON_LOCATION", firstIn: "2026-11-18T09:58:00Z", workedMinutes: 32, geo: { lat: 19.1, lng: 72.8 }, ip: "203.0.113.7" },
        { email: "bo@x.com", name: "Bo", status: "LATE_NOT_IN" }] } });
    api.getApprovals.mockResolvedValue({ data: { requests: [{ id: "q1", kind: "REGULARIZATION", name: "Bo", email: "bo@x.com", date: "2026-11-17", clockOut: "19:00", reason: "Battery" }], overtime: [] } });
    api.decideRequest.mockResolvedValue({ data: {} });
    api.getReport.mockResolvedValue({ data: [{ date: "2026-11-17", name: "Bo", email: "bo@x.com", status: "ABSENT" }] });
    api.exportReport.mockResolvedValue({ data: new Blob(["x"]) });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    show();

    fireEvent.click(await screen.findByRole("tab", { name: "Who's in" }));
    expect(await screen.findByText("Asha")).toBeInTheDocument();
    expect(screen.getByText("Late - not in", { selector: ".att-badge" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Map/ })).toHaveAttribute("href", expect.stringContaining("mlat=19.1"));

    fireEvent.click(screen.getByRole("tab", { name: "Approvals" }));
    expect(await screen.findByText(/missed punch on 2026-11-17/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "ok" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.decideRequest).toHaveBeenCalledWith("q1", true, "ok"));

    fireEvent.click(screen.getByRole("tab", { name: "Reports" }));
    expect(await screen.findByText("No-show")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Excel" }));
    await waitFor(() => expect(api.exportReport).toHaveBeenCalledWith(expect.objectContaining({ format: "xlsx" })));
  });

  it("a manager gets approvals and reports for their team but not the admin tabs", async () => {
    api.getMyAttendance.mockResolvedValue(me({ isManager: true }));
    api.getReport.mockResolvedValue({ data: [] });
    show();
    expect(await screen.findByRole("tab", { name: "Approvals" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Reports" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Who's in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Rules & shifts" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Reports" }));
    await screen.findByText(/Nothing in this range/);
    expect(screen.queryByRole("button", { name: "Excel" })).not.toBeInTheDocument();
  });
});
