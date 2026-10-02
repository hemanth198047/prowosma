import client, { unwrapList } from './client';

export const getAutomations = () => client.get('/automations');
export const toggleAutomation = (id) => client.patch(`/automations/${id}/toggle`);

export const fetchAutomations = async () => unwrapList(await getAutomations());
