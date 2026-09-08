import client from "./client";

export const getSops          = (wsId, params)  => client.get("/sops", { params: { workspaceId: wsId, ...params } });
export const getSop           = (id)             => client.get(`/sops/${id}`);
export const createSop        = (data)           => client.post("/sops", data);
export const updateSop        = (id, data)       => client.put(`/sops/${id}`, data);
export const deleteSop        = (id)             => client.delete(`/sops/${id}`);
export const publishSop       = (id, changeNote) => client.post(`/sops/${id}/publish`, { changeNote });
export const archiveSop       = (id)             => client.post(`/sops/${id}/archive`);
export const acknowledgeSop   = (id, data)       => client.post(`/sops/${id}/acknowledge`, data);
export const revokeAckSop     = (id)             => client.delete(`/sops/${id}/acknowledge`);
