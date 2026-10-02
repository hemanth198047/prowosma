import client, { unwrapList } from './client';

export const getChannels = (params) => client.get('/channels', { params });
export const createChannel = (data) => client.post('/channels', data);
export const deleteChannel = (id) => client.delete(`/channels/${id}`);
export const getChannelMessages = (id, params) => client.get(`/channels/${id}/messages`, { params });
export const postChannelMessage = (id, data) => client.post(`/channels/${id}/messages`, data);
export const deleteChannelMessage = (id, msgId) => client.delete(`/channels/${id}/messages/${msgId}`);

export const fetchChannels = async (params) => unwrapList(await getChannels(params));
export const fetchChannelMessages = async (id, params) => unwrapList(await getChannelMessages(id, params));
