import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";

vi.mock("../../api/access", () => ({
  getAccessSettings: vi.fn(),
  updateAccessSettings: vi.fn(),
  getAccessProfiles: vi.fn(),
  createAccessProfile: vi.fn(),
  updateAccessProfile: vi.fn(),
  deleteAccessProfile: vi.fn(),
  getDepartments: vi.fn(),
  createDepartment: vi.fn(),
  updateDepartment: vi.fn(),
  setDepartmentMembers: vi.fn(),
  deleteDepartment: vi.fn(),
  getAccessMembers: vi.fn(),
  updateAccessMember: vi.fn(),
  runOrgSetup: vi.fn(),
  assignLegacyDocs: vi.fn(),
}));

import * as api from "../../api/access";
import AccessControl from "../../pages/AccessControl";

const PROFILE = { id: "pr1", name: "Assigned Work Only", scope: "ASSIGNED_ONLY", capabilities: [], departmentAdmin: false };
const DEPT = { id: "d1", name: "Post-production", memberEmails: [] };
const MEMBER = { id: "m1", name: "Hafeez", email: "hafeez@example.com", role: "MEMBER", designation: "Video Editor", accessProfileId: null, departmentIds: [] };

beforeEach(() => {
  api.getAccessSettings.mockResolvedValue({ data: { accessControlEnabled: false, defaultAccessProfileId: null, defaultProjectVisibility: "WORKSPACE", projectRoleSlots: [], docAccessMode: "BOTH", capabilities: ["CREATE_TASK"] } });
  api.assignLegacyDocs.mockResolvedValue({ data: { updated: 3, audience: "DEPARTMENTS" } });
  api.getAccessProfiles.mockResolvedValue({ data: [PROFILE] });
  api.getDepartments.mockResolvedValue({ data: [DEPT] });
  api.getAccessMembers.mockResolvedValue({ data: [MEMBER] });
  api.updateAccessMember.mockResolvedValue({ data: {} });
  api.updateAccessSettings.mockResolvedValue({ data: { warnings: [] } });
  api.runOrgSetup.mockResolvedValue({ data: { dryRun: true, actions: ["Create department 'Sales'"], warnings: ["x isn't in the workspace yet"] } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("AccessControl", () => {
  it("shows the overview and has no accessibility violations", async () => {
    const { container } = render(<AccessControl />);
    expect(await screen.findByLabelText(/Profile for members who don't have one/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("saves the switch, the default profile and project responsibilities", async () => {
    render(<AccessControl />);
    await screen.findByLabelText(/Profile for members who don't have one/);
    fireEvent.click(screen.getByLabelText(/Separate departments/));
    fireEvent.change(screen.getByLabelText(/Profile for members who don't have one/), { target: { value: "pr1" } });
    fireEvent.click(screen.getByText("+ Add a responsibility"));
    fireEvent.change(screen.getByLabelText("Project role 1"), { target: { value: "Creative Lead" } });
    fireEvent.click(screen.getByText("Save settings"));
    await waitFor(() => expect(api.updateAccessSettings).toHaveBeenCalled());
    expect(api.updateAccessSettings).toHaveBeenCalledWith(expect.objectContaining({
      accessControlEnabled: true,
      defaultAccessProfileId: "pr1",
      projectRoleSlots: [{ key: "", label: "Creative Lead" }],
      docAccessMode: "BOTH",
    }));
  });

  it("saves how documents are shared", async () => {
    render(<AccessControl />);
    await screen.findByLabelText("How documents are shared");
    fireEvent.change(screen.getByLabelText("How documents are shared"), { target: { value: "DEPARTMENTS" } });
    fireEvent.click(screen.getByText("Save settings"));
    await waitFor(() => expect(api.updateAccessSettings).toHaveBeenCalledWith(expect.objectContaining({ docAccessMode: "DEPARTMENTS" })));
  });

  it("gives older documents an audience in one step", async () => {
    render(<AccessControl />);
    await screen.findByLabelText("Make them visible to");
    const apply = screen.getByText("Apply to older documents");
    expect(apply).toBeDisabled();                       // a department must be chosen first
    fireEvent.click(screen.getByLabelText("Post-production"));
    fireEvent.click(apply);
    await waitFor(() => expect(api.assignLegacyDocs).toHaveBeenCalledWith("DEPARTMENTS", ["d1"]));
  });

  it("assigns an access profile to a person", async () => {
    render(<AccessControl />);
    await screen.findByText("Overview");
    fireEvent.click(screen.getByRole("tab", { name: "People" }));
    fireEvent.change(await screen.findByLabelText("Access profile for Hafeez"), { target: { value: "pr1" } });
    await waitFor(() => expect(api.updateAccessMember).toHaveBeenCalledWith("m1", { accessProfileId: "pr1" }));
  });

  it("previews an organisation setup without applying it, and reports bad JSON plainly", async () => {
    render(<AccessControl />);
    await screen.findByText("Overview");
    fireEvent.click(screen.getByRole("tab", { name: "Organisation setup" }));
    const box = await screen.findByLabelText("Structure (JSON)");
    fireEvent.change(box, { target: { value: "{ not json" } });
    fireEvent.click(screen.getByText("Preview changes"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/isn't valid JSON/);
    expect(api.runOrgSetup).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: '{"departments":[{"name":"Sales"}]}' } });
    fireEvent.click(screen.getByText("Preview changes"));
    expect(await screen.findByText(/nothing has been changed/)).toBeInTheDocument();
    expect(api.runOrgSetup).toHaveBeenCalledWith({ departments: [{ name: "Sales" }] }, { dryRun: true, sendInvitations: false });
    expect(screen.getByText(/isn't in the workspace yet/)).toBeInTheDocument();
  });
});
