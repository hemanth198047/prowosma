import client from "./client";

// Everyday use
export const getAssistantCapabilities = ()          => client.get("/meeting-assistant/capabilities");
export const validateMeetingUrl       = (url)       => client.post("/meeting-assistant/validate-url", { url });
export const listMeetingSessions      = ()          => client.get("/meeting-assistant/sessions");
export const createMeetingSession     = (data)      => client.post("/meeting-assistant/sessions", data);
export const getMeetingSession        = (id)        => client.get(`/meeting-assistant/sessions/${id}`);
export const cancelMeetingSession     = (id)        => client.post(`/meeting-assistant/sessions/${id}/cancel`);
export const retryMeetingSession      = (id)        => client.post(`/meeting-assistant/sessions/${id}/retry`);
export const updateMeetingAccess      = (id, data)  => client.put(`/meeting-assistant/sessions/${id}/access`, data);
// Development fixture — the server answers 404 unless it is explicitly enabled.
export const devAdvanceMeetingSession = (id, status) => client.post(`/meeting-assistant/sessions/${id}/dev/advance`, { status });

// Administrators (server enforces ADMIN/OWNER, including for reads)
export const getAssistantSettings     = ()          => client.get("/admin/meeting-assistant/settings");
export const updateAssistantSettings  = (data)      => client.put("/admin/meeting-assistant/settings", data);
export const getMeetingPlatforms      = ()          => client.get("/admin/meeting-assistant/platforms");
export const setMeetingPlatformEnabled = (p, enabled) => client.put(`/admin/meeting-assistant/platforms/${p}/enabled`, { enabled });
export const testMeetingPlatform      = (p)         => client.post(`/admin/meeting-assistant/platforms/${p}/test`);
export const disconnectMeetingPlatform = (p)        => client.delete(`/admin/meeting-assistant/platforms/${p}`);
