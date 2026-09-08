import client from './client';
export const getNotifications = () => client.get('/notifications');
export const getUnreadCount = () => client.get('/notifications/count');
export const markRead = (id) => client.patch(`/notifications/${id}/read`);
export const markAllRead = () => client.patch('/notifications/read-all');
export const deleteNotification = (id) => client.delete(`/notifications/${id}`);
export const deleteAllNotifications = () => client.delete('/notifications');