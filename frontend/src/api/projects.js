import client, { unwrapList, unwrapPaged } from "./client";

export const getProjects        = (params) => client.get("/projects", { params });
export const getProject         = (id)     => client.get(`/projects/${id}`);
export const createProject      = (data)   => client.post("/projects", data);
export const updateProject      = (id, data) => client.put(`/projects/${id}`, data);
export const deleteProject      = (id)     => client.delete(`/projects/${id}`);
export const cloneProject       = (id, name) => client.post(`/projects/${id}/clone`, { name });
export const archiveProject     = (id)     => client.post(`/projects/${id}/archive`);
export const unarchiveProject   = (id)     => client.post(`/projects/${id}/unarchive`);
export const getProjectProgress = (id)     => client.get(`/projects/${id}/progress`);
export const getSubProjects     = (id)     => client.get(`/projects/${id}/subprojects`);
export const getRootProjects    = ()       => client.get("/projects/roots");

// Always-array helpers
export const fetchProjects      = async (params) => unwrapList(await getProjects(params));
export const fetchProjectsPaged = async (params) => unwrapPaged(await getProjects(params));
