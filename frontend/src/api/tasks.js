import client, { unwrapList, unwrapPaged } from "./client";

// ── Core CRUD ─────────────────────────────────────────────────
export const getTasks        = (params) => client.get("/tasks", { params });
export const getTasksAll     = (params) => client.get("/tasks/all", { params });
export const getTask         = (id)     => client.get(`/tasks/${id}`);
export const createTask      = (data)   => client.post("/tasks", data);
export const updateTask      = (id, data) => client.put(`/tasks/${id}`, data);
export const patchTask       = (id, data) => client.patch(`/tasks/${id}`, data);
export const deleteTask      = (id)     => client.delete(`/tasks/${id}`);

// ── Helpers that always return arrays ─────────────────────────
export const fetchTasks      = async (params) => unwrapList(await getTasks(params));
export const fetchTasksPaged = async (params) => unwrapPaged(await getTasks(params));

// ── By project ───────────────────────────────────────────────
export const getTasksByProject  = (projectId, params) =>
  client.get(`/tasks/project/${projectId}`, { params });
export const fetchTasksByProject = async (projectId, params) =>
  unwrapList(await getTasksByProject(projectId, params));

// ── Comments ─────────────────────────────────────────────────
export const addComment     = (id, data)        => client.post(`/tasks/${id}/comments`, data);
export const deleteComment  = (id, commentId)   => client.delete(`/tasks/${id}/comments/${commentId}`);
export const toggleReaction = (taskId, commentId, emoji) =>
  client.post(`/tasks/${taskId}/comments/${commentId}/reactions`, { emoji });

// ── Time logs ─────────────────────────────────────────────────
export const addTimeLog    = (id, data)       => client.post(`/tasks/${id}/timelogs`, data);
export const deleteTimeLog = (id, timeLogId)  => client.delete(`/tasks/${id}/timelogs/${timeLogId}`);

// ── Attachments ───────────────────────────────────────────────
export const addAttachment    = (id, formData) =>
  client.post(`/tasks/${id}/attachments`, formData, { headers: { "Content-Type": "multipart/form-data" } });
export const deleteAttachment = (id, attachmentId) =>
  client.delete(`/tasks/${id}/attachments/${attachmentId}`);
export const getAttachmentUrl = (fileName) =>
  `${client.defaults.baseURL}/tasks/attachments/${fileName}`;

// ── Dependencies ──────────────────────────────────────────────
export const addDependency    = (id, blockedByTaskId) =>
  client.post(`/tasks/${id}/dependencies`, { blockedByTaskId });
export const removeDependency = (id, blockedByTaskId) =>
  client.delete(`/tasks/${id}/dependencies/${blockedByTaskId}`);
export const getDependencies  = (id) => client.get(`/tasks/${id}/dependencies`);

// ── Subtasks ──────────────────────────────────────────────────
export const getSubtasks   = (id, params) => client.get(`/tasks/${id}/subtasks`, { params });
export const addSubtask    = (id, data)   => client.post(`/tasks/${id}/subtasks`, data);
export const fetchSubtasks = async (id)   => unwrapList(await getSubtasks(id));

// ── Checklist ─────────────────────────────────────────────────
export const updateChecklist    = (id, checklist) => client.patch(`/tasks/${id}/checklist`, { checklist });
export const addChecklistItem   = (id, item)      => client.post(`/tasks/${id}/checklist`, item);
export const toggleChecklistItem= (id, itemId)    => client.patch(`/tasks/${id}/checklist/${itemId}/toggle`);

// ── Relationships & SLA ───────────────────────────────────────
export const addRelationship    = (id, rel)      => client.post(`/tasks/${id}/relationships`, rel);
export const removeRelationship = (id, relId)    => client.delete(`/tasks/${id}/relationships/${relId}`);
export const setSla             = (id, slaHours) => client.patch(`/tasks/${id}/sla`, { slaHours });
export const linkGoal           = (id, data)     => client.patch(`/tasks/${id}/goal-link`, data);

// ── Watchers ─────────────────────────────────────────────────
export const addWatcher    = (id, email) => client.post(`/tasks/${id}/watchers/${email}`);
export const removeWatcher = (id, email) => client.delete(`/tasks/${id}/watchers/${email}`);

export const bulkImportTasks = (data) => client.post('/tasks/bulk-import', data);
