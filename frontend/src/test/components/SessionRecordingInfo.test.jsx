import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";

const { toastShow } = vi.hoisted(() => ({ toastShow: vi.fn() }));
vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: toastShow }) }));
vi.mock("../../api/meetingAssistant", () => ({ deleteRecordingAudio: vi.fn() }));

import * as api from "../../api/meetingAssistant";
import { ConfirmContext } from "../../hooks/useConfirm";
import SessionRecordingInfo from "../../components/SessionRecordingInfo";

const FUTURE = "2026-10-10T12:00:00Z";
const session = (rec, over = {}) => ({ id: "s1", canManage: true, recording: rec, ...over });
const mount = (s, { answer = true, onChanged = vi.fn() } = {}) => {
  const confirm = vi.fn().mockResolvedValue(answer);
  render(<ConfirmContext.Provider value={confirm}><SessionRecordingInfo session={s} onChanged={onChanged} /></ConfirmContext.Provider>);
  return { confirm, onChanged };
};

beforeEach(() => { vi.clearAllMocks(); api.deleteRecordingAudio.mockResolvedValue({ data: {} }); });
afterEach(cleanup);

describe("SessionRecordingInfo", () => {
  it("shows nothing for a meeting without a recording", () => {
    const { container } = render(<SessionRecordingInfo session={{ id: "s1", canManage: true }} onChanged={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says in plain words where the recording is up to", () => {
    for (const [state, text] of [["RECORDING", "Recording in progress."], ["UPLOADED", "Waiting to be turned into text."], ["TRANSCRIBING", "Turning the recording into text…"],
      ["DONE", "turned into a transcript"], ["DELETED", "was deleted"], ["EXPIRED", "expired before it could be turned into text"]]) {
      cleanup();
      render(<SessionRecordingInfo session={session({ state })} onChanged={vi.fn()} />);
      expect(screen.getByLabelText("Recording")).toHaveTextContent(text);
    }
  });

  it("while the audio is stored: says it's encrypted and when it will be deleted, with a delete button for people who manage the meeting", () => {
    mount(session({ state: "DONE", audioExpiresAt: FUTURE }));
    expect(screen.getByText(/stored encrypted until/)).toBeInTheDocument();
    expect(screen.getByText(/then deleted automatically/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete audio now" })).toBeInTheDocument();
    cleanup();
    mount(session({ state: "DONE", audioExpiresAt: FUTURE }, { canManage: false }));
    expect(screen.queryByRole("button", { name: "Delete audio now" })).toBeNull();               // everyone can see it; only the owner/admin can delete
  });

  it("after deletion it says when, and offers nothing more", () => {
    mount(session({ state: "DONE", audioDeletedAt: "2026-10-09T10:00:00Z" }));
    expect(screen.getByText(/The audio was deleted on/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete audio now" })).toBeNull();
    expect(screen.queryByText(/stored encrypted/)).toBeNull();
  });

  it("deleting asks first, explains the consequence, then deletes and refreshes", async () => {
    const { confirm, onChanged } = mount(session({ state: "DONE", audioExpiresAt: FUTURE }));
    fireEvent.click(screen.getByRole("button", { name: "Delete audio now" }));
    await waitFor(() => expect(api.deleteRecordingAudio).toHaveBeenCalledWith("s1"));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true, message: expect.stringContaining("transcript made from it stays") }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toastShow).toHaveBeenCalledWith("Audio deleted", "success");
  });

  it("warns that a recording not yet turned into text will NOT be, if it is deleted", async () => {
    const { confirm } = mount(session({ state: "UPLOADED", audioExpiresAt: FUTURE }));
    fireEvent.click(screen.getByRole("button", { name: "Delete audio now" }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0].message).toContain("will NOT be turned into text");
  });

  it("says no and nothing is deleted; a server error is shown, not swallowed", async () => {
    mount(session({ state: "DONE", audioExpiresAt: FUTURE }), { answer: false });
    fireEvent.click(screen.getByRole("button", { name: "Delete audio now" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.deleteRecordingAudio).not.toHaveBeenCalled();
    cleanup();
    api.deleteRecordingAudio.mockRejectedValue({ response: { status: 500, data: { message: "boom" } } });
    mount(session({ state: "DONE", audioExpiresAt: FUTURE }));
    fireEvent.click(screen.getByRole("button", { name: "Delete audio now" }));
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith(expect.any(String), "error"));
  });
});
