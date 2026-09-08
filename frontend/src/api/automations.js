import client from "./client";

// Automations
export const getAutomations   = ()          => client.get("/automations");
export const getAutomation    = (id)        => client.get(`/automations/${id}`);
export const createAutomation = (data)      => client.post("/automations", data);
export const updateAutomation = (id, data)  => client.put(`/automations/${id}`, data);
export const deleteAutomation = (id)        => client.delete(`/automations/${id}`);
export const toggleAutomation = (id)        => client.patch(`/automations/${id}/toggle`);
export const testAutomation   = (id, ctx)   => client.post(`/automations/${id}/test`, ctx || {});

// Approvals
export const getApprovals    = ()           => client.get("/automations/approvals");
export const getApproval     = (id)         => client.get(`/automations/approvals/${id}`);
export const createApproval  = (data)       => client.post("/automations/approvals", data);
export const respondApproval = (id, data)   => client.post(`/automations/approvals/${id}/respond`, data);
export const escalateApproval= (id)         => client.post(`/automations/approvals/${id}/escalate`);
