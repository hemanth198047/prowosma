import client, { unwrapList, unwrapPaged } from "./client";

export const getSprints       = (params) => client.get("/sprints", { params });
export const getSprint        = (id)     => client.get(`/sprints/${id}`);
export const createSprint     = (data)   => client.post("/sprints", data);
export const updateSprint     = (id, data) => client.put(`/sprints/${id}`, data);
export const deleteSprint     = (id)     => client.delete(`/sprints/${id}`);
export const getSprintTasks   = (id)     => client.get(`/sprints/${id}/tasks`);
export const addTaskToSprint  = (id, taskId) => client.post(`/sprints/${id}/tasks/${taskId}`);
export const removeTaskFromSprint = (id, taskId) => client.delete(`/sprints/${id}/tasks/${taskId}`);
export const getBurndown      = (id)     => client.get(`/sprints/${id}/burndown`);
export const saveRetro        = (id, data) => client.post(`/sprints/${id}/retrospective`, data);

// Always-array helpers
export const fetchSprints     = async (params) => unwrapList(await getSprints(params));
export const fetchSprintsPaged= async (params) => unwrapPaged(await getSprints(params));
