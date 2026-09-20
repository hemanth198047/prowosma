import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), defaults: { baseURL: "https://api.acme.com/api" } },
  unwrapList: (res) => res?.data ?? [],
}));
vi.mock("../../api/integrations", () => ({
  getIntegrations: vi.fn(),
  saveIntegration: vi.fn(),
  toggleIntegration: vi.fn(),
  syncGitHub: vi.fn(),
  syncBitbucket: vi.fn(),
  syncGitLab: vi.fn(),
  sendTeamsTest: vi.fn(),
  createInboundToken: vi.fn(),
}));

import client from "../../api/client";
import { getIntegrations, syncGitLab, sendTeamsTest, createInboundToken } from "../../api/integrations";
import Integrations from "../../pages/Integrations";

const connected = [
  { id: "gl-1", key: "GITLAB", type: "GITLAB", enabled: true, config: { token: "t", projectId: "g/p" } },
  { id: "tm-1", key: "MICROSOFT_TEAMS", type: "MICROSOFT_TEAMS", enabled: true, config: { webhookUrl: "https://x.webhook.office.com/x" } },
  { id: "dd-1", key: "DATADOG", type: "DATADOG", enabled: true, config: {} },
];

async function renderPage(saved = connected) {
  getIntegrations.mockResolvedValue({ data: saved });
  render(<MemoryRouter><Integrations /></MemoryRouter>);
  await waitFor(() => expect(getIntegrations).toHaveBeenCalled());
}

/** Narrow the catalogue to one integration so its buttons are unambiguous. */
async function only(name) {
  fireEvent.change(screen.getByPlaceholderText(/Search integrations/), { target: { value: name } });
  await screen.findByText(new RegExp(`^${name}$`));
}

describe("Integrations page — GitLab, Teams and event integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  // ── GitLab ─────────────────────────────────────────────────────────────

  it("GitLab: a connected card gets a sync button that reports what was imported", async () => {
    syncGitLab.mockResolvedValue({ data: { imported: 2, total: 5, truncated: false } });
    await renderPage();
    await only("GitLab");

    fireEvent.click(await screen.findByRole("button", { name: /Sync Issues & MRs/ }));

    expect(await screen.findByText(/Imported 2 new issues and merge requests \(5 open\)\./)).toBeTruthy();
    expect(syncGitLab).toHaveBeenCalledWith("gl-1");
  });

  it("GitLab: says so when nothing was new, and when the import was cut short", async () => {
    syncGitLab.mockResolvedValueOnce({ data: { imported: 0, total: 3, truncated: false } });
    await renderPage();
    await only("GitLab");
    fireEvent.click(await screen.findByRole("button", { name: /Sync Issues & MRs/ }));
    expect(await screen.findByText(/Up to date: 0 new issues and merge requests \(3 open\)\./)).toBeTruthy();

    syncGitLab.mockResolvedValueOnce({ data: { imported: 500, total: 500, truncated: true } });
    fireEvent.click(screen.getByRole("button", { name: /Sync Issues & MRs/ }));
    expect(await screen.findByText(/Only the first 500 of each kind were read\./)).toBeTruthy();
  });

  it("GitLab: shows the server's reason when the sync fails (bad token, unreachable host...)", async () => {
    syncGitLab.mockRejectedValue({ response: { data: { error: "INVALID_ARGUMENT", message: "GitLab rejected the access token (HTTP 401)" } } });
    await renderPage();
    await only("GitLab");
    fireEvent.click(await screen.findByRole("button", { name: /Sync Issues & MRs/ }));
    expect(await screen.findByText(/GitLab rejected the access token \(HTTP 401\)/)).toBeTruthy();
  });

  it("GitLab: the form offers the self-managed URL field alongside the token and project", async () => {
    await renderPage();
    await only("GitLab");
    fireEvent.click(await screen.findByRole("button", { name: /Reconfigure/ }));

    expect(await screen.findByText("Configure GitLab")).toBeTruthy();
    expect(screen.getByText("Access Token")).toBeTruthy();
    expect(screen.getByText("Project ID or Path")).toBeTruthy();
    expect(screen.getByPlaceholderText("https://gitlab.com")).toBeTruthy();
  });

  it("GitLab: what is typed in the form is saved under the config names the backend reads (token, projectId, host)", async () => {
    client.post.mockResolvedValue({ data: { id: "gl-2", key: "GITLAB", enabled: true, config: {} } });
    await renderPage();
    await only("GitLab");
    fireEvent.click(await screen.findByRole("button", { name: /Reconfigure/ }));
    await screen.findByText("Configure GitLab");

    fireEvent.change(screen.getByPlaceholderText("glpat-xxxx"), { target: { value: "glpat-new" } });
    fireEvent.change(screen.getByPlaceholderText("123 or group/project"), { target: { value: "acme/backend" } });
    fireEvent.change(screen.getByPlaceholderText("https://gitlab.com"), { target: { value: "https://git.acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Save & Connect/ }));

    await waitFor(() => expect(client.post).toHaveBeenCalled());
    const [url, payload] = client.post.mock.calls[0];
    expect(url).toBe("/integrations/GITLAB/force-update");
    expect(payload.config).toEqual({ token: "glpat-new", projectId: "acme/backend", host: "https://git.acme.com" });
  });

  // ── Teams ──────────────────────────────────────────────────────────────

  it("Teams: a connected card gets a test button", async () => {
    sendTeamsTest.mockResolvedValue({ data: { ok: true } });
    await renderPage();
    await only("Microsoft Teams");

    fireEvent.click(await screen.findByRole("button", { name: /Send test/ }));

    expect(await screen.findByText(/Test message sent to Teams\./)).toBeTruthy();
    expect(sendTeamsTest).toHaveBeenCalledWith("tm-1");
  });

  it("Teams: shows why a test failed (e.g. a webhook URL that isn't a Microsoft one)", async () => {
    sendTeamsTest.mockRejectedValue({ response: { data: { error: "INVALID_ARGUMENT", message: "Teams webhook URL host is not an allowed host" } } });
    await renderPage();
    await only("Microsoft Teams");
    fireEvent.click(await screen.findByRole("button", { name: /Send test/ }));
    expect(await screen.findByText(/Teams webhook URL host is not an allowed host/)).toBeTruthy();
  });

  // ── Datadog / Sentry / Jenkins ─────────────────────────────────────────

  it("Datadog, Sentry and Jenkins are now real integrations, not 'Config Only'", async () => {
    await renderPage([]);
    for (const name of ["Datadog", "Sentry", "Jenkins"]) {
      await only(name);
      const card = screen.getByText(new RegExp(`^${name}$`)).closest("div[style]");
      expect(within(card.parentElement.parentElement).queryByText("Config Only")).toBeNull();
    }
  });

  it("Datadog: after it is connected, the dialog generates the webhook URL", async () => {
    createInboundToken.mockResolvedValue({ data: { path: "/api/inbound-events/datadog/TOK" } });
    await renderPage();
    await only("Datadog");
    fireEvent.click(await screen.findByRole("button", { name: /Reconfigure/ }));

    expect(await screen.findByText("Configure Datadog")).toBeTruthy();
    expect(screen.getByText("Generate your webhook URL")).toBeTruthy();               // event-style steps, not "get your credentials"
    expect(screen.queryByText("Get your credentials")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Generate webhook URL/ }));
    expect(await screen.findByDisplayValue("https://api.acme.com/api/inbound-events/datadog/TOK")).toBeTruthy();
    expect(createInboundToken).toHaveBeenCalledWith("dd-1");
  });

  it("Sentry: before it is connected, the dialog asks you to save first (there is nothing to generate yet)", async () => {
    await renderPage([]);
    await only("Sentry");
    fireEvent.click(await screen.findByRole("button", { name: /Configure/ }));

    expect(await screen.findByText("Configure Sentry")).toBeTruthy();
    expect(screen.getByText(/Click/).textContent).toMatch(/Save & Connect first/);
    expect(screen.queryByRole("button", { name: /Generate webhook URL/ })).toBeNull();
    expect(screen.getByText("Client Secret (recommended)")).toBeTruthy();
  });

  it("a normal credentials integration keeps its normal dialog and never shows a webhook panel", async () => {
    await renderPage();
    await only("GitLab");
    fireEvent.click(await screen.findByRole("button", { name: /Reconfigure/ }));
    expect(await screen.findByText("Get your credentials")).toBeTruthy();
    expect(screen.queryByTestId("inbound-panel")).toBeNull();
  });
});
