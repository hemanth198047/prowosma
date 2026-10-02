import client, { unwrapList } from './client';

export const getDocs = (params) => client.get('/docs', { params });
export const getDoc = (id) => client.get(`/docs/${id}`);
export const createDoc = (data) => client.post('/docs', data);

export const fetchDocs = async (params) => unwrapList(await getDocs(params));
