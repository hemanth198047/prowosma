import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const createWorkspace = vi.fn();
vi.mock("../../api/workspaces", () => ({
  getMyWorkspaces: vi.fn(() => Promise.resolve({ data: [] })),
  createWorkspace: (...a) => createWorkspace(...a),
  deleteWorkspace: vi.fn(),
}));
const setActiveWorkspace = vi.fn();
vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ activeWorkspace: null, setActiveWorkspace }),
}));

import WorkspaceSetup from "../../pages/WorkspaceSetup.jsx";

const renderPage = () => render(<MemoryRouter><WorkspaceSetup /></MemoryRouter>);

describe("WorkspaceSetup — field + role instead of a template picker", () => {
  beforeEach(() => { createWorkspace.mockReset(); createWorkspace.mockResolvedValue({ data: { id: "w1" } }); });
  afterEach(cleanup);

  it("asks about field and role, and never shows the template picker", async () => {
    renderPage();
    expect(await screen.findByText("Which field do you work in?")).toBeInTheDocument();
    expect(screen.getByText("What best describes your role?")).toBeInTheDocument();
    expect(screen.queryByText(/Choose a workspace template/i)).toBeNull();
    expect(screen.queryByText("PMO / Portfolio")).toBeNull();
    expect(screen.getByRole("button", { name: /Continue/ })).toBeDisabled();
  });

  it("picks the setup automatically and saves the answers with the workspace", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("radio", { name: /Media & Entertainment/ }));
    expect(screen.getByRole("button", { name: /Continue/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Executive \/ Leadership/ }));

    expect(screen.getByTestId("ws-recommendation")).toHaveTextContent("PMO / Portfolio");
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(screen.getByText(/Set up for Media & Entertainment · Executive \/ Leadership/)).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toHaveValue("Media & Entertainment workspace");

    fireEvent.change(screen.getByLabelText(/Workspace name/), { target: { value: "Acme Studios" } });
    fireEvent.click(screen.getByRole("button", { name: /Create workspace/ }));

    await waitFor(() => expect(createWorkspace).toHaveBeenCalledTimes(1));
    expect(createWorkspace.mock.calls[0][0]).toMatchObject({
      name: "Acme Studios", templateId: "pmo", industry: "media", userRole: "executive",
      description: "Media & Entertainment workspace",
    });
  });

  it("lets the person go back and change their answers", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("radio", { name: /Software & IT/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Team Member/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: "Change answers" }));
    fireEvent.click(screen.getByRole("radio", { name: /Finance & Banking/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    // Our earlier suggestion is replaced, since the person didn't edit it.
    expect(screen.getByLabelText("Description")).toHaveValue("Finance & Banking workspace");
  });
});
