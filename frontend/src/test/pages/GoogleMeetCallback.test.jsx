import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("../../api/meetingAssistant", () => ({ completeGoogleConnect: vi.fn() }));
vi.mock("../../api/client", () => ({ default: { get: vi.fn() } }));

import { completeGoogleConnect } from "../../api/meetingAssistant";
import client from "../../api/client";
import GoogleMeetCallback from "../../pages/GoogleMeetCallback";

const renderAt = (search) => render(
  <MemoryRouter initialEntries={[`/integrations/meeting-platforms/google-callback${search}`]}>
    <Routes>
      <Route path="/integrations/meeting-platforms/google-callback" element={<GoogleMeetCallback />} />
      <Route path="/integrations/meeting-platforms" element={<p>PLATFORMS PAGE</p>} />
    </Routes>
  </MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  client.get.mockResolvedValue({ data: { email: "abhiscorner4@gmail.com", name: "Abhi" } });
});
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

  it("shows the connected Google account and the Prowosma account as two separate identities", async () => {
    completeGoogleConnect.mockResolvedValue({ data: { connected: true, account: "java.swing.developer@gmail.com" } });
    renderAt("?code=abc&state=xyz");
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("You are still signed in to Prowosma as: abhiscorner4@gmail.com"));
    expect(status).toHaveTextContent("Google account used to read transcripts: java.swing.developer@gmail.com");
    expect(status).toHaveTextContent("never changes how you sign in to Prowosma");
    expect(client.get).toHaveBeenCalledWith("/auth/profile");
  });

  it("still confirms the connection when the profile can't be read — it just omits the sign-in line", async () => {
    completeGoogleConnect.mockResolvedValue({ data: { connected: true, account: "g@x.com" } });
    client.get.mockRejectedValue(new Error("offline"));
    renderAt("?code=abc&state=xyz");
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Your Google account is connected.");
    expect(status).toHaveTextContent("g@x.com");
    expect(status).not.toHaveTextContent("still signed in to Prowosma");
  });

  it("shows no identity details when the connection fails", async () => {
    completeGoogleConnect.mockRejectedValue({ response: { data: { error: "INVALID_STATE", message: "This sign-in link has expired or was already used. Please start again." } } });
    renderAt("?code=abc&state=old");
    await screen.findByRole("alert");
    expect(screen.queryByText(/still signed in to Prowosma/)).toBeNull();
    expect(client.get).not.toHaveBeenCalled();
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
