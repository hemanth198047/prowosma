import client from "./client";
export const getIntegrations = () => client.get("/integrations");
export const saveIntegration = (data) => client.post("/integrations", data);
export const upsertIntegration = (key, data) => client.put(`/integrations/${key}`, data);
export const toggleIntegration = (key, enabled) =>
  client.patch(`/integrations/${key}/toggle`, { enabled });
export const syncGitHub = (id) =>
  client.post(`/integrations/${id}/sync/github`);
export const syncBitbucket = (id) =>
  client.post(`/integrations/${id}/sync/bitbucket`);
export const syncGitLab = (id) =>
  client.post(`/integrations/${id}/sync/gitlab`);
export const sendTeamsTest = (id, message) =>
  client.post(`/integrations/${id}/sync/teams`, { message });
// Returns { source, token, path }. The token is shown once; the server keeps only its hash.
export const createInboundToken = (id) =>
  client.post(`/integrations/${id}/inbound-token`);
export const sendSlack = (id, message) =>
  client.post(`/integrations/${id}/sync/slack`, { message });
export const syncCalendar = (id) =>
  client.post(`/integrations/${id}/sync/calendar`);
export const syncZapier = (id) =>
  client.post(`/integrations/${id}/sync/zapier`);
