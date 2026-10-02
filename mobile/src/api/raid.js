import client, { unwrapList } from './client';

export const getRaidEntries = (params) => client.get('/raid', { params });
export const createRaidEntry = (data) => client.post('/raid', data);

export const fetchRaidEntries = async (params) => unwrapList(await getRaidEntries(params));
