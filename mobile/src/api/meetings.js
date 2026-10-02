import client, { unwrapList } from './client';

export const getMeetings = (params) => client.get('/meetings', { params });
export const getMeeting = (id) => client.get(`/meetings/${id}`);
export const createMeeting = (data) => client.post('/meetings', data);
export const addActionItem = (id, data) => client.post(`/meetings/${id}/action-items`, data);
export const toggleActionItem = (id, itemId) => client.patch(`/meetings/${id}/action-items/${itemId}/toggle`);
export const completeMeeting = (id) => client.post(`/meetings/${id}/complete`);

export const fetchMeetings = async (params) => unwrapList(await getMeetings(params));
