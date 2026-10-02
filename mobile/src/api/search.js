import client from './client';

// /quick returns a plain array directly (unlike most list endpoints in
// this app) — see GlobalSearchController.quickSearch on the backend.
export const quickSearch = (q) => client.get('/search/global/quick', { params: { q } });

export const fetchQuickSearch = async (q) => {
  const res = await quickSearch(q);
  return Array.isArray(res.data) ? res.data : [];
};
