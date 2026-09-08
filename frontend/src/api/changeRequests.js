import client, { unwrapList } from "./client";

// Backend: ChangeRequestController — /api/changes (GET list w/ optional
// projectId filter + pagination, POST create, PUT update, DELETE).
// There's no GET /changes/{id}; the list is the only read path, same
// pattern as DecisionLog.jsx uses for /decisions.
export const getChangeRequests    = (params)        => client.get("/changes", { params });
export const createChangeRequest  = (data)           => client.post("/changes", data);
export const updateChangeRequest  = (id, data)       => client.put(`/changes/${id}`, data);
export const deleteChangeRequest  = (id)             => client.delete(`/changes/${id}`);

// Always-array convenience, matching the pattern in api/projects.js
export const fetchChangeRequests  = async (params) => unwrapList(await getChangeRequests(params));
