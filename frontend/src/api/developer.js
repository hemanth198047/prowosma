import client from "./client";

// Webhooks
export const getWebhooks    = ()           => client.get("/webhooks");
export const createWebhook  = (data)       => client.post("/webhooks", data);
export const updateWebhook  = (id, data)   => client.put(`/webhooks/${id}`, data);
export const deleteWebhook  = (id)         => client.delete(`/webhooks/${id}`);
export const testWebhook    = (id)         => client.post(`/webhooks/${id}/test`);
export const regenSecret    = (id)         => client.post(`/webhooks/${id}/rotate-secret`);

// API Keys
export const getApiKeys     = ()           => client.get("/api-keys");
export const createApiKey   = (data)       => client.post("/api-keys", data);
export const revokeApiKey   = (id)         => client.delete(`/api-keys/${id}`);
export const deleteApiKey   = (id)         => client.delete(`/api-keys/${id}`);
