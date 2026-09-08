import { useState, useEffect, useRef } from "react";
import DateTimePicker from "./DateTimePicker";
import CustomFieldValues from "./CustomFieldValues";
import TaskComments from "./TaskComments";
import TimeTracker from "./TimeTracker";
import FileAttachments from "./FileAttachments";
import TaskDependencies from "./TaskDependencies";
import EntityActivityTab from "./EntityActivityTab";
import { useConfirm } from "../hooks/useConfirm";

const STATUSES = ["TODO", "IN_PROGRESS", "DONE"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
const TYPES = ["TASK", "BUG", "STORY", "FEATURE", "IMPROVEMENT", "EPIC"];
const SEVERITIES = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

const statusColor = { TODO: "#6366f1", IN_PROGRESS: "#f59e0b", DONE: "#10b981" };
const priorityColor = { LOW: "#10b981", MEDIUM: "#f59e0b", HIGH: "#ef4444" };

/**
 * TaskDrawer — a real slide-over quick-view panel.
 *
 * Opens over whatever page is currently showing (table, card list,
 * kanban, etc.) without navigating away or losing scroll position —
 * the actual gap this closes. Every field here is genuinely
 * inline-editable and saves immediately via the same PATCH endpoint
 * the rest of the app uses (onUpdate), not a read-only preview.
 *
 * Props:
 *   task        — the task to show, or null/undefined to render nothing
 *   projects    — full project list (for the project picker)
 *   teamMembers — full member list (for the assignee picker)
 *   allTasks    — full task list (passed through to TaskDependencies)
 *   onClose     — called to dismiss the drawer
 *   onUpdate    — (taskId, partialFields) => Promise — PATCH and refresh
 *   onDelete    — (taskId) => Promise — delete and close
 */
export default function TaskDrawer({ task, projects, teamMembers, allTasks, onClose, onUpdate, onDelete, onRefresh }) {
  const confirm = useConfirm();
  const [local, setLocal] = useState(task ?? null);
  const [syncedId, setSyncedId] = useState(task?.id ?? null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task?.title || "");
  const [descDraft, setDescDraft] = useState(task?.description || "");
  const [savingField, setSavingField] = useState(null);
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false);
  const assigneeRef = useRef(null);

  // Keep `local` (used for optimistic inline-edit updates so the UI feels
  // instant) in sync with the `task` prop the moment it changes.
  //
  // This used to be a useEffect keyed on task?.id, but effects run AFTER
  // render — so the very first render where `task` flips from null to a
  // real task still had `local` at its stale initial value (null, from
  // when this component first mounted with no task selected). The JSX
  // below reads local.title, local.status, etc., so that render threw and
  // the drawer opened empty. Doing the sync here, during render, is React's
  // documented pattern for exactly this ("adjusting state when a prop
  // changes") and guarantees local is correct before anything reads it.
  if ((task?.id ?? null) !== syncedId) {
    setSyncedId(task?.id ?? null);
    setLocal(task ?? null);
    setTitleDraft(task?.title || "");
    setDescDraft(task?.description || "");
    setEditingTitle(false);
  }

  useEffect(() => {
    if (!assigneeMenuOpen) return;
    const handler = (e) => {
      if (assigneeRef.current && !assigneeRef.current.contains(e.target)) setAssigneeMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [assigneeMenuOpen]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && task) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [task, onClose]);

  if (!task || !local) return null;

  const save = async (fields) => {
    const key = Object.keys(fields)[0];
    setSavingField(key);
    setLocal((prev) => ({ ...prev, ...fields }));
    try {
      await onUpdate(task.id, fields);
    } finally {
      setSavingField(null);
    }
  };

  const project = projects.find((p) => p.id === local.projectId);
  const assignees = (local.assigneeIds || []).map((id) => teamMembers.find((m) => m.id === id)).filter(Boolean);

  const toggleAssignee = (memberId) => {
    const current = local.assigneeIds || [];
    const next = current.includes(memberId)
      ? current.filter((id) => id !== memberId)
      : [...current, memberId];
    save({ assigneeIds: next });
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.35)", zIndex: 1200 }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }}
      />
      <div
        role="dialog"
        aria-label="Task details"
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "min(520px, 100vw)",
          background: "var(--card-bg, #fff)", boxShadow: "-8px 0 32px rgba(0,0,0,0.18)",
          zIndex: 1201, display: "flex", flexDirection: "column",
          animation: "taskDrawerSlideIn 0.2s ease-out",
        }}
      >
        <style>{`
          @keyframes taskDrawerSlideIn { from { transform: translateX(24px); opacity: 0.6; } to { transform: translateX(0); opacity: 1; } }
        `}</style>

        {/* ── Header ── */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editingTitle ? (
              <input
               
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => { setEditingTitle(false); if (titleDraft.trim() && titleDraft !== local.title) save({ title: titleDraft.trim() }); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { setTitleDraft(local.title); setEditingTitle(false); } }}
                style={{ width: "100%", fontSize: 18, fontWeight: 700, padding: "4px 6px", border: "1px solid var(--accent-500)", borderRadius: 6 }}
              />
            ) : (
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, wordBreak: "break-word" }}>
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  title="Click to edit"
                  style={{ font: "inherit", color: "inherit", background: "none", border: "none", padding: 0, margin: 0, cursor: "text", textAlign: "left", width: "100%" }}
                >
                  {local.title}
                </button>
              </h2>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <TaskComments task={local} onRefresh={onRefresh} />
              <TimeTracker task={local} onRefresh={onRefresh} />
              <FileAttachments task={local} onRefresh={onRefresh} />
              <TaskDependencies task={local} allTasks={allTasks} onRefresh={onRefresh} />
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} title="Close" style={{ fontSize: 18 }}>✕</button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>

          {/* Status + Priority */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={fieldLabelStyle} htmlFor={"task-drawer-status"}>Status</label>
              <select
                value={local.status}
                onChange={(e) => save({ status: e.target.value })}
                style={{ ...selectStyle, color: statusColor[local.status], fontWeight: 600 }} id={"task-drawer-status"}
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={fieldLabelStyle} htmlFor={"task-drawer-priority"}>Priority</label>
              <select
                value={local.priority}
                onChange={(e) => save({ priority: e.target.value })}
                style={{ ...selectStyle, color: priorityColor[local.priority], fontWeight: 600 }} id={"task-drawer-priority"}
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          {/* Description */}
          <div style={{ marginBottom: 16 }}>
            <label style={fieldLabelStyle} htmlFor={"task-drawer-description"}>Description</label>
            <textarea
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={() => { if (descDraft !== (local.description || "")) save({ description: descDraft }); }}
              rows={4}
              placeholder="Add a description…"
              style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "inherit", fontSize: 13, resize: "vertical", boxSizing: "border-box" }} id={"task-drawer-description"}
            />
          </div>

          {/* Project */}
          <div style={{ marginBottom: 16 }}>
            <label style={fieldLabelStyle} htmlFor={"task-drawer-project"}>Project</label>
            <select value={local.projectId || ""} onChange={(e) => save({ projectId: e.target.value || null })} style={selectStyle} id={"task-drawer-project"}>
              <option value="">— No Project —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* Assignees */}
          <div style={{ marginBottom: 16, position: "relative" }} ref={assigneeRef}>
            <span id="task-drawer-assignees-label" style={fieldLabelStyle}>Assignees</span>
            <div
              onClick={() => setAssigneeMenuOpen((o) => !o)}
              aria-labelledby="task-drawer-assignees-label"
              style={{ ...selectStyle, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minHeight: 20 }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setAssigneeMenuOpen((o) => !o))?.(e); } }}
            >
              {assignees.length === 0 && <span style={{ color: "var(--gray-400)" }}>Unassigned — click to add</span>}
              {assignees.map((m) => (
                <span key={m.id} style={{
                  background: m.color || "#6366f1", color: "#fff", borderRadius: 12, padding: "2px 8px",
                  fontSize: 11, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4,
                }}>
                  {m.name}
                </span>
              ))}
            </div>
            {assigneeMenuOpen && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "#fff",
                border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                zIndex: 10, maxHeight: 220, overflowY: "auto",
              }}>
                {teamMembers.map((m) => (
                  <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", fontSize: 13 }}>
                    <input type="checkbox" checked={(local.assigneeIds || []).includes(m.id)} onChange={() => toggleAssignee(m.id)} />
                    <span style={{ width: 18, height: 18, borderRadius: "50%", background: m.color || "#6366f1", color: "#fff", fontSize: 9, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      {m.name.slice(0, 2).toUpperCase()}
                    </span>
                    {m.name}
                  </label>
                ))}
                {teamMembers.length === 0 && <div style={{ padding: 12, fontSize: 12, color: "var(--gray-400)" }}>No team members yet</div>}
              </div>
            )}
          </div>

          {/* Due date */}
          <div style={{ marginBottom: 16 }}>
            <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
              <legend style={{ ...fieldLabelStyle, padding: 0 }}>Due Date</legend>
              <DateTimePicker value={local.dueDate || ""} onChange={(iso) => save({ dueDate: iso || null })} />
            </fieldset>
          </div>

          {/* Tags */}
          <div style={{ marginBottom: 16 }}>
            <label style={fieldLabelStyle} htmlFor={"task-drawer-tags"}>Tags</label>
            <input
              defaultValue={(local.tags || []).join(", ")}
              placeholder="e.g. urgent, frontend, bug"
              onBlur={(e) => {
                const next = e.target.value.split(",").map((t) => t.trim()).filter(Boolean);
                save({ tags: next });
              }}
              style={{ ...selectStyle, cursor: "text" }} id={"task-drawer-tags"}
            />
          </div>

          {/* Type / Severity / SLA */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={fieldLabelStyle} htmlFor={"task-drawer-type"}>Type</label>
              <select value={local.type || "TASK"} onChange={(e) => save({ type: e.target.value })} style={selectStyle} id={"task-drawer-type"}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={fieldLabelStyle} htmlFor={"task-drawer-severity"}>Severity</label>
              <select value={local.severity || "NONE"} onChange={(e) => save({ severity: e.target.value })} style={selectStyle} id={"task-drawer-severity"}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={fieldLabelStyle} htmlFor={"task-drawer-sla-hrs"}>SLA (hrs)</label>
              <input
                type="number" min={1} defaultValue={local.slaHours || ""}
                onBlur={(e) => save({ slaHours: e.target.value ? Number(e.target.value) : null })}
                style={selectStyle} id={"task-drawer-sla-hrs"}
              />
            </div>
          </div>

          {/* Custom fields */}
          <div style={{ marginBottom: 16 }}>
            <CustomFieldValues
              entityType="TASK"
              values={local.customFieldValues || {}}
              onChange={(vals) => save({ customFieldValues: vals })}
            />
          </div>

          {/* Activity */}
          <div style={{ marginTop: 24, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <span style={fieldLabelStyle}>Activity</span>
            <EntityActivityTab entityType="task" entityId={task.id} />
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--gray-400)" }}>
            {savingField ? "Saving…" : project ? `In ${project.name}` : "\u00A0"}
          </span>
          <button
            className="btn-icon"
            style={{ color: "var(--danger)", fontSize: 13 }}
            onClick={async () => {
              const ok = await confirm({ title: "Delete this task?", message: "Permanently delete this task.", danger: true, confirmText: "Delete Task" });
              if (ok) { await onDelete(task.id); onClose(); }
            }}
          >
            🗑️ Delete Task
          </button>
        </div>
      </div>
    </>
  );
}

const fieldLabelStyle = { display: "block", fontSize: 11, fontWeight: 600, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 };
const selectStyle = { width: "100%", padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, boxSizing: "border-box", background: "#fff" };
