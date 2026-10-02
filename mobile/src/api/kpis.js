import client, { unwrapList } from './client';

export const getKpis = () => client.get('/kpis');
export const getKpi = (id) => client.get(`/kpis/${id}`);

export const fetchKpis = async () => unwrapList(await getKpis());
