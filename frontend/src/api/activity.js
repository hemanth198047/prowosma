import client from "./client";

export const getRecentActivity   = (limit = 50) => client.get(`/activity-logs?limit=${limit}`);
export const getGroupedActivity  = (limit = 200) => client.get(`/activity-logs?limit=${limit}`);
export const getWorkspaceHealth  = () => client.get("/activity-logs/summary");
export const getAlerts           = (limit = 20) => client.get(`/activity-logs?limit=${limit}`);
export const getActivityByEntity = (type, id)   => client.get(`/activity-logs?entityType=${type}&entityId=${id}`);
export const getActivityByType   = (type)        => client.get(`/activity-logs?action=${type}`);
export const getActivityForProject = (id, limit = 50) => client.get(`/activity-logs?projectId=${id}&limit=${limit}`);
export const getActivityForTask    = (id, limit = 50) => client.get(`/activity-logs?taskId=${id}&limit=${limit}`);
export const getActivityForGoal    = (id, limit = 50) => client.get(`/activity-logs?goalId=${id}&limit=${limit}`);
