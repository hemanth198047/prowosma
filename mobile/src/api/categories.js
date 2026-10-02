import client, { unwrapList } from './client';

export const getCategories = () => client.get('/categories');
export const createCategory = (data) => client.post('/categories', data);

export const fetchCategories = async () => unwrapList(await getCategories());
