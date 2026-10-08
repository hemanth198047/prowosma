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
// Summary, minutes and notes
export const generateMeetingOutputs   = (id)             => client.post(`/meeting-assistant/sessions/${id}/generate`, {});
export const getMeetingArtifacts      = (id)             => client.get(`/meeting-assistant/sessions/${id}/artifacts`);
export const getArtifactVersions      = (id, type)       => client.get(`/meeting-assistant/sessions/${id}/artifacts/${type}/versions`);
export const getArtifactVersion       = (id, type, n)    => client.get(`/meeting-assistant/sessions/${id}/artifacts/${type}/versions/${n}`);
export const getArtifactDiff          = (id, type, from, to) => client.get(`/meeting-assistant/sessions/${id}/artifacts/${type}/diff`, { params: { from, to } });
export const saveArtifact             = (id, type, baseVersion, markdown) => client.put(`/meeting-assistant/sessions/${id}/artifacts/${type}`, { baseVersion, markdown });
export const restoreArtifact          = (id, type, version) => client.post(`/meeting-assistant/sessions/${id}/artifacts/${type}/restore`, { version });
export const acceptPendingArtifact    = (id, type)       => client.post(`/meeting-assistant/sessions/${id}/artifacts/${type}/accept`, {});
export const dismissPendingArtifact   = (id, type)       => client.post(`/meeting-assistant/sessions/${id}/artifacts/${type}/dismiss`, {});
export const getAiUsage               = (days = 30)      => client.get("/admin/meeting-assistant/usage", { params: { days } });

// Structured actions: extract, review, preview
export const extractMeetingActions     = (id)            => client.post(`/meeting-assistant/sessions/${id}/actions/extract`, {});
export const getMeetingActions         = (id)            => client.get(`/meeting-assistant/sessions/${id}/actions`);
export const getMeetingActionsPreview  = (id)            => client.get(`/meeting-assistant/sessions/${id}/actions/preview`);
export const patchMeetingAction        = (id, aid, data) => client.patch(`/meeting-assistant/sessions/${id}/actions/${aid}`, data);
export const decideMeetingAction       = (id, aid, decision) => client.post(`/meeting-assistant/sessions/${id}/actions/${aid}/decision`, { decision });
export const mergeMeetingAction        = (id, aid, intoId) => client.post(`/meeting-assistant/sessions/${id}/actions/${aid}/merge`, { intoId });
// Review mode: create every approved project and task now (repeat-safe: only what is not created yet, or failed, is attempted)
export const createMeetingRecords      = (id)            => client.post(`/meeting-assistant/sessions/${id}/create`, {});
export const approveValidMeetingActions = (id)           => client.post(`/meeting-assistant/sessions/${id}/actions/approve-valid`, {});
export const resolveMeetingActionsDiff = (id, apply)     => client.post(`/meeting-assistant/sessions/${id}/actions/diff`, { apply });
export const patchProposedProject      = (id, pid, data) => client.patch(`/meeting-assistant/sessions/${id}/proposed-projects/${pid}`, data);
export const decideProposedProject     = (id, pid, decision) => client.post(`/meeting-assistant/sessions/${id}/proposed-projects/${pid}/decision`, { decision });

// Transcripts
export const addMeetingTranscript     = (id, data)   => client.post(`/meeting-assistant/sessions/${id}/transcript`, data);
export const getMeetingTranscript     = (id, params) => client.get(`/meeting-assistant/sessions/${id}/transcript`, { params });
export const deleteMeetingTranscript  = (id)         => client.delete(`/meeting-assistant/sessions/${id}/transcript`);
export const fetchMeetingTranscriptNow = (id)        => client.post(`/meeting-assistant/sessions/${id}/fetch`);

// Each person's own Google connection (Google's Meet API only supports user sign-in)
export const getGoogleConnection      = ()           => client.get("/meeting-assistant/google/connection");
export const startGoogleConnect       = ()           => client.post("/meeting-assistant/google/authorize");
export const completeGoogleConnect    = (code, state) => client.post("/meeting-assistant/google/connect", { code, state });
export const disconnectGoogle         = ()           => client.delete("/meeting-assistant/google/connection");

// Development fixture — the server answers 404 unless it is explicitly enabled.
export const devAdvanceMeetingSession = (id, status) => client.post(`/meeting-assistant/sessions/${id}/dev/advance`, { status });

// Administrators (server enforces ADMIN/OWNER, including for reads)
export const getAssistantSettings     = ()          => client.get("/admin/meeting-assistant/settings");
export const updateAssistantSettings  = (data)      => client.put("/admin/meeting-assistant/settings", data);
export const getMeetingPlatforms      = ()          => client.get("/admin/meeting-assistant/platforms");
export const setMeetingPlatformEnabled = (p, enabled) => client.put(`/admin/meeting-assistant/platforms/${p}/enabled`, { enabled });
export const testMeetingPlatform      = (p)         => client.post(`/admin/meeting-assistant/platforms/${p}/test`);
export const disconnectMeetingPlatform = (p)        => client.delete(`/admin/meeting-assistant/platforms/${p}`);
