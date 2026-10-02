import client, { unwrapList } from './client';

export const getTeamMembers = () => client.get('/team');
export const fetchTeamMembers = async () => unwrapList(await getTeamMembers());
