/**
 * A starting point for "Organisation setup" (Access Control → Organisation setup). It is generic: a
 * company edits the names, or pastes its own structure. Nothing here is applied until an admin
 * previews it and chooses to apply it. Emails are left blank on purpose — fill in real work emails.
 */
export const EXAMPLE_ORG_SETUP = {
  profiles: [
    { name: "Department Admin", description: "Runs a department: sees its projects and manages their access.", scope: "MY_DEPARTMENTS", departmentAdmin: true,
      capabilities: ["CREATE_PROJECT", "CREATE_TASK", "ALLOCATE_TASKS", "APPROVE", "USE_MEETING_ASSISTANT"] },
    { name: "Department Member", description: "Works inside their department's projects.", scope: "MY_DEPARTMENTS", departmentAdmin: false,
      capabilities: ["CREATE_TASK", "USE_MEETING_ASSISTANT"] },
    { name: "Assigned Work Only", description: "Sees only the tasks assigned to them.", scope: "ASSIGNED_ONLY", departmentAdmin: false, capabilities: [] },
  ],
  departments: [{ name: "Sales" }, { name: "Delivery" }, { name: "Back office" }],
  roleSlots: [
    { key: "CLIENT_OWNER", label: "Client owner" },
    { key: "DELIVERY_LEAD", label: "Delivery lead" },
  ],
  docAccessMode: "BOTH",
  defaultProfile: "Assigned Work Only",
  defaultProjectVisibility: "DEPARTMENTS",
  members: [
    { name: "Example Head of Sales", email: "", designation: "Head of Sales", profile: "Department Admin", departments: ["Sales"] },
    { name: "Example Delivery Person", email: "", designation: "Producer", profile: "Department Member", departments: ["Delivery"] },
    { name: "Example Intern", email: "", designation: "Intern", profile: "Assigned Work Only", departments: ["Sales"] },
  ],
  enableAccessControl: false,
};
