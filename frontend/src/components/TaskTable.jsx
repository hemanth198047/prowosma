import { useState, useRef, useEffect } from "react";

const STATUSES = ["TODO", "IN_PROGRESS", "DONE"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
// Same fixed status/priority palette as everywhere else in the app
// (base.css --viz-*) rather than its own local hex — so "In Progress" is
// the same color here as on the Dashboard, a Kanban card, etc.
const statusColor = { TODO: "var(--viz-todo)", IN_PROGRESS: "var(--viz-progress)", DONE: "var(--viz-done)" };
const priorityColor = { LOW: "var(--viz-done)", MEDIUM: "var(--viz-progress)", HIGH: "var(--viz-overdue)" };

/**
 * TaskTable — a real spreadsheet-style, inline-editable grid view.
 *
 * Every cell is a live editing control, not a static label: changing a
 * dropdown or blurring a text field saves immediately via onUpdate
 * (PATCH), the same way the existing card/list views already save
 * status changes — this just extends that pattern to every column at
 * once instead of one field at a time behind an edit-icon.
 *
 * Props:
 *   tasks        — filtered task list to display, in order
 *   projects, teamMembers — lookup lists for the dropdown cells
 *   selectedIds, toggleSelect, onSelectAll — bulk-select wiring, shared
 *     with the other view modes so bulk actions keep working
 *   onUpdate     — (taskId, partialFields) => Promise — PATCH one field
 *   onDelete     — (taskId) => Promise
 *   onOpenDrawer — (task) => void — opens the quick-view drawer
 *   highlightId  — task id to visually highlight (e.g. from a notification link)
 */
export default function TaskTable({
  tasks, projects, teamMembers, selectedIds, toggleSelect, onSelectAll,
  onUpdate, onDelete, onOpenDrawer, highlightId,
}) {
  const allSelected = tasks.length > 0 && tasks.every((t) => selectedIds.has(t.id));

  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--card-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)", boxShadow: "var(--elevation-1)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--gray-50)", borderBottom: "2px solid var(--border)" }}>
            <Th style={{ width: 32 }}>
              <input type="checkbox" checked={allSelected} onChange={(e) => onSelectAll(e.target.checked)} />
            </Th>
            <Th style={{ minWidth: 220 }}>Title</Th>
            <Th style={{ width: 130 }}>Status</Th>
            <Th style={{ width: 100 }}>Priority</Th>
            <Th style={{ width: 160 }}>Project</Th>
            <Th style={{ width: 150 }}>Assignees</Th>
            <Th style={{ width: 140 }}>Due Date</Th>
            <Th style={{ width: 180 }}>Tags</Th>
            <Th style={{ width: 70 }}></Th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <TaskTableRow
              key={t.id}
              task={t}
              projects={projects}
              teamMembers={teamMembers}
              selected={selectedIds.has(t.id)}
              highlighted={highlightId === t.id}
              onToggleSelect={() => toggleSelect(t.id)}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onOpenDrawer={onOpenDrawer}
            />
          ))}
          {tasks.length === 0 && (
            <tr><td colSpan={9} style={{ textAlign: "center", padding: 32, color: "var(--gray-400)" }}>No tasks found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, style }) {
  return (
    <th style={{ textAlign: "left", padding: "10px 10px", fontSize: 11, fontWeight: 700, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: 0.4, ...style }}>
      {children}
    </th>
  );
}

function TaskTableRow({ task, projects, teamMembers, selected, highlighted, onToggleSelect, onUpdate, onDelete, onOpenDrawer }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [editingTags, setEditingTags] = useState(false);
  const [tagsDraft, setTagsDraft] = useState((task.tags || []).join(", "));
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false);
  const [busyField, setBusyField] = useState(null);
  const assigneeRef = useRef(null);

  useEffect(() => {
    if (!assigneeMenuOpen) return;
    const handler = (e) => { if (assigneeRef.current && !assigneeRef.current.contains(e.target)) setAssigneeMenuOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [assigneeMenuOpen]);

  const save = async (fields) => {
    const key = Object.keys(fields)[0];
    setBusyField(key);
    try { await onUpdate(task.id, fields); } finally { setBusyField(null); }
  };

  const assignees = (task.assigneeIds || []).map((id) => teamMembers.find((m) => m.id === id)).filter(Boolean);

  const toggleAssignee = (memberId) => {
    const current = task.assigneeIds || [];
    const next = current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId];
    save({ assigneeIds: next });
  };

  const cellStyle = { padding: "6px 10px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" };
  const inputStyle = { width: "100%", padding: "5px 7px", border: "1px solid transparent", borderRadius: 6, fontSize: 13, fontFamily: "inherit", background: "transparent", boxSizing: "border-box" };

  return (
    <tr style={{ background: highlighted ? "color-mix(in srgb, var(--warning) 12%, transparent)" : selected ? "var(--brand-50)" : "transparent" }}>
      <td style={cellStyle}>
        <input type="checkbox" checked={selected} onChange={onToggleSelect} />
      </td>

      {/* Title — click to edit inline, click the expand icon to open the drawer */}
      <td style={cellStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {editingTitle ? (
            <input
             
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => { setEditingTitle(false); if (titleDraft.trim() && titleDraft !== task.title) save({ title: titleDraft.trim() }); }}
              onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { setTitleDraft(task.title); setEditingTitle(false); } }}
              style={{ ...inputStyle, border: "1px solid var(--accent-500)" }}
            />
          ) : (
            <span onClick={() => setEditingTitle(true)} title="Click to rename" style={{ cursor: "text", flex: 1, fontWeight: 500 }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setEditingTitle(true))?.(e); } }}>
              {task.title}
            </span>
          )}
          <button className="btn-icon" title="Open details" style={{ fontSize: 13, flexShrink: 0 }} onClick={() => onOpenDrawer(task)}>⤢</button>
        </div>
      </td>

      {/* Status */}
      <td style={cellStyle}>
        <select
          value={task.status}
          onChange={(e) => save({ status: e.target.value })}
          disabled={busyField === "status"}
          style={{ ...inputStyle, color: statusColor[task.status], fontWeight: 600, cursor: "pointer" }}
        >
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </td>

      {/* Priority */}
      <td style={cellStyle}>
        <select
          value={task.priority}
          onChange={(e) => save({ priority: e.target.value })}
          disabled={busyField === "priority"}
          style={{ ...inputStyle, color: priorityColor[task.priority], fontWeight: 600, cursor: "pointer" }}
        >
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </td>

      {/* Project */}
      <td style={cellStyle}>
        <select
          value={task.projectId || ""}
          onChange={(e) => save({ projectId: e.target.value || null })}
          disabled={busyField === "projectId"}
          style={{ ...inputStyle, cursor: "pointer" }}
        >
          <option value="">—</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </td>

      {/* Assignees */}
      <td style={{ ...cellStyle, position: "relative" }} ref={assigneeRef}>
        <div onClick={() => setAssigneeMenuOpen((o) => !o)} style={{ display: "flex", gap: 3, alignItems: "center", cursor: "pointer", minHeight: 22 }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setAssigneeMenuOpen((o) => !o))?.(e); } }}>
          {assignees.length === 0 && <span style={{ color: "var(--gray-400)" }}>+ Add</span>}
          {assignees.map((m) => (
            <span key={m.id} title={m.name} style={{
              width: 20, height: 20, borderRadius: "50%", background: m.color || "var(--brand-500)", color: "#fff",
              fontSize: 9, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>
              {m.name.slice(0, 2).toUpperCase()}
            </span>
          ))}
        </div>
        {assigneeMenuOpen && (
          <div style={{
            position: "absolute", top: "100%", left: 6, marginTop: 2, background: "var(--surface-1)", minWidth: 180,
            border: "1px solid var(--card-border)", borderRadius: "var(--radius-md)", boxShadow: "var(--elevation-2)",
            zIndex: 20, maxHeight: 200, overflowY: "auto",
          }}>
            {teamMembers.map((m) => (
              <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}>
                <input type="checkbox" checked={(task.assigneeIds || []).includes(m.id)} onChange={() => toggleAssignee(m.id)} />
                {m.name}
              </label>
            ))}
            {teamMembers.length === 0 && <div style={{ padding: 10, fontSize: 11, color: "var(--gray-400)" }}>No members</div>}
          </div>
        )}
      </td>

      {/* Due date */}
      <td style={cellStyle}>
        <input
          type="date"
          value={task.dueDate ? task.dueDate.slice(0, 10) : ""}
          onChange={(e) => save({ dueDate: e.target.value ? new Date(e.target.value + "T00:00:00").toISOString() : null })}
          style={{ ...inputStyle, cursor: "pointer" }}
        />
      </td>

      {/* Tags */}
      <td style={cellStyle}>
        {editingTags ? (
          <input
           
            value={tagsDraft}
            onChange={(e) => setTagsDraft(e.target.value)}
            onBlur={() => { setEditingTags(false); save({ tags: tagsDraft.split(",").map((x) => x.trim()).filter(Boolean) }); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
            placeholder="tag1, tag2"
            style={{ ...inputStyle, border: "1px solid var(--accent-500)" }}
          />
        ) : (
          <div onClick={() => setEditingTags(true)} style={{ cursor: "text", display: "flex", gap: 4, flexWrap: "wrap", minHeight: 20 }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setEditingTags(true))?.(e); } }}>
            {(task.tags || []).length === 0 && <span style={{ color: "var(--gray-400)" }}>+ Add</span>}
            {(task.tags || []).map((tag) => (
              <span key={tag} className="task-tag" style={{ fontSize: 10 }}>{tag}</span>
            ))}
          </div>
        )}
      </td>

      {/* Actions */}
      <td style={{ ...cellStyle, textAlign: "right" }}>
        <button className="btn-icon" title="Delete" onClick={() => onDelete(task.id)}>🗑️</button>
      </td>
    </tr>
  );
}
