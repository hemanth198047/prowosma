import client, { unwrapList } from './client';

export const getChangeRequests = (params) => client.get('/changes', { params });
export const createChangeRequest = (data) => client.post('/changes', data);

export const fetchChangeRequests = async (params) => unwrapList(await getChangeRequests(params));
