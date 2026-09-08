/**
 * EntityActivityTab — reusable activity history tab for Project, Task, Goal pages.
 */
import { useState, useEffect } from "react";
import { getActivityForProject, getActivityForTask, getActivityForGoal } from "../api/activity";
import { timeAgo } from "../utils/dateUtils";

const ACTION_META = {
  PROJECT_CREATED:"Project created", PROJECT_UPDATED:"Project updated",
  PROJECT_DELETED:"Project deleted", PROJECT_ARCHIVED:"Project archived",
  PROJECT_DEADLINE_CHANGED:"Deadline changed", PROJECT_STATUS_CHANGED:"Status changed",
  PROJECT_OWNER_CHANGED:"Owner changed",
  TASK_CREATED:"Task created", TASK_UPDATED:"Task updated", TASK_DELETED:"Task deleted",
  TASK_COMPLETED:"Task completed ✅", TASK_STATUS_CHANGED:"Status changed",
  TASK_PRIORITY_CHANGED:"Priority changed", TASK_ASSIGNED:"Assigned",
  TASK_UNASSIGNED:"Unassigned", TASK_BLOCKED:"Blocked 🔒", TASK_UNBLOCKED:"Unblocked",
  GOAL_CREATED:"Goal created", GOAL_UPDATED:"Goal updated", GOAL_DELETED:"Goal deleted",
  GOAL_COMPLETED:"Goal completed 🎉", GOAL_PROGRESS_CHANGED:"Progress updated",
  SUBGOAL_CREATED:"Sub-goal added", STEP_COMPLETED:"Step completed ✓",
  TIME_LOGGED:"Time logged", TIME_APPROVED:"Time approved",
  LOGIN_SUCCESS:"Logged in", LOGIN_FAILED:"Login failed",
  USER_INVITED:"User invited", USER_REMOVED:"User removed",
  ROLE_CHANGED:"Role changed", WORKSPACE_JOINED:"Joined workspace",
  CREATED:"Created", UPDATED:"Updated", DELETED:"Deleted",
  STATUS_CHANGED:"Status changed", PROGRESS_UPDATED:"Progress updated",
};

function badgeCls(action) {
  if (!action) return "updated";
  if (action.includes("CREATED")  || action === "WORKSPACE_JOINED") return "created";
  if (action.includes("DELETED")  || action.includes("BLOCKED") || action === "WORKSPACE_LEFT") return "deleted";
  if (action.includes("COMPLETED")) return "completed";
  if (action.includes("STATUS")   || action.includes("PRIORITY")) return "status";
  if (action.includes("PROGRESS") || action.includes("STEP"))     return "progress";
  if (action.includes("DEADLINE") || action.includes("OWNER")     || action.includes("ROLE")) return "warning";
  return "updated";
}

function EATRow({ log }) {
  const user    = log.performedBy && log.performedBy !== "System"
    ? (log.performedBy.includes("@") ? log.performedBy.split("@")[0] : log.performedBy) : "System";
  const relTime = timeAgo(log.createdAt);
  const absTime = log.createdAt
    ? new Date(log.createdAt).toLocaleString("en-US", {
        month:"short", day:"numeric", hour:"2-digit", minute:"2-digit"
      }) : "";
  const label = ACTION_META[log.action] || log.action?.replace(/_/g," ") || "Updated";
  const cls   = badgeCls(log.action);

  return (
    <div className="eat-row">
      <div className="eat-line-col">
        <div className={`eat-dot eat-dot-${cls}`} />
        <div className="eat-line" />
      </div>
      <div className="eat-body">
        <div className="eat-main">
          <span className="eat-label">{label}</span>
          {/* Show human-readable sentence */}
          {log.humanReadable && (
            <span className="eat-human">{log.humanReadable}</span>
          )}
          {/* Always show diff when available */}
          {log.oldValue && log.newValue && (
            <span className="eat-diff">
              <span className="eat-old">{log.oldValue}</span>
              <span className="eat-arrow">→</span>
              <span className="eat-new">{log.newValue}</span>
            </span>
          )}
        </div>
        <div className="eat-meta">
          <span className="eat-user">{user}</span>
          <span className="eat-time" title={absTime}>{relTime}</span>
          {log.severity && log.severity !== "INFO" && (
            <span className={`eat-severity eat-sev-${log.severity.toLowerCase()}`}>
              {log.severity}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function EntityActivityTab({ entityType, entityId }) {
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entityId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount: loading flag set before the fetch, data set after
    setLoading(true);
    const fetcher =
      entityType === "project" ? getActivityForProject :
      entityType === "task"    ? getActivityForTask    :
                                 getActivityForGoal;
    fetcher(entityId, 50)
      .then(res => setLogs(Array.isArray(res.data) ? res.data : (res.data?.data || [])))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [entityType, entityId]);

  if (loading) return <p className="empty-state" style={{ padding:"24px 0" }}>Loading history…</p>;
  if (logs.length === 0) return (
    <div className="eat-empty">
      <div style={{ fontSize:"28px", marginBottom:"6px" }}>📋</div>
      <p>No activity yet</p>
    </div>
  );

  return (
    <div className="eat-list">
      {logs.map(log => <EATRow key={log.id} log={log} />)}
    </div>
  );
}
