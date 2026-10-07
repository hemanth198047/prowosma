import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("../../api/meetingAssistant", () => ({ completeGoogleConnect: vi.fn() }));

import { completeGoogleConnect } from "../../api/meetingAssistant";
import GoogleMeetCallback from "../../pages/GoogleMeetCallback";

const renderAt = (search) => render(
  <MemoryRouter initialEntries={[`/integrations/meeting-platforms/google-callback${search}`]}>
    <Routes>
      <Route path="/integrations/meeting-platforms/google-callback" element={<GoogleMeetCallback />} />
      <Route path="/integrations/meeting-platforms" element={<p>PLATFORMS PAGE</p>} />
    </Routes>
  </MemoryRouter>);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("GoogleMeetCallback", () => {
  it("hands the code and state to the server exactly once and confirms", async () => {
    completeGoogleConnect.mockResolvedValue({ data: { connected: true } });
    renderAt("?code=abc&state=xyz");
    expect(await screen.findByRole("status")).toHaveTextContent("connected");
    expect(completeGoogleConnect).toHaveBeenCalledTimes(1);
    expect(completeGoogleConnect).toHaveBeenCalledWith("abc", "xyz");
    fireEvent.click(screen.getByRole("button", { name: "Back to Meeting Platforms" }));
    expect(await screen.findByText("PLATFORMS PAGE")).toBeInTheDocument();
  });

  it("shows the server's reason when the sign-in can't be completed", async () => {
    completeGoogleConnect.mockRejectedValue({ response: { data: { error: "INVALID_STATE", message: "This sign-in link has expired or was already used. Please start again." } } });
    renderAt("?code=abc&state=old");
    expect(await screen.findByRole("alert")).toHaveTextContent("expired or was already used");
  });

  it("explains a refusal without calling the server", async () => {
    renderAt("?error=access_denied");
    expect(await screen.findByRole("alert")).toHaveTextContent("didn't allow access");
    expect(completeGoogleConnect).not.toHaveBeenCalled();
  });

  it("explains what to do when opened without a code", async () => {
    renderAt("");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Start again"));
    expect(completeGoogleConnect).not.toHaveBeenCalled();
  });
});
