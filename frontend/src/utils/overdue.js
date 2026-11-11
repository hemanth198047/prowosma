/**
 * The Dashboard's definition of an overdue task, shared so the Tasks table,
 * Tasks list view and Kanban mark the same tasks: past its due date and not
 * DONE.
 */
export function isTaskOverdue(task, now = new Date()) {
  return !!task?.dueDate && new Date(task.dueDate) < now && task.status !== "DONE";
}

/** Same red the Dashboard uses for overdue dates. */
export const OVERDUE_COLOR = "#ef4444";
