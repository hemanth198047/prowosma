import { useState, useRef, useEffect } from "react";
import { useToast } from "./ToastContext";
import { AlertTriangle } from "lucide-react";
import { isTaskOverdue, OVERDUE_COLOR } from "../utils/overdue";

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
// Workflow/urgency order, not alphabetical — alphabetically DONE comes
// before IN_PROGRESS comes before TODO, which is backwards from how
// anyone actually thinks about task progress or priority.
const STATUS_ORDER   = { TODO: 0, IN_PROGRESS: 1, DONE: 2 };
const PRIORITY_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export default function TaskTable({
  tasks, projects, teamMembers, selectedIds, toggleSelect, onSelectAll,
  onUpdate, onDelete, onOpenDrawer, highlightId,
}) {
  const allSelected = tasks.length > 0 && tasks.every((t) => selectedIds.has(t.id));

  // null = unsorted (server/original order). Clicking a header cycles
  // asc -> desc -> unsorted for that column; clicking a different header
  // starts that one fresh at asc.
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  const onSortClick = (key) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); return; }
    if (sortDir === "asc") { setSortDir("desc"); return; }
    setSortKey(null); setSortDir("asc");
  };

  const projectName = (id) => projects.find(p => p.id === id)?.name || "";
  const assigneeLabel = (t) => {
    const names = (t.assigneeIds || []).map(id => teamMembers.find(m => m.id === id)?.name).filter(Boolean);
    return names.sort().join(", ");
  };

  const sortedTasks = !sortKey ? tasks : [...tasks].sort((a, b) => {
    let av, bv;
    switch (sortKey) {
      case "title":    av = a.title?.toLowerCase() || "";        bv = b.title?.toLowerCase() || "";        break;
      case "status":   av = STATUS_ORDER[a.status] ?? 99;        bv = STATUS_ORDER[b.status] ?? 99;        break;
      case "priority": av = PRIORITY_ORDER[a.priority] ?? 99;    bv = PRIORITY_ORDER[b.priority] ?? 99;    break;
      case "project":  av = projectName(a.projectId).toLowerCase(); bv = projectName(b.projectId).toLowerCase(); break;
      case "assignee": av = assigneeLabel(a).toLowerCase();      bv = assigneeLabel(b).toLowerCase();      break;
      case "dueDate":
        // No due date sorts to the end regardless of direction — an
        // undated task isn't "earliest", it's just not scheduled, and
        // burying it at the top of an ascending sort would be misleading.
        av = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        bv = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        break;
      default: av = 0; bv = 0;
    }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--card-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)", boxShadow: "var(--elevation-1)" }}>
      {/* Fixed layout so each column keeps its set width and "IN PROGRESS" /
          "MEDIUM" are never cut off (the browser used to squeeze them). The
          Title column takes the remaining space; below minWidth the table
          scrolls inside this frame instead of truncating values. */}
      <table style={{ width: "100%", minWidth: 1100, tableLayout: "fixed", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--gray-50)", borderBottom: "2px solid var(--border)" }}>
            <Th style={{ width: 36 }}>
              <input type="checkbox" aria-label="Select all tasks" checked={allSelected} onChange={(e) => onSelectAll(e.target.checked)} />
            </Th>
            <Th style={{}} sortKey="title"    activeSort={sortKey} sortDir={sortDir} onSort={onSortClick}>Title</Th>
            <Th style={{ width: 150 }}    sortKey="status"   activeSort={sortKey} sortDir={sortDir} onSort={onSortClick}>Status</Th>
            <Th style={{ width: 112 }}    sortKey="priority" activeSort={sortKey} sortDir={sortDir} onSort={onSortClick}>Priority</Th>
            <Th style={{ width: 176 }}    sortKey="project"  activeSort={sortKey} sortDir={sortDir} onSort={onSortClick}>Project</Th>
            <Th style={{ width: 110 }}    sortKey="assignee" activeSort={sortKey} sortDir={sortDir} onSort={onSortClick}>Assignees</Th>
            <Th style={{ width: 136 }}    sortKey="dueDate"  activeSort={sortKey} sortDir={sortDir} onSort={onSortClick}>Due Date</Th>
            <Th style={{ width: 140 }}>Tags</Th>
            <Th style={{ width: 52 }}></Th>
          </tr>
        </thead>
        <tbody>
          {sortedTasks.map((t) => (
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

// sortKey/activeSort/sortDir/onSort are optional — a header with no
// sortKey (Tags, the checkbox/action columns) just renders as a plain,
// unclickable label, since sorting by a free-text tag list or a column
// of action buttons isn't a meaningful operation.
function Th({ children, style, sortKey, activeSort, sortDir, onSort }) {
  const sortable = !!sortKey;
  const isActive = sortable && activeSort === sortKey;
  return (
    <th
      onClick={sortable ? () => onSort(sortKey) : undefined}
      style={{
        textAlign: "left", padding: "10px 10px", fontSize: 11, fontWeight: 700,
        color: isActive ? "var(--brand-600)" : "var(--gray-400)",
        textTransform: "uppercase", letterSpacing: 0.4,
        cursor: sortable ? "pointer" : "default",
        userSelect: "none",
        ...style,
      }}
    >
      {children}
      {sortable && (
        <span style={{ marginLeft: 4, opacity: isActive ? 1 : 0.3, fontSize: 10 }}>
          {isActive ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      )}
    </th>
  );
}

function TaskTableRow({ task, projects, teamMembers, selected, highlighted, onToggleSelect, onUpdate, onDelete, onOpenDrawer }) {
  const { show: showToast } = useToast();
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
        <input type="checkbox" aria-label={`Select ${task.title}`} checked={selected} onChange={onToggleSelect} />
      </td>

      {/* Title — click to edit inline, click the expand icon to open the drawer */}
      <td style={cellStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {editingTitle ? (
            <input
             
              aria-label="Task title"
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
          aria-label={`Status of ${task.title}`}
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
          aria-label={`Priority of ${task.title}`}
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
          aria-label={`Project of ${task.title}`}
          value={task.projectId || ""}
          title={projects.find((p) => p.id === task.projectId)?.name || undefined}
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

      {/* Due date — overdue open tasks get the Dashboard's red date and warning icon */}
      <td style={cellStyle}>
        <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
        {isTaskOverdue(task) && <AlertTriangle size={11} color={OVERDUE_COLOR} aria-hidden="true" style={{ flexShrink: 0 }} />}
        <input
          type="date"
          value={task.dueDate ? task.dueDate.slice(0, 10) : ""}
          // "YYYY-MM-DDT00:00:00" with no timezone suffix is parsed as
          // LOCAL midnight, per the JS spec — .toISOString() then
          // converts that back to UTC, which shifts the calendar date
          // backward a day in any timezone ahead of UTC (e.g. picking
          // the 28th in IST becomes 2026-09-27T18:30:00.000Z, whose date
          // portion reads back as the 27th everywhere the date is later
          // displayed). A due date is a calendar day, not a specific
          // moment in time, so it's pinned to UTC midnight explicitly
          // (the "Z" suffix) instead — the selected day is then the
          // selected day, in every timezone, full stop.
          onChange={(e) => {
            const val = e.target.value;
            // The browser's own date picker respects min= below, but
            // manually typing a date into the field bypasses that in
            // some browsers — checked here too so it can't slip through
            // either way, with an actual explanation instead of the
            // change just silently not happening.
            if (val) {
              const todayStr = new Date().toISOString().slice(0, 10);
              if (val < todayStr) {
                showToast("Due date can't be in the past", "error");
                return;
              }
            }
            save({ dueDate: val ? new Date(val + "T00:00:00.000Z").toISOString() : null });
          }}
          // Due dates are for work still ahead — a date input with no
          // floor let any past date through with nothing stopping it.
          min={new Date().toISOString().slice(0, 10)}
          aria-label={isTaskOverdue(task) ? "Due date (overdue)" : "Due date"}
          style={{ ...inputStyle, cursor: "pointer", ...(isTaskOverdue(task) ? { color: OVERDUE_COLOR, fontWeight: 600 } : {}) }}
        />
        </span>
      </td>

      {/* Tags */}
      <td style={cellStyle}>
        {editingTags ? (
          <input
           
            aria-label="Tags, separated by commas"
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
