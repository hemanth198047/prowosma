import client, { unwrapList } from "./client";

export const getMeetings      = (wsId, params) =>
  client.get("/meetings", { params: { workspaceId: wsId, ...params } });
// getMeetingsByDoc (GET /meetings/doc/{docId}) was removed — it had zero
// callers anywhere in the frontend, and no backend route ever matched it
// either (MeetingController only exposes root + /{id}, no /doc/{docId}
// sub-path), unlike api/decisions.js's getDecisionsByDoc which is actively
// called from Docs.jsx and has now had its matching backend endpoint built.
// Calendar: every meeting starting inside [from, to] (Dates, sent as UTC).
export const getMeetingsInRange = (from, to) =>
  client.get("/meetings", { params: { from: from.toISOString(), to: to.toISOString() } });
export const getMeeting       = (id)    => client.get(`/meetings/${id}`);
export const createMeeting    = (data)  => client.post("/meetings", data);
export const updateMeeting    = (id, data) => client.put(`/meetings/${id}`, data);
export const deleteMeeting    = (id)    => client.delete(`/meetings/${id}`);
export const completeMeeting  = (id)    => client.post(`/meetings/${id}/complete`);
export const addActionItem    = (id, data) => client.post(`/meetings/${id}/action-items`, data);
export const toggleActionItem = (id, itemId) => client.patch(`/meetings/${id}/action-items/${itemId}/toggle`);
export const extractMeeting   = (notes) => client.post("/ai/extract-meeting", { notes });
export const markActionConverted = (meetingId, itemId) =>
  client.patch(`/meetings/${meetingId}/action-items/${itemId}/toggle`);

// ── Meeting Continuity ──────────────────────────────────────────
// Pre-meeting "prepare" view — no meeting id needed yet.
export const getMeetingsPrepare = (projectIds) =>
  client.get("/meetings/prepare", { params: projectIds?.length ? { projectIds } : {} });

// Carry-forward context scoped to a specific (already-created) meeting.
export const getMeetingContinuity  = (id) => client.get(`/meetings/${id}/continuity`);
export const getMeetingWhatsChanged = (id) => client.get(`/meetings/${id}/whats-changed`);
export const getMeetingSummary      = (id) => client.get(`/meetings/${id}/summary`);
export const getMeetingsForProject  = (projectId, params) =>
  client.get(`/meetings/project/${projectId}`, { params });
export const getMeetingTrends = (days = 14) => client.get("/meetings/trends", { params: { days } });

// Project discussions (multi-project meeting content)
export const upsertProjectDiscussion = (meetingId, body) =>
  client.post(`/meetings/${meetingId}/projects`, body);

export const addActionItemForProject = (meetingId, projectId, body) =>
  client.post(`/meetings/${meetingId}/projects/${projectId}/action-items`, body);
export const carryActionItemIntoMeeting = (meetingId, projectId, actionItemId) =>
  client.post(`/meetings/${meetingId}/projects/${projectId}/action-items/${actionItemId}/carry`);

export const addBlockerForProject = (meetingId, projectId, body) =>
  client.post(`/meetings/${meetingId}/projects/${projectId}/blockers`, body);
export const carryBlockerIntoMeeting = (meetingId, projectId, raidId) =>
  client.post(`/meetings/${meetingId}/projects/${projectId}/blockers/${raidId}/carry`);

export const addDecisionForProject = (meetingId, projectId, body) =>
  client.post(`/meetings/${meetingId}/projects/${projectId}/decisions`, body);
export const carryDecisionIntoMeeting = (meetingId, projectId, decisionId) =>
  client.post(`/meetings/${meetingId}/projects/${projectId}/decisions/${decisionId}/carry`);

// Always-array helpers
export const fetchMeetings    = async (wsId, params) => unwrapList(await getMeetings(wsId, params));
