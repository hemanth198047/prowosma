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
  return client.post(`${BASE}/meetings/transcript`, form);
};
export const registerUmaLink = (data) => client.post(`${BASE}/meetings/link`, data);

export const retryUmaMeeting      = (id) => client.post(`${BASE}/meetings/${id}/retry`);
export const regenerateUmaMeeting = (id) => client.post(`${BASE}/meetings/${id}/regenerate`);
export const cancelUmaMeeting     = (id) => client.post(`${BASE}/meetings/${id}/cancel`);
export const completeUmaMeeting   = (id) => client.post(`${BASE}/meetings/${id}/complete`);
export const deleteUmaMeeting     = (id) => client.delete(`${BASE}/meetings/${id}`);
export const shareUmaMeeting      = (id, data) => client.put(`${BASE}/meetings/${id}/sharing`, data);
export const editUmaSegment       = (id, seq, data) => client.patch(`${BASE}/meetings/${id}/segments/${seq}`, data);

export const editUmaAction    = (id, actionId, patch) => client.patch(`${BASE}/meetings/${id}/actions/${actionId}`, patch);
export const approveUmaAction = (id, actionId) => client.post(`${BASE}/meetings/${id}/actions/${actionId}/approve`);
export const rejectUmaAction  = (id, actionId) => client.post(`${BASE}/meetings/${id}/actions/${actionId}/reject`);
export const approveUmaActions = (id, actionIds) => client.post(`${BASE}/meetings/${id}/actions/approve`, { actionIds });

export const askUma = (id, question) => client.post(`${BASE}/meetings/${id}/ask`, { question }, { timeout: 0 });
export const exportUma = (id, format) =>
  client.get(`${BASE}/meetings/${id}/export`, { params: { format }, responseType: "blob", ...fresh });
