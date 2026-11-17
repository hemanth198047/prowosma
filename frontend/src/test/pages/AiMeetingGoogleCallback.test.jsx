// SIMULATED API. Checks the page hands Google's code to the server once and reports the result.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const complete = vi.fn();
vi.mock("../../api/aiMeetingAssistant", () => ({ completeUmaGoogle: (...a) => complete(...a) }));
import AiMeetingGoogleCallback from "../../pages/AiMeetingGoogleCallback";

describe("AiMeetingGoogleCallback", () => {
  beforeEach(() => complete.mockReset());

  it("completes the connection once", async () => {
    window.history.pushState({}, "", "/ai-meeting-assistant/google-callback?code=abc&state=xyz");
    complete.mockResolvedValue({ data: { account: "me@acme.test", calendar: true } });
    render(<MemoryRouter><AiMeetingGoogleCallback /></MemoryRouter>);
    expect(await screen.findByText("Connected as me@acme.test")).toBeInTheDocument();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith("abc", "xyz");
  });

  it("says so when access was denied, without calling the server", async () => {
    window.history.pushState({}, "", "/ai-meeting-assistant/google-callback?error=access_denied");
    render(<MemoryRouter><AiMeetingGoogleCallback /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("Google access wasn't allowed.");
    await waitFor(() => expect(complete).not.toHaveBeenCalled());
  });
});
