import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../api/client", () => ({ default: { defaults: { baseURL: "https://api.acme.com/api" } } }));
vi.mock("../../api/integrations", () => ({ createInboundToken: vi.fn() }));

import { createInboundToken } from "../../api/integrations";
import InboundUrlPanel from "../../components/InboundUrlPanel";

const TOKEN_PATH = "/api/inbound-events/datadog/SECRETTOKEN";
const FULL_URL = "https://api.acme.com" + TOKEN_PATH;

describe("InboundUrlPanel", () => {
  beforeEach(() => {
    createInboundToken.mockReset();
    createInboundToken.mockResolvedValue({ data: { source: "datadog", token: "SECRETTOKEN", path: TOKEN_PATH } });
  });

  it("before the integration is saved, explains what to do and offers no button", () => {
    render(<InboundUrlPanel integrationKey="DATADOG" savedId={undefined} />);
    expect(screen.getByText(/Save & Connect/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Generate webhook URL/ })).toBeNull();
  });

  it("generates the URL for the saved integration and shows it in full", async () => {
    render(<InboundUrlPanel integrationKey="DATADOG" savedId="int-1" />);
    expect(screen.queryByDisplayValue(FULL_URL)).toBeNull();          // nothing secret is shown up front

    fireEvent.click(screen.getByRole("button", { name: /Generate webhook URL/ }));

    expect(await screen.findByDisplayValue(FULL_URL)).toBeTruthy();
    expect(createInboundToken).toHaveBeenCalledWith("int-1");
    expect(screen.getByRole("note").textContent).toMatch(/shown once/);
    expect(screen.queryByRole("button", { name: /Generate webhook URL/ })).toBeNull();
  });

  it("Datadog: shows the setup steps and the payload template with Datadog's variables", async () => {
    render(<InboundUrlPanel integrationKey="DATADOG" savedId="int-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Generate webhook URL/ }));
    await screen.findByDisplayValue(FULL_URL);

    expect(screen.getByText(/add a new webhook/)).toBeTruthy();
    const payload = screen.getByLabelText("Datadog payload").textContent;
    for (const variable of ["$ALERT_ID", "$ALERT_TRANSITION", "$EVENT_TITLE", "$ALERT_PRIORITY", "$LINK", "$TAGS"]) {
      expect(payload).toContain(variable);
    }
    expect(() => JSON.parse(payload.replace(/\$[A-Z_]+/g, "x"))).not.toThrow();    // a valid JSON template
  });

  it("Sentry and Jenkins: their own steps, and no Datadog payload", async () => {
    const { unmount } = render(<InboundUrlPanel integrationKey="SENTRY" savedId="int-2" />);
    fireEvent.click(screen.getByRole("button", { name: /Generate webhook URL/ }));
    await screen.findByDisplayValue(FULL_URL);
    expect(screen.getByText(/Internal Integration/)).toBeTruthy();
    expect(screen.getByText(/Client Secret/)).toBeTruthy();
    expect(screen.queryByLabelText("Datadog payload")).toBeNull();
    unmount();

    render(<InboundUrlPanel integrationKey="JENKINS" savedId="int-3" />);
    fireEvent.click(screen.getByRole("button", { name: /Generate webhook URL/ }));
    await screen.findByDisplayValue(FULL_URL);
    expect(screen.getByText(/Notification plugin/)).toBeTruthy();
  });

  it("copies the URL to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<InboundUrlPanel integrationKey="DATADOG" savedId="int-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Generate webhook URL/ }));
    await screen.findByDisplayValue(FULL_URL);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FULL_URL));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("shows the server's message when generation fails, with no URL", async () => {
    createInboundToken.mockRejectedValue({ response: { data: { error: "INVALID_ARGUMENT", message: "This integration does not receive events" } } });
    render(<InboundUrlPanel integrationKey="DATADOG" savedId="int-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Generate webhook URL/ }));

    expect((await screen.findByRole("alert")).textContent).toBe("This integration does not receive events");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("falls back to a plain message when the failure has no server message", async () => {
    createInboundToken.mockRejectedValue(new Error("Network Error"));
    render(<InboundUrlPanel integrationKey="DATADOG" savedId="int-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Generate webhook URL/ }));
    expect((await screen.findByRole("alert")).textContent).toBeTruthy();
    expect(screen.queryByDisplayValue(/inbound-events/)).toBeNull();
  });

  it("does not show a URL if the server response has no usable path", async () => {
    createInboundToken.mockResolvedValue({ data: { path: "//evil.com/x" } });
    render(<InboundUrlPanel integrationKey="DATADOG" savedId="int-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Generate webhook URL/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("warns that a new URL replaces the old one", () => {
    render(<InboundUrlPanel integrationKey="DATADOG" savedId="int-1" />);
    expect(screen.getByText(/replaces it: the old URL stops working/)).toBeTruthy();
  });
});
