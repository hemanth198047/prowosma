import client from "./client";
export const getIntegrations = () => client.get("/integrations");
export const saveIntegration = (data) => client.post("/integrations", data);
export const upsertIntegration = (key, data) => client.put(`/integrations/${key}`, data);
export const toggleIntegration = (key, enabled) =>
  client.patch(`/integrations/${key}/toggle`, { enabled });
export const syncGitHub = (id) =>
  client.post(`/integrations/${id}/sync/github`);
export const sendSlack = (id, message) =>
  client.post(`/integrations/${id}/sync/slack`, { message });
export const syncCalendar = (id) =>
  client.post(`/integrations/${id}/sync/calendar`);
export const syncZapier = (id) =>
  client.post(`/integrations/${id}/sync/zapier`);
