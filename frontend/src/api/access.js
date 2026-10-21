import client from "./client";

// Any signed-in member: what may I see and do in this workspace?
export const getMyAccess = () => client.get("/access/me", { _noCache: true });
// Department names and project roles (any member) — for the project access dialog.
export const getAccessOptions = () => client.get("/access/options", { _noCache: true });

// Workspace owner / admin only.
export const getAccessSettings = () => client.get("/admin/access/settings", { _noCache: true });
export const updateAccessSettings = (body) => client.put("/admin/access/settings", body);

export const getAccessProfiles = () => client.get("/admin/access/profiles", { _noCache: true });
export const createAccessProfile = (body) => client.post("/admin/access/profiles", body);
export const updateAccessProfile = (id, body) => client.put(`/admin/access/profiles/${id}`, body);
export const deleteAccessProfile = (id) => client.delete(`/admin/access/profiles/${id}`);

export const getDepartments = () => client.get("/admin/access/departments", { _noCache: true });
export const createDepartment = (body) => client.post("/admin/access/departments", body);
export const updateDepartment = (id, body) => client.put(`/admin/access/departments/${id}`, body);
export const setDepartmentMembers = (id, emails) => client.put(`/admin/access/departments/${id}/members`, { emails });
export const deleteDepartment = (id) => client.delete(`/admin/access/departments/${id}`);

export const getAccessMembers = () => client.get("/admin/access/members", { _noCache: true });
export const updateAccessMember = (id, body) => client.put(`/admin/access/members/${id}`, body);

export const runOrgSetup = (plan, { dryRun = true, sendInvitations = false } = {}) =>
  client.post(`/admin/access/org-setup?dryRun=${dryRun}&sendInvitations=${sendInvitations}`, plan);

// Project-level visibility and named people (project owner / department admin / admin).
export const updateProjectAccess = (projectId, body) => client.put(`/projects/${projectId}/access`, body);
