import client from "./client";

// Universal AI Meeting Assistant (/api/v2/meeting-assistant). Separate from ./meetingAssistant (the existing feature).
// Every GET skips the 30-second response cache: meetings change while they are being processed.
const BASE = "/v2/meeting-assistant";
const fresh = { _noCache: true };

export const getUmaStatus     = ()      => client.get(`${BASE}/status`, fresh);
export const getUmaDashboard  = ()      => client.get(`${BASE}/dashboard`, fresh);
export const getUmaProviders  = ()      => client.get(`${BASE}/providers`, fresh);
export const detectUmaLink    = (url)   => client.post(`${BASE}/detect-link`, { url });
export const getUmaMeeting    = (id)    => client.get(`${BASE}/meetings/${id}`, fresh);
export const getUmaAudit      = (id)    => client.get(`${BASE}/meetings/${id}/audit`, fresh);

/** The recording is sent as the raw request body (no 1 MB form limit; the server streams it to disk). */
export const uploadUmaRecording = (file, { title, projectId, meetingAt, timezone, consent }, onProgress) =>
  client.post(`${BASE}/meetings/recording`, file, {
    params: { fileName: file.name, title, projectId, meetingAt, timezone, consent },
    headers: { "Content-Type": file.type || "application/octet-stream" },
    onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : null),
    timeout: 0,
  });

export const addUmaRecording = (id, file, consent, onProgress) =>
  client.post(`${BASE}/meetings/${id}/recording`, file, {
    params: { fileName: file.name, consent },
    headers: { "Content-Type": file.type || "application/octet-stream" },
    onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : null),
    timeout: 0,
  });

export const importUmaTranscriptText = (data) => client.post(`${BASE}/meetings/transcript`, data);
export const importUmaTranscriptFile = (file, { title, projectId, meetingAt, timezone }) => {
  const form = new FormData();
  form.append("file", file);
  if (title) form.append("title", title);
  if (projectId) form.append("projectId", projectId);
  if (meetingAt) form.append("meetingAt", meetingAt);
  if (timezone) form.append("timezone", timezone);
  return client.post(`${BASE}/meetings/transcript`, form, MULTIPART);
};
// The shared client defaults to JSON, which would turn a FormData into an empty JSON body; files must go as multipart.
const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };
export const attachUmaTranscript = (id, file) => {
  const form = new FormData();
  form.append("file", file);
  return client.post(`${BASE}/meetings/${id}/transcript`, form, MULTIPART);
};
export const registerUmaLink = (data) => client.post(`${BASE}/meetings/link`, data);

export const retryUmaMeeting      = (id) => client.post(`${BASE}/meetings/${id}/retry`);
export const regenerateUmaMeeting = (id) => client.post(`${BASE}/meetings/${id}/regenerate`);
export const cancelUmaMeeting     = (id) => client.post(`${BASE}/meetings/${id}/cancel`);
export const completeUmaMeeting   = (id) => client.post(`${BASE}/meetings/${id}/complete`);
export const deleteUmaMeeting     = (id) => client.delete(`${BASE}/meetings/${id}`);
export const deleteUmaMeetings    = (ids) => client.post(`${BASE}/meetings/delete`, { ids });
/** Meetings older than `olderThanDays` (0 = all that already happened): preview counts, clear deletes. */
export const previewUmaCleanup    = (olderThanDays) => client.get(`${BASE}/meetings/cleanup`, { params: { olderThanDays }, ...fresh });
export const clearUmaOldMeetings  = (olderThanDays) => client.post(`${BASE}/meetings/cleanup`, null, { params: { olderThanDays } });
export const shareUmaMeeting      = (id, data) => client.put(`${BASE}/meetings/${id}/sharing`, data);
export const editUmaSegment       = (id, seq, data) => client.patch(`${BASE}/meetings/${id}/segments/${seq}`, data);

export const editUmaAction    = (id, actionId, patch) => client.patch(`${BASE}/meetings/${id}/actions/${actionId}`, patch);
export const approveUmaAction = (id, actionId) => client.post(`${BASE}/meetings/${id}/actions/${actionId}/approve`);
export const rejectUmaAction  = (id, actionId) => client.post(`${BASE}/meetings/${id}/actions/${actionId}/reject`);
export const approveUmaActions = (id, actionIds) => client.post(`${BASE}/meetings/${id}/actions/approve`, { actionIds });

export const askUma = (id, question) => client.post(`${BASE}/meetings/${id}/ask`, { question }, { timeout: 0 });
export const exportUma = (id, format) =>
  client.get(`${BASE}/meetings/${id}/export`, { params: { format }, responseType: "blob", ...fresh });

// Recording in the browser: start, send short pieces while the meeting runs, then finish.
export const startUmaCapture  = (data) => client.post(`${BASE}/meetings/capture`, data);
export const uploadUmaPiece   = (id, track, seq, blob, startMs, durationMs) =>
  client.put(`${BASE}/meetings/${id}/capture/${track}/${seq}`, blob, {
    params: { startMs: Math.round(startMs), durationMs: Math.round(durationMs) },
    headers: { "Content-Type": blob.type || "audio/webm" },
    timeout: 120000,
  });
export const finishUmaCapture = (id) => client.post(`${BASE}/meetings/${id}/capture/finish`);

// Connections and meeting apps
export const getUmaFireflies     = ()      => client.get(`${BASE}/connections/fireflies`, fresh);
export const saveUmaFirefliesKey = (apiKey) => client.put(`${BASE}/connections/fireflies`, { apiKey });
export const removeUmaFireflies  = ()      => client.delete(`${BASE}/connections/fireflies`);
export const getUmaFirefliesRecent = ()    => client.get(`${BASE}/fireflies/recent`, fresh);
export const importUmaFireflies  = (transcriptId, projectId) => client.post(`${BASE}/meetings/fireflies`, { transcriptId, projectId });
export const sendUmaNotetaker    = (id)    => client.post(`${BASE}/meetings/${id}/fireflies/notetaker`);
export const getUmaGoogle        = ()      => client.get(`${BASE}/connections/google`, fresh);
export const authorizeUmaGoogle  = ()      => client.post(`${BASE}/connections/google/authorize`);
export const disconnectUmaGoogle = ()      => client.delete(`${BASE}/connections/google`);
export const getUmaMicrosoft        = ()      => client.get(`${BASE}/connections/microsoft`, fresh);
export const authorizeUmaMicrosoft  = ()      => client.post(`${BASE}/connections/microsoft/authorize`);
export const completeUmaMicrosoft   = (code, state) => client.post(`${BASE}/connections/microsoft/complete`, { code, state });
export const disconnectUmaMicrosoft = ()      => client.delete(`${BASE}/connections/microsoft`);
// What the assistant does on its own after a meeting (workspace, admins) and each person's preferences
export const getUmaAutomationSettings = ()    => client.get(`${BASE}/settings/automation`, fresh);
export const saveUmaWorkspaceAutomation = (data) => client.put(`${BASE}/settings/automation`, data);
export const saveUmaMyPreferences = (data)    => client.put(`${BASE}/settings/me`, data);
// Projects a meeting asked for: op = create | link | dismiss
export const decideUmaProject = (id, itemId, op, projectId) => client.post(`${BASE}/meetings/${id}/projects/${itemId}/${op}`, projectId ? { projectId } : {});
export const fetchUmaGoogle      = (id)    => client.post(`${BASE}/meetings/${id}/google/fetch`);

// Google sign-in for this module (Meet + Calendar), scheduling and automation
export const completeUmaGoogle     = (code, state) => client.post(`${BASE}/connections/google/complete`, { code, state });
export const setUmaGooglePrefs     = (prefs)       => client.put(`${BASE}/connections/google/preferences`, prefs);
export const syncUmaCalendar       = ()            => client.post(`${BASE}/connections/google/sync`);
export const scheduleUmaMeeting    = (data)        => client.post(`${BASE}/meetings/schedule`, data);
export const setUmaAutoFireflies   = (id, on)      => client.put(`${BASE}/meetings/${id}/automation`, { autoFireflies: on });
export const checkUmaMeeting       = (id)          => client.post(`${BASE}/meetings/${id}/check`);
export const startUmaInstantMeeting = (data)        => client.post(`${BASE}/meetings/instant`, data);

// ── Merged from Meetings (notes) and the first Meeting assistant ──
export const createUmaNotes        = (body)                  => client.post(`${BASE}/meetings/notes`, body);
export const editUmaSummary        = (id, summary)           => client.put(`${BASE}/meetings/${id}/summary`, { summary });
export const restoreUmaSummary     = (id, number)            => client.post(`${BASE}/meetings/${id}/summary/versions/${number}/restore`);
export const logUmaDecision        = (id, decisionId, body)  => client.post(`${BASE}/meetings/${id}/decisions/${decisionId}/log`, body || {});
export const logUmaRisk            = (id, findingId, body)   => client.post(`${BASE}/meetings/${id}/risks/${findingId}/raid`, body || {});
export const getUmaSimilarTasks    = (id, actionId)          => client.get(`${BASE}/meetings/${id}/actions/${actionId}/similar`, fresh);
export const linkUmaActionToTask   = (id, actionId, taskId)  => client.post(`${BASE}/meetings/${id}/actions/${actionId}/link`, { taskId });
export const getUmaContinuity      = (id)                    => client.get(`${BASE}/meetings/${id}/continuity`, fresh);
export const getUmaPrepare         = (projectId)             => client.get(`${BASE}/prepare`, { params: { projectId: projectId || undefined }, ...fresh });
export const getUmaOpenActions     = (projectId, limit = 100) => client.get(`${BASE}/actions`, { params: { projectId: projectId || undefined, limit }, ...fresh });
export const getUmaTrends          = (days = 30)             => client.get(`${BASE}/trends`, { params: { days }, ...fresh });
export const getUmaProjectMeetings = (projectId, limit = 10) => client.get(`${BASE}/meetings`, { params: { projectId, limit }, ...fresh });
