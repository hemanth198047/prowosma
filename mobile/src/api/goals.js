import client, { unwrapList } from './client';

export const getGoals = (params) => client.get('/goals', { params });
export const getGoal = (id) => client.get(`/goals/${id}`);
export const createGoal = (data) => client.post('/goals', data);
export const updateGoal = (id, data) => client.put(`/goals/${id}`, data);
export const updateGoalProgress = (id, progress) => client.patch(`/goals/${id}/progress`, { progress });
export const deleteGoal = (id) => client.delete(`/goals/${id}`);

export const fetchGoals = async (params) => unwrapList(await getGoals(params));
