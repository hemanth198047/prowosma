import client from './client';

export const getUsage = () => client.get('/admin/usage');
