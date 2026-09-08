import client from "./client";

export const getMyWorkspaces = () => client.get("/workspaces", { _noCache: true });
export const getWorkspace = (id) => client.get(`/workspaces/${id}`);
export const createWorkspace = (data) => client.post("/workspaces", data);
export const updateWorkspace = (id, data) => client.put(`/workspaces/${id}`, data);
export const deleteWorkspace = (id) => client.delete(`/workspaces/${id}`);