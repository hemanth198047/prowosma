import client from './client';

export const getMyWorkspaces = () => client.get('/workspaces');
export const getWorkspace = (id) => client.get(`/workspaces/${id}`);
