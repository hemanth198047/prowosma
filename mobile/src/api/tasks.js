import client, { unwrapList } from './client';

export const getTasks = (params) => client.get('/tasks', { params });
export const getTask = (id) => client.get(`/tasks/${id}`);
export const createTask = (data) => client.post('/tasks', data);
export const updateTask = (id, data) => client.put(`/tasks/${id}`, data);
export const patchTask = (id, data) => client.patch(`/tasks/${id}`, data);
export const deleteTask = (id) => client.delete(`/tasks/${id}`);

export const fetchTasks = async (params) => unwrapList(await getTasks(params));
export const addTimeLog = (id, data) => client.post(`/tasks/${id}/timelogs`, data);
