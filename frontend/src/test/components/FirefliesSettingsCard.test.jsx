import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";

const { toastShow } = vi.hoisted(() => ({ toastShow: vi.fn() }));
vi.mock("../../components/ToastContext", () => ({ useToast: () => ({ show: toastShow }) }));
vi.mock("../../api/meetingAssistant", () => ({ getAssistantSettings: vi.fn(), updateAssistantSettings: vi.fn(), testFireflies: vi.fn() }));

import * as api from "../../api/meetingAssistant";
import FirefliesSettingsCard from "../../components/FirefliesSettingsCard";

const SAVED = { firefliesEnabled: true, firefliesKeySaved: true };
beforeEach(() => {
  vi.clearAllMocks();
  api.getAssistantSettings.mockResolvedValue({ data: SAVED });
  api.updateAssistantSettings.mockImplementation(async (patch) => ({ data: { ...SAVED, ...patch, firefliesApiKey: undefined, firefliesKeySaved: !patch.clearFirefliesApiKey } }));
  api.testFireflies.mockResolvedValue({ data: { ok: true, message: "Connected to Fireflies as priya@acme.com." } });
});
afterEach(cleanup);
const mount = (fireflies = { ready: true }, onChanged = vi.fn()) => { render(<FirefliesSettingsCard fireflies={fireflies} onChanged={onChanged} />); return { onChanged }; };
const loaded = () => screen.findByLabelText(/Fireflies API key/);

describe("FirefliesSettingsCard", () => {
  it("shows the state without ever showing the key, and explains where to find it and the plan limits", async () => {
    mount();
    const key = await loaded();
    expect(key).toHaveValue("");
    expect(key).toHaveAttribute("type", "password");
    expect(key.getAttribute("placeholder")).toContain("A key is saved");
    expect(screen.getByLabelText(/Allow sending the Fireflies notetaker/)).toBeChecked();
    expect(screen.getByText(/Integrations → Fireflies API/)).toBeInTheDocument();
    expect(screen.getByText(/about 50 requests a day/)).toBeInTheDocument();
    expect(screen.getByText(/— on/)).toBeInTheDocument();
  });

  it("says why it isn't usable yet", async () => {
    mount({ ready: false, reason: "No Fireflies API key is saved yet." });
    await loaded();
    expect(screen.getByText(/— off/)).toBeInTheDocument();
    expect(screen.getByText("No Fireflies API key is saved yet.")).toBeInTheDocument();
  });

  it("saving leaves the key alone unless a new one was typed; a typed key is sent once and the box emptied", async () => {
    const { onChanged } = mount();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateAssistantSettings).toHaveBeenCalledTimes(1));
    expect("firefliesApiKey" in api.updateAssistantSettings.mock.calls[0][0]).toBe(false);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/Fireflies API key/), { target: { value: "  ff-new-key  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateAssistantSettings).toHaveBeenCalledTimes(2));
    expect(api.updateAssistantSettings.mock.calls[1][0].firefliesApiKey).toBe("ff-new-key");
    await waitFor(() => expect(screen.getByLabelText(/Fireflies API key/)).toHaveValue(""));
    expect(toastShow).toHaveBeenCalledWith("Fireflies settings saved", "success");
  });

  it("the saved key can be removed, and Test connection then becomes unavailable", async () => {
    mount();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Remove the saved key" }));
    await waitFor(() => expect(api.updateAssistantSettings).toHaveBeenCalled());
    expect(api.updateAssistantSettings.mock.calls[0][0]).toMatchObject({ clearFirefliesApiKey: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled());
  });

  it("a refused change shows the server's reason", async () => {
    api.updateAssistantSettings.mockRejectedValue({ response: { status: 409, data: { error: "FIREFLIES_NOT_READY", message: "No Fireflies API key is saved yet." } } });
    mount();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/No Fireflies API key|Couldn't save/);
  });

  it("Test connection reports whose Fireflies account it reached, or why it failed", async () => {
    mount();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/Connected to Fireflies as priya@acme.com/)).toBeInTheDocument();
    api.testFireflies.mockResolvedValue({ data: { ok: false, message: "Fireflies rejected the API key." } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/rejected the API key/)).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<FirefliesSettingsCard fireflies={{ ready: true }} onChanged={vi.fn()} />);
    await loaded();
    expect(await axe(container)).toHaveNoViolations();
  });
});
