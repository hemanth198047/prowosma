/**
 * The Dashboard's definition of an overdue task, shared so the Tasks table,
 * Tasks list view and Kanban mark the same tasks: past its due date and not
 * DONE.
 */
const FINISHED = new Set(["DONE", "CANCELLED", "CANCELED", "CLOSED", "COMPLETED", "COMPLETE", "RESOLVED"]);

/** A task that is no longer open (done, closed, cancelled…) is never overdue. */
export const isFinishedStatus = (status) => FINISHED.has(String(status || "").trim().toUpperCase());

export function isTaskOverdue(task, now = new Date()) {
  return !!task?.dueDate && new Date(task.dueDate) < now && !isFinishedStatus(task.status);
}

/** Same red the Dashboard uses for overdue dates. */
export const OVERDUE_COLOR = "#ef4444";
