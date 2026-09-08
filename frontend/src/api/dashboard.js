import client from './client';

// Phase 1 — critical shell data (<200ms target)
// Returns: workspace name, unread notifications count, hero KPIs
export const getDashboardSummary = () => client.get('/dashboard/summary');

// Phase 2 — cards (loaded after shell renders)
export const getDashboardProjects = () => client.get('/projects', { params: { limit: 6, status: 'ACTIVE' }, _noCache: true });
export const getDashboardGoals    = () => client.get('/goals', { params: { limit: 6, status: 'ACTIVE' }, _noCache: true });
export const getDashboardTasks    = () => client.get('/tasks?limit=10&assignedToMe=true&sort=dueDate');

// Phase 3 — heavy widgets (loaded last, non-blocking)
export const getDashboardCharts   = () => client.get('/analytics?view=dashboard&period=30d');
export const getDashboardAI       = () => client.get('/ai/intelligence/recommendations');
export const getDashboardActivity = () => client.get('/activity-logs?limit=8');
export const getDashboardMeetingPulse = () => client.get('/dashboard/meeting-pulse');
