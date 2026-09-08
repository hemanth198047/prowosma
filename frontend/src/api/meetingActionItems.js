import client from "./client";

export const getMeetingActionItems   = (params) => client.get("/meeting-action-items", { params });
export const getMeetingActionItem    = (id)      => client.get(`/meeting-action-items/${id}`);
export const updateMeetingActionItem = (id, data) => client.put(`/meeting-action-items/${id}`, data);

export const completeMeetingActionItem = (id, meetingId) =>
  client.post(`/meeting-action-items/${id}/complete`, null, { params: meetingId ? { meetingId } : {} });
export const dismissMeetingActionItem  = (id, meetingId) =>
  client.post(`/meeting-action-items/${id}/dismiss`, null, { params: meetingId ? { meetingId } : {} });
export const deferMeetingActionItem    = (id, deferredUntil, meetingId) =>
  client.post(`/meeting-action-items/${id}/defer`,
    deferredUntil ? { deferredUntil } : {},
    { params: meetingId ? { meetingId } : {} });
export const reassignMeetingActionItem = (id, owner) =>
  client.post(`/meeting-action-items/${id}/reassign`, { owner });

export const deleteMeetingActionItem = (id) => client.delete(`/meeting-action-items/${id}`);
