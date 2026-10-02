import client, { unwrapList } from './client';

export const getProgrammes = () => client.get('/programmes');
export const getInitiatives = () => client.get('/initiatives');

export const fetchProgrammes = async () => unwrapList(await getProgrammes());
export const fetchInitiatives = async () => unwrapList(await getInitiatives());
