import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const loginUser = vi.fn();
const navigate = vi.fn();

vi.mock("axios", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  unwrapList: (data) => (Array.isArray(data) ? data : data?.items ?? []),
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => ({ loginWithRedirect: vi.fn() }) }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ loginUser }) }));
vi.mock("react-router-dom", async (importOriginal) => ({ ...(await importOriginal()), useNavigate: () => navigate }));

import axios from "axios";
import Login from "../../pages/Login";

const CHALLENGE = { requiresTwoFactor: true, twoFactorToken: "CHALLENGE-TOKEN" };

function serverError(status, message) {
  return { response: { status, data: { error: "X", message } } };
}

async function renderAndSignIn() {
  render(<MemoryRouter><Login /></MemoryRouter>);
  // Found by name, not by its (translated) placeholder, so this works in any language.
  await waitFor(() => expect(document.querySelector('input[name="email"]')).toBeTruthy());
  fireEvent.change(document.querySelector('input[name="email"]'), { target: { name: "email", value: "sam@acme.com" } });
  const password = document.querySelector('input[type="password"]');
  fireEvent.change(password, { target: { name: "password", value: "hunter2" } });
  fireEvent.keyDown(password, { key: "Enter" });
}

describe("Login — two-step verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    axios.get.mockImplementation((url) =>
      Promise.resolve({ data: String(url).includes("/workspaces") ? [] : { saml: [] } }));
  });

  it("an account with 2FA gets the code step after its password, and is NOT signed in yet", async () => {
    axios.post.mockResolvedValueOnce({ data: CHALLENGE });
    await renderAndSignIn();

    expect(await screen.findByText("Two-step verification")).toBeTruthy();
    expect(loginUser).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("a correct code completes the sign-in with the session token from the second step", async () => {
    axios.post.mockResolvedValueOnce({ data: CHALLENGE })
              .mockResolvedValueOnce({ data: { token: "JWT", id: "u1", email: "sam@acme.com", role: "USER" } });
    await renderAndSignIn();

    fireEvent.change(await screen.findByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify/ }));

    await waitFor(() => expect(loginUser).toHaveBeenCalled());
    expect(axios.post.mock.calls[1][0]).toMatch(/\/auth\/login\/2fa$/);
    expect(axios.post.mock.calls[1][1]).toEqual({ twoFactorToken: "CHALLENGE-TOKEN", code: "123456" });
    expect(loginUser).toHaveBeenCalledWith({ id: "u1", email: "sam@acme.com", role: "USER" }, "JWT");
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
  });

  it("a backup code is sent as typed (trimmed), and Enter submits", async () => {
    axios.post.mockResolvedValueOnce({ data: CHALLENGE }).mockResolvedValueOnce({ data: { token: "JWT", email: "sam@acme.com" } });
    await renderAndSignIn();

    const input = await screen.findByLabelText("Verification code");
    fireEvent.change(input, { target: { value: "  abcde-fghjk " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(loginUser).toHaveBeenCalled());
    expect(axios.post.mock.calls[1][1].code).toBe("abcde-fghjk");
  });

  it("a wrong code shows the server's message and keeps the person on the code step", async () => {
    axios.post.mockResolvedValueOnce({ data: CHALLENGE }).mockRejectedValueOnce(serverError(401, "Invalid verification code"));
    await renderAndSignIn();

    fireEvent.change(await screen.findByLabelText("Verification code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify/ }));

    expect((await screen.findByRole("alert")).textContent).toBe("Invalid verification code");
    expect(loginUser).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Verification code")).toBeTruthy();
  });

  it("when too many wrong codes have locked the step, the person is told for how long", async () => {
    axios.post.mockResolvedValueOnce({ data: CHALLENGE }).mockRejectedValueOnce(serverError(429, "Too many incorrect codes. Try again in 14 minutes."));
    await renderAndSignIn();

    fireEvent.change(await screen.findByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify/ }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/Try again in 14 minutes/);
  });

  it("if the five-minute challenge expired, it goes back to the password form with the reason", async () => {
    axios.post.mockResolvedValueOnce({ data: CHALLENGE })
              .mockRejectedValueOnce(serverError(401, "This sign-in has expired. Please log in again."));
    await renderAndSignIn();

    fireEvent.change(await screen.findByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify/ }));

    expect(await screen.findByText("Welcome back")).toBeTruthy();
    expect(screen.getByText(/This sign-in has expired/)).toBeTruthy();
  });

  it("the submit button is disabled until something is typed", async () => {
    axios.post.mockResolvedValueOnce({ data: CHALLENGE });
    await renderAndSignIn();

    await screen.findByLabelText("Verification code");
    expect(screen.getByRole("button", { name: /Verify/ }).disabled).toBe(true);
  });

  it("'Back to sign in' returns to the password form and forgets the challenge", async () => {
    axios.post.mockResolvedValueOnce({ data: CHALLENGE });
    await renderAndSignIn();

    fireEvent.click(await screen.findByRole("button", { name: /Back to sign in/ }));
    expect(await screen.findByText("Welcome back")).toBeTruthy();
    expect(loginUser).not.toHaveBeenCalled();
  });

  it("an account WITHOUT 2FA still signs in with just its password, in one step", async () => {
    axios.post.mockResolvedValueOnce({ data: { token: "JWT", id: "u2", email: "sam@acme.com", role: "USER" } });
    await renderAndSignIn();

    await waitFor(() => expect(loginUser).toHaveBeenCalledWith({ id: "u2", email: "sam@acme.com", role: "USER" }, "JWT"));
    expect(screen.queryByText("Two-step verification")).toBeNull();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
  });

  it("the code step is translated", async () => {
    const i18n = (await import("../../i18n")).default;
    await i18n.changeLanguage("es");
    axios.post.mockResolvedValueOnce({ data: CHALLENGE });
    await renderAndSignIn();
    expect(await screen.findByText("Verificación en dos pasos")).toBeTruthy();
    await i18n.changeLanguage("en");
  });
});
