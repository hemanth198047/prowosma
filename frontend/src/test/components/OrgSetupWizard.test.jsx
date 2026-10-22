import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import { axe } from "vitest-axe";

vi.mock("../../api/access", () => ({ runOrgSetup: vi.fn(), updateAccessSettings: vi.fn() }));

import * as api from "../../api/access";
import OrgSetupWizard from "../../components/OrgSetupWizard";
import { ConfirmContext } from "../../hooks/useConfirm";

const notify = vi.fn();
const reload = vi.fn();
const show = (props = {}, confirmAnswer = true) => render(
  <ConfirmContext.Provider value={() => Promise.resolve(confirmAnswer)}>
    <OrgSetupWizard profiles={[]} departments={[]} members={[]} settings={{}} reload={reload} notify={notify} onOpenOverview={vi.fn()} {...props} />
  </ConfirmContext.Provider>
);
const next = () => fireEvent.click(screen.getByRole("button", { name: /Next/ }));

beforeEach(() => {
  api.runOrgSetup.mockResolvedValue({ data: { dryRun: true, actions: ["Create department 'Sales'"], warnings: [] } });
  api.updateAccessSettings.mockResolvedValue({ data: {} });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Guided organisation setup", () => {
  it("never asks for JSON, and has no accessibility violations", async () => {
    const { container } = show();
    expect(screen.queryByText(/JSON/i)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("explains in words why it cannot continue, until a department is chosen", () => {
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose at least one department");
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sales & Marketing" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled();
  });

  it("walks a new company through every step, then sets it up without switching anything on", async () => {
    show();
    // 1. departments — one quick start fills in the usual ones
    fireEvent.click(screen.getByRole("button", { name: "Film & media production" }));
    expect(screen.getByRole("button", { name: /Post-production/ })).toHaveAttribute("aria-pressed", "true");
    next();
    // 2. access levels — the usual four are already ticked; add one more
    expect(screen.getByLabelText("Use the Department Member level")).toBeChecked();
    expect(screen.getByLabelText("Use the Finance Lead level")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("Use the Finance Lead level"));
    next();
    // 3. project roles — filled by the quick start
    expect(screen.getByRole("button", { name: /Producer/ })).toHaveAttribute("aria-pressed", "true");
    next();
    // 4. people — add someone new; a bad email blocks "Next" with a reason
    fireEvent.click(screen.getByText(/Add someone who isn't in the workspace yet/));
    fireEvent.change(screen.getByLabelText("Name of person 1"), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText("Work email of person 1"), { target: { value: "asha" } });
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/Fix or remove the people whose email isn't valid/);
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Work email of person 1"), { target: { value: "asha@example.com" } });
    fireEvent.change(screen.getByLabelText("Access level of Asha"), { target: { value: "Department Member" } });
    fireEvent.click(within(screen.getByRole("group", { name: "Departments of Asha" })).getByRole("button", { name: "Creative" }));
    next();
    // 5. rules — recommended answers are already chosen; change one
    expect(screen.getByRole("radio", { name: /Only the departments chosen for the project/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Everyone in the workspace/ }));
    next();
    // 6. review — a preview is fetched, nothing is applied yet
    expect(await screen.findByText("Create department 'Sales'")).toBeInTheDocument();
    expect(api.runOrgSetup).toHaveBeenCalledTimes(1);
    expect(api.runOrgSetup.mock.calls[0][1]).toEqual({ dryRun: true, sendInvitations: true });
    expect(screen.getByLabelText("Summary")).toHaveTextContent("6 departments");
    expect(screen.getByLabelText("Summary")).toHaveTextContent("5 access levels");

    fireEvent.click(screen.getByRole("button", { name: "Set up my organisation" }));
    await screen.findByText(/Your organisation is set up/);
    const [plan, opts] = api.runOrgSetup.mock.calls[1];
    expect(opts).toEqual({ dryRun: false, sendInvitations: true });
    expect(plan.profiles.map((p) => p.name)).toContain("Finance Lead");
    expect(plan.departments.map((d) => d.name)).toContain("Post-production");
    expect(plan.roleSlots.map((r) => r.label)).toEqual(["Business owner", "Creative lead", "Producer"]);
    expect(plan.defaultProjectVisibility).toBe("WORKSPACE");
    expect(plan.members).toEqual([{ name: "Asha", email: "asha@example.com", role: "MEMBER", profile: "Department Member", departments: ["Creative"] }]);
    expect(plan).not.toHaveProperty("enableAccessControl");
    expect(reload).toHaveBeenCalled();
    expect(screen.getByText(/Nobody is limited yet/)).toBeInTheDocument();
    expect(api.updateAccessSettings).not.toHaveBeenCalled();
  });

  it("switches department access on only after the person confirms", async () => {
    show({ departments: [{ id: "d1", name: "Sales" }] });
    for (let i = 0; i < 5; i++) next();
    await screen.findByText("Create department 'Sales'");
    fireEvent.click(screen.getByRole("button", { name: "Set up my organisation" }));
    await screen.findByText(/Your organisation is set up/);
    fireEvent.click(screen.getByRole("button", { name: "Switch department access on now" }));
    await waitFor(() => expect(api.updateAccessSettings).toHaveBeenCalledWith({ accessControlEnabled: true }));
  });

  it("does not switch it on when the person says no", async () => {
    show({ departments: [{ id: "d1", name: "Sales" }] }, false);
    for (let i = 0; i < 5; i++) next();
    await screen.findByText("Create department 'Sales'");
    fireEvent.click(screen.getByRole("button", { name: "Set up my organisation" }));
    await screen.findByText(/Your organisation is set up/);
    fireEvent.click(screen.getByRole("button", { name: "Switch department access on now" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.updateAccessSettings).not.toHaveBeenCalled();
  });

  it("shows the server's reason in plain words if the check fails, and does not allow applying", async () => {
    api.runOrgSetup.mockRejectedValueOnce({ response: { data: { message: "Profile 'X' is not defined." } } });
    show({ departments: [{ id: "d1", name: "Sales" }] });
    for (let i = 0; i < 5; i++) next();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Profile 'X' is not defined|couldn't check/i);
    expect(screen.getByRole("button", { name: "Set up my organisation" })).toBeDisabled();
  });

  it("starts from what the workspace already has, and leaves owners and admins alone", () => {
    show({
      profiles: [{ id: "p1", name: "Assigned Work Only", scope: "ASSIGNED_ONLY", capabilities: [] }],
      departments: [{ id: "d1", name: "Post-production" }],
      members: [{ id: "m1", name: "Hafeez", email: "h@x.com", role: "MEMBER", designation: "Editor", accessProfileId: "p1", departmentIds: ["d1"] },
                { id: "m0", name: "Kevin", email: "k@x.com", role: "OWNER" }],
    });
    expect(screen.getByRole("button", { name: /Post-production/ })).toHaveAttribute("aria-pressed", "true");
    next(); next(); next(); // to "People"
    expect(screen.getByText(/Owner: sees everything, nothing to set/)).toBeInTheDocument();
    expect(screen.getByLabelText("Access level of Hafeez")).toHaveValue("Assigned Work Only");
    expect(screen.getByLabelText("Job title of Hafeez")).toHaveValue("Editor");
  });
});
