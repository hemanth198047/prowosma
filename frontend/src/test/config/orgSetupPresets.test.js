import { describe, it, expect } from "vitest";
import { buildPlan, roleKeys, initialState, describeLevel, LEVEL_PRESETS } from "../../config/orgSetupPresets";

const level = (over = {}) => ({ key: "k", name: "Department Member", description: "", scope: "MY_DEPARTMENTS", departmentAdmin: false, capabilities: ["CREATE_TASK"], selected: true, ...over });
const base = (over = {}) => ({
  departments: ["Sales", "Delivery"], levels: [level(), level({ key: "a", name: "Assigned Work Only", scope: "ASSIGNED_ONLY", capabilities: [] })],
  roles: ["Client owner"], people: [], projectVisibility: "DEPARTMENTS", docMode: "BOTH", defaultLevel: "Assigned Work Only", ...over,
});

describe("buildPlan — turns choices into the plan the server accepts", () => {
  it("includes only ticked access levels, and the rules the person chose", () => {
    const plan = buildPlan(base({ levels: [level(), level({ key: "x", name: "Finance Lead", selected: false })] }));
    expect(plan.profiles.map((p) => p.name)).toEqual(["Department Member"]);
    expect(plan.departments).toEqual([{ name: "Sales" }, { name: "Delivery" }]);
    expect(plan).toMatchObject({ docAccessMode: "BOTH", defaultProjectVisibility: "DEPARTMENTS" });
    expect(plan).not.toHaveProperty("enableAccessControl"); // setting up never switches anything on by itself
  });

  it("only lets 'decides who sees their departments' with department-level scope", () => {
    const plan = buildPlan(base({ levels: [level({ name: "Odd", scope: "ALL", departmentAdmin: true })] }));
    expect(plan.profiles[0].departmentAdmin).toBe(false);
  });

  it("sends only real people: valid email, never owners or admins, and only chosen departments and levels", () => {
    const plan = buildPlan(base({ people: [
      { name: "Asha", email: " asha@x.com ", designation: " Editor ", level: "Department Member", departments: ["Sales", "Gone"], role: "MEMBER" },
      { name: "No email", email: "", level: "", departments: [] },
      { name: "Bad", email: "nope", level: "", departments: [] },
      { name: "Boss", email: "boss@x.com", level: "", departments: [], locked: true, role: "OWNER" },
      { name: "Ghost level", email: "g@x.com", level: "Deleted level", departments: ["Delivery"], role: "VIEWER" },
    ] }));
    expect(plan.members).toEqual([
      { name: "Asha", email: "asha@x.com", role: "MEMBER", designation: "Editor", profile: "Department Member", departments: ["Sales"] },
      { name: "Ghost level", email: "g@x.com", role: "VIEWER", departments: ["Delivery"] },
    ]);
  });

  it("only names a default level that is actually part of the plan", () => {
    expect(buildPlan(base()).defaultProfile).toBe("Assigned Work Only");
    expect(buildPlan(base({ defaultLevel: "Not ticked" }))).not.toHaveProperty("defaultProfile");
  });
});

describe("roleKeys", () => {
  it("makes safe, unique keys that start with a letter", () => {
    expect(roleKeys(["Creative lead", "Creative-lead", "24x7 owner"])).toEqual([
      { key: "CREATIVE_LEAD", label: "Creative lead" },
      { key: "CREATIVE_LEAD_2", label: "Creative-lead" },
      { key: "ROLE_24X7_OWNER", label: "24x7 owner" },
    ]);
  });
});

describe("initialState — running the setup again starts from what already exists", () => {
  it("starts a fresh workspace with the recommended levels ticked", () => {
    const s = initialState({});
    expect(s.levels.filter((l) => l.selected).map((l) => l.name)).toEqual(LEVEL_PRESETS.filter((p) => p.recommended).map((p) => p.name));
    expect(s.defaultLevel).toBe("Assigned Work Only");
  });

  it("keeps existing departments, levels, people, rules and project roles", () => {
    const s = initialState({
      profiles: [{ id: "p1", name: "Assigned Work Only", scope: "ASSIGNED_ONLY", capabilities: [] }, { id: "p2", name: "Studio Lead", scope: "MY_DEPARTMENTS", capabilities: ["CREATE_TASK"] }],
      departments: [{ id: "d1", name: "Post-production" }],
      members: [{ id: "m1", name: "Hafeez", email: "h@x.com", role: "MEMBER", designation: "Editor", accessProfileId: "p2", departmentIds: ["d1"] }, { id: "m0", name: "Kevin", email: "k@x.com", role: "OWNER" }],
      settings: { defaultAccessProfileId: "p1", defaultProjectVisibility: "WORKSPACE", docAccessMode: "DEPARTMENTS", projectRoleSlots: [{ key: "A", label: "Client owner" }] },
    });
    expect(s.departments).toEqual(["Post-production"]);
    expect(s.levels.filter((l) => l.selected).map((l) => l.name).sort()).toEqual(["Assigned Work Only", "Studio Lead"]);
    expect(s.people.find((p) => p.email === "h@x.com")).toMatchObject({ level: "Studio Lead", departments: ["Post-production"], designation: "Editor", locked: false });
    expect(s.people.find((p) => p.email === "k@x.com").locked).toBe(true);
    expect(s).toMatchObject({ projectVisibility: "WORKSPACE", docMode: "DEPARTMENTS", defaultLevel: "Assigned Work Only", roles: ["Client owner"] });
  });
});

describe("describeLevel", () => {
  it("says in plain words what a level can see and do", () => {
    expect(describeLevel({ scope: "ASSIGNED_ONLY", capabilities: [] })).toBe("Sees only the work assigned to them. Can update the work assigned to them.");
    expect(describeLevel({ scope: "MY_DEPARTMENTS", departmentAdmin: true, capabilities: ["CREATE_TASK", "APPROVE"] }))
      .toContain("Can create tasks, approve work. Also decides who can see their departments' projects.");
  });
});
