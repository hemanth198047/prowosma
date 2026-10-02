import client from './client';

export const getDecisions = () => client.get('/decisions');
export const createDecision = (data) => client.post('/decisions', data);

export const fetchDecisions = async () => {
  const res = await getDecisions();
  return Array.isArray(res.data) ? res.data : [];
};
