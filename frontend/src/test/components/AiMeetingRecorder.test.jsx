// SIMULATED: browser media and the API are stand-ins. Checks the consent gate, the "share tab audio" guidance and that
// pieces go to the new endpoints; real capture needs a person to pick a tab, so it was checked by hand (docs/06-VALIDATION).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const toastShow = vi.fn();
vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: toastShow }) }));
const api = vi.hoisted(() => ({ startUmaCapture: vi.fn(), uploadUmaPiece: vi.fn(), finishUmaCapture: vi.fn() }));
vi.mock("../../api/aiMeetingAssistant", () => api);
import AiMeetingRecorder from "../../components/AiMeetingRecorder";

const track = () => ({ stop: vi.fn(), addEventListener: vi.fn() });
let getDisplayMedia;

describe("AiMeetingRecorder", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    toastShow.mockReset();
    getDisplayMedia = vi.fn();
    globalThis.MediaRecorder = class { static isTypeSupported() { return true; } };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getDisplayMedia, getUserMedia: vi.fn().mockRejectedValue(new Error("no mic")) } });
  });
  afterEach(() => { delete globalThis.MediaRecorder; });

  it("won't start without consent", () => {
    render(<AiMeetingRecorder onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Start recording/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("knows it is being recorded");
    expect(getDisplayMedia).not.toHaveBeenCalled();
  });

  it("explains how to share the tab's sound when none was shared, and creates nothing", async () => {
    const video = track();
    getDisplayMedia.mockResolvedValue({ getAudioTracks: () => [], getVideoTracks: () => [video], getTracks: () => [video] });
    render(<AiMeetingRecorder onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/knows it is being recorded/));
    fireEvent.click(screen.getByRole("button", { name: /Start recording/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Share tab audio");
    expect(video.stop).toHaveBeenCalled();
    expect(api.startUmaCapture).not.toHaveBeenCalled();
  });

  it("says so when sharing is cancelled", async () => {
    getDisplayMedia.mockRejectedValue(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    render(<AiMeetingRecorder onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/knows it is being recorded/));
    fireEvent.click(screen.getByRole("button", { name: /Start recording/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Sharing was cancelled"));
  });
});
