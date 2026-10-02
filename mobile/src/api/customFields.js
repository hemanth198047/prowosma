import client from './client';

export const getCustomFields = () => client.get('/custom-fields');

export const fetchCustomFields = async () => {
  const res = await getCustomFields();
  return Array.isArray(res.data) ? res.data : [];
};
