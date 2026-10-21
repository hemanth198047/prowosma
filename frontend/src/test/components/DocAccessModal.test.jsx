import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../../api/access", () => ({ getAccessOptions: vi.fn() }));
vi.mock("../../api/docs", () => ({ updateDocAccess: vi.fn() }));
vi.mock("../../api/team", () => ({ getTeamMembers: vi.fn() }));

import * as access from "../../api/access";
import * as docs from "../../api/docs";
import * as team from "../../api/team";
import { AccessContext } from "../../context/AccessContext";
import DocAccessModal from "../../components/DocAccessModal";

const DOC = { id: "d1", title: "Script v2", audience: "PRIVATE", departmentIds: [], sharedWith: [] };

function mount({ mode = "BOTH", restricted = true, doc = DOC } = {}) {
  access.getAccessOptions.mockResolvedValue({ data: { docAccessMode: mode, departments: [{ id: "dep1", name: "Creative" }], roleSlots: [] } });
  team.getTeamMembers.mockResolvedValue({ data: [{ id: "m1", name: "Kashyap", email: "kashyap@example.com" }] });
  docs.updateDocAccess.mockResolvedValue({ data: { data: { ...doc, audience: "DEPARTMENTS", departmentIds: ["dep1"] } } });
  const onSaved = vi.fn(); const onClose = vi.fn();
  render(
    <AccessContext.Provider value={{ restricted, capabilities: [], can: () => !restricted }}>
      <DocAccessModal doc={doc} onClose={onClose} onSaved={onSaved} />
    </AccessContext.Provider>,
  );
  return { onSaved, onClose };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("DocAccessModal", () => {
  it("offers departments and sharing when the workspace allows both, but not workspace-wide to a restricted person", async () => {
    mount();
    expect(await screen.findByLabelText("Selected departments")).toBeInTheDocument();
    expect(screen.getByLabelText("Only me and people I share it with")).toBeInTheDocument();
    expect(screen.queryByLabelText("Everyone in the workspace")).toBeNull();
    expect(await screen.findByLabelText("Kashyap")).toBeInTheDocument();
  });

  it("hides the choices the workspace setting switches off", async () => {
    mount({ mode: "PRIVATE_SHARED" });
    await screen.findByLabelText("Only me and people I share it with");
    await waitFor(() => expect(access.getAccessOptions).toHaveBeenCalled());
    expect(screen.queryByLabelText("Selected departments")).toBeNull();
  });

  it("in departments-only mode there is no per-person sharing", async () => {
    mount({ mode: "DEPARTMENTS" });
    fireEvent.click(await screen.findByLabelText("Selected departments"));
    expect(await screen.findByLabelText("Creative")).toBeInTheDocument();
    expect(screen.queryByText("Also shared with")).toBeNull();
  });

  it("lets an unrestricted person choose the whole workspace", async () => {
    mount({ restricted: false });
    expect(await screen.findByLabelText("Everyone in the workspace")).toBeInTheDocument();
  });

  it("saves the chosen audience and departments", async () => {
    const { onSaved, onClose } = mount();
    fireEvent.click(await screen.findByLabelText("Selected departments"));
    fireEvent.click(await screen.findByLabelText("Creative"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(docs.updateDocAccess).toHaveBeenCalledWith("d1", { audience: "DEPARTMENTS", departmentIds: ["dep1"], sharedWith: [] }));
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the server's reason when saving is refused", async () => {
    mount();
    docs.updateDocAccess.mockRejectedValueOnce({ response: { data: { message: "Only the document's creator can do that." } } });
    fireEvent.click(await screen.findByText("Save"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Only the document's creator/);
  });
});
