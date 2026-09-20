import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  unwrapList: (res) => (Array.isArray(res) ? res : res?.data ?? []),
}));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { name: "Sam", email: "sam@acme.com" }, logoutUser: vi.fn() }) }));

import client from "../../api/client";
import ProfileSettings from "../../pages/ProfileSettings";

const NEW_CODES = Array.from({ length: 10 }, (_, i) => `code${i}-abcde`.slice(0, 11));

function statusReply(enabled, remaining) {
  client.get.mockImplementation((url) =>
    Promise.resolve({ data: String(url).includes("2fa/status") ? { enabled, backupCodesRemaining: remaining } : [] }));
}

async function openSecurity() {
  render(<MemoryRouter><ProfileSettings /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /Security/i }));
}

describe("Profile — 2FA enrolment, backup codes and recovery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enabling 2FA shows the backup codes the server returned, once, until they are confirmed saved", async () => {
    statusReply(false, 0);
    client.post.mockImplementation((url) => {
      if (url.endsWith("/2fa/setup")) return Promise.resolve({ data: { secret: "SECRETX", qrUrl: "https://qr.example/x.png" } });
      if (url.endsWith("/2fa/verify")) return Promise.resolve({ data: { enabled: true, backupCodes: NEW_CODES } });
      return Promise.resolve({ data: {} });
    });
    await openSecurity();

    fireEvent.click(await screen.findByRole("button", { name: /Enable 2FA/ }));
    expect(await screen.findByText("SECRETX")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify & Enable/ }));

    const panel = await screen.findByTestId("backup-codes");
    for (const c of NEW_CODES) expect(panel.textContent).toContain(c);
    expect(client.post).toHaveBeenCalledWith("/security/2fa/verify", { code: "123456" });
    expect(screen.getByText(/2FA is enabled on your account/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /I've saved these codes/ }));
    await waitFor(() => expect(screen.queryByTestId("backup-codes")).toBeNull());
    expect(screen.getByText("10")).toBeTruthy();                       // "Backup codes remaining: 10"
  });

  it("with 2FA on, it shows how many backup codes are left", async () => {
    statusReply(true, 3);
    await openSecurity();
    expect(await screen.findByText(/Backup codes remaining/)).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("2FA can be switched off with a backup code, not just six digits", async () => {
    statusReply(true, 3);
    client.post.mockResolvedValue({ data: { enabled: false } });
    await openSecurity();

    const input = await screen.findByLabelText(/Enter your 2FA code/);
    fireEvent.change(input, { target: { value: "abcde-fghjk" } });
    expect(input.value).toBe("abcde-fghjk");
    fireEvent.click(screen.getByRole("button", { name: /Disable 2FA/ }));

    await waitFor(() => expect(client.post).toHaveBeenCalledWith("/security/2fa/disable", { code: "abcde-fghjk" }));
  });

  it("the disable button stays off until a full code is typed", async () => {
    statusReply(true, 3);
    await openSecurity();
    const input = await screen.findByLabelText(/Enter your 2FA code/);
    const button = screen.getByRole("button", { name: /Disable 2FA/ });

    fireEvent.change(input, { target: { value: "12345" } });
    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "123456" } });
    expect(button.disabled).toBe(false);
  });

  it("new backup codes can be generated with a current code, and are shown once", async () => {
    statusReply(true, 1);
    client.post.mockResolvedValue({ data: { backupCodes: NEW_CODES } });
    await openSecurity();

    fireEvent.change(await screen.findByLabelText("2FA code to generate new backup codes"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate new backup codes/ }));

    const panel = await screen.findByTestId("backup-codes");
    expect(panel.textContent).toContain(NEW_CODES[0]);
    expect(client.post).toHaveBeenCalledWith("/security/2fa/backup-codes", { code: "123456" });
  });

  it("a rejected code when generating shows the server's reason and no codes", async () => {
    statusReply(true, 1);
    client.post.mockRejectedValue({ response: { data: { error: "X", message: "Invalid code -- enter your current 2FA code" } } });
    await openSecurity();

    fireEvent.change(await screen.findByLabelText("2FA code to generate new backup codes"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate new backup codes/ }));

    expect(await screen.findByText(/Invalid code -- enter your current 2FA code/)).toBeTruthy();
    expect(screen.queryByTestId("backup-codes")).toBeNull();
  });
});
