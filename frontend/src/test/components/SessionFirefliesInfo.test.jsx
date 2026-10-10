import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";

const { toastShow } = vi.hoisted(() => ({ toastShow: vi.fn() }));
vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: toastShow }) }));
vi.mock("../../api/meetingAssistant", () => ({ sendFirefliesNotetaker: vi.fn() }));

import * as api from "../../api/meetingAssistant";
import SessionFirefliesInfo from "../../components/SessionFirefliesInfo";

const READY = { ready: true };
const base = { id: "s1", canManage: true, simulated: false, provider: "GOOGLE_MEET", meetingUrl: "https://meet.google.com/abc-defg-hij" };
const mount = (session, { caps = READY, waiting = true, onChanged = vi.fn() } = {}) => { render(<SessionFirefliesInfo session={session} firefliesCaps={caps} waiting={waiting} onChanged={onChanged} />); return { onChanged }; };

beforeEach(() => { vi.clearAllMocks(); api.sendFirefliesNotetaker.mockResolvedValue({ data: {} }); });
afterEach(cleanup);

describe("SessionFirefliesInfo", () => {
  it("says what Fireflies is doing once a notetaker was sent, and when it is done", () => {
    mount({ ...base, fireflies: { state: "SENT", platformName: "Zoom", sentAt: "2026-10-08T10:15:00Z" } });
    expect(screen.getByLabelText("Fireflies")).toHaveTextContent(/The notetaker was sent to your Zoom meeting/);
    expect(screen.getByLabelText("Fireflies")).toHaveTextContent(/make sure you admitted it/);
    cleanup();
    mount({ ...base, fireflies: { state: "IMPORTED", platformName: "Zoom" } });
    expect(screen.getByLabelText("Fireflies")).toHaveTextContent("The transcript came from Fireflies.");
  });

  it("offers to send a notetaker to a waiting meeting that has a link — when Fireflies is ready and the person manages it", () => {
    mount(base);
    expect(screen.getByText("No transcript? Send a Fireflies notetaker to this meeting")).toBeInTheDocument();
    for (const [session, opts] of [[base, { caps: { ready: false } }], [base, { caps: null }], [{ ...base, canManage: false }, {}], [{ ...base, simulated: true }, {}],
      [{ ...base, meetingUrl: null }, {}], [{ ...base, provider: "RECORDING" }, {}], [base, { waiting: false }]]) {
      cleanup();
      mount(session, opts);
      expect(screen.queryByText(/Send a Fireflies notetaker/)).toBeNull();
    }
  });

  it("needs the confirmation, then sends to THIS meeting and refreshes", async () => {
    const { onChanged } = mount(base);
    fireEvent.click(screen.getByRole("button", { name: "Send notetaker" }));
    expect(screen.getByRole("alert")).toHaveTextContent("confirm that everyone in the meeting knows");
    expect(api.sendFirefliesNotetaker).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/Everyone in the meeting knows a Fireflies notetaker/));
    fireEvent.click(screen.getByRole("button", { name: "Send notetaker" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.sendFirefliesNotetaker).toHaveBeenCalledWith({ sessionId: "s1", consent: true });
    expect(toastShow).toHaveBeenCalledWith("Notetaker sent", "success");
  });

  it("shows the reason when it can't be sent — for example the meeting isn't running", async () => {
    api.sendFirefliesNotetaker.mockRejectedValue({ response: { status: 409, data: { error: "MEETING_NOT_RUNNING", message: "Fireflies didn't accept this meeting. It has to be running right now." } } });
    mount(base);
    fireEvent.click(screen.getByLabelText(/Everyone in the meeting knows a Fireflies notetaker/));
    fireEvent.click(screen.getByRole("button", { name: "Send notetaker" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/has to be running right now|Couldn't send/);
    expect(screen.getByRole("button", { name: "Send notetaker" })).toBeEnabled();
  });
});
