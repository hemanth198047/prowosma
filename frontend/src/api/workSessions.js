import client from "./client";

const BASE = "/work-sessions";
const fresh = { headers: { "Cache-Control": "no-cache" } };

export const getMyWork      = ()                  => client.get(`${BASE}/me`, fresh);
export const startWork      = (projectId, note)   => client.post(`${BASE}/start`, { projectId, note });
export const stopWork       = (note)              => client.post(`${BASE}/stop`, note ? { note } : {});
export const getProjectTime = (projectId, params) => client.get(`${BASE}/project/${projectId}`, { ...fresh, params });
export const exportTime     = (params)            => client.get(`${BASE}/export.csv`, { ...fresh, params, responseType: "blob" });
export const deleteSession  = (id)                => client.delete(`${BASE}/${id}`);
