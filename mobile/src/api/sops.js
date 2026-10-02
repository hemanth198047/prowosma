import client, { unwrapList } from './client';

export const getSops = (params) => client.get('/sops', { params });
export const getSop = (id) => client.get(`/sops/${id}`);

export const fetchSops = async (params) => unwrapList(await getSops(params));
