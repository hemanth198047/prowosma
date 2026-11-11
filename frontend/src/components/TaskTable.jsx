import { useState, useRef, useEffect } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, PanelRightOpen, Trash2 } from "lucide-react";
import { useToast } from "./ToastContext";
import { StatusGlyph } from "../ui/Status";
import { statusMeta, priorityMeta } from "../ui/meta";
import Avatar from "../ui/Avatar";
import "../styles/task-table.css";

const STATUSES = ["TODO", "IN_PROGRESS", "DONE"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
// Status and priority are shown as the shared glyphs (ui/Status, ui/Priority)
// plus a plain-language label, so state never depends on colour alone. The
// stored values (TODO / IN_PROGRESS / DONE, LOW / MEDIUM / HIGH) are unchanged.

const todayISO = () => new Date().toISOString().slice(0, 10);
const isOverdue = (t) => !!t.dueDate && t.status !== "DONE" && t.dueDate.slice(0, 10) < todayISO();

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
    <div className="tt-wrap">
      <table className="tt">
        <colgroup>
          <col style={{ width: 40 }} />
          <col />
          <col style={{ width: 140 }} />
          <col style={{ width: 112 }} />
          <col style={{ width: 168 }} />
          <col style={{ width: 104 }} />
          <col style={{ width: 150 }} />
          <col style={{ width: 132 }} />
          <col style={{ width: 44 }} />
        </colgroup>
        <thead>
          <tr>
            <Th>
              <input type="checkbox" aria-label="Select all tasks" checked={allSelected} onChange={(e) => onSelectAll(e.target.checked)} />
            </Th>
            <Th sortKey="title"    activeSort={sortKey} sortDir={sortDir} onSort={onSortClick}>Task</Th>
            <Th sortKey="status"   activeSort={sortKey} sortDir={sortDir} onSort={onSortClick}>Status</Th>
            <Th sortKey="priority" activeSort={sortKey} sortDir={sortDir} onSort={onSortClick}>Priority</Th>
            <Th sortKey="project"  activeSort={sortKey} sortDir={sortDir} onSort={onSortClick}>Project</Th>
            <Th sortKey="assignee" activeSort={sortKey} sortDir={sortDir} onSort={onSortClick}>Assignees</Th>
            <Th sortKey="dueDate"  activeSort={sortKey} sortDir={sortDir} onSort={onSortClick}>Due</Th>
            <Th>Tags</Th>
            <Th><span className="ui-sr-only">Actions</span></Th>
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
            <tr><td colSpan={9} className="tt-empty">No tasks match these filters.</td></tr>
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
function Th({ children, sortKey, activeSort, sortDir, onSort }) {
  const sortable = !!sortKey;
  const isActive = sortable && activeSort === sortKey;
  const ariaSort = isActive ? (sortDir === "asc" ? "ascending" : "descending") : sortable ? "none" : undefined;
  if (!sortable) return <th scope="col">{children}</th>;
  const Icon = isActive ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th scope="col" aria-sort={ariaSort}>
      <button type="button" className={"tt-sort" + (isActive ? " is-active" : "")} onClick={() => onSort(sortKey)}>
        {children}
        <Icon size={12} aria-hidden="true" />
      </button>
    </th>
  );
}

function projectNameOf(projects, id) {
  return projects.find((p) => p.id === id)?.name || "No project";
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

  const overdue = isOverdue(task);
  const rowClass = "tt-row" + (highlighted ? " is-highlighted" : selected ? " is-selected" : "");

  return (
    <tr className={rowClass}>
      <td>
        <input type="checkbox" aria-label={`Select ${task.title}`} checked={selected} onChange={onToggleSelect} />
      </td>

      {/* Title — click to rename inline; the panel icon opens the details drawer */}
      <td>
        <div className="tt-title">
          {editingTitle ? (
            <input
              className="tt-input"
              aria-label="Task title"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => { setEditingTitle(false); if (titleDraft.trim() && titleDraft !== task.title) save({ title: titleDraft.trim() }); }}
              onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { setTitleDraft(task.title); setEditingTitle(false); } }}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the user just asked to edit this field
              autoFocus
            />
          ) : (
            <span className="tt-title-text" onClick={() => setEditingTitle(true)} title="Click to rename" role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setEditingTitle(true); } }}>
              {task.title}
            </span>
          )}
          <button className="tt-icon-btn tt-open" title="Open details" aria-label={`Open details for ${task.title}`} onClick={() => onOpenDrawer(task)}>
            <PanelRightOpen size={15} aria-hidden="true" />
          </button>
        </div>
      </td>

      {/* Status — glyph + label over a native select, so keyboard and screen readers get the real control */}
      <td>
        <span className={`tt-pick tt-pick--status ui-tone--${statusMeta(task.status).tone}`}>
          <StatusGlyph status={task.status} />
          <select
            aria-label="Status"
            value={task.status}
            onChange={(e) => save({ status: e.target.value })}
            disabled={busyField === "status"}
          >
            {STATUSES.map((s) => <option key={s} value={s}>{statusMeta(s).label}</option>)}
          </select>
          <ChevronDown size={13} className="tt-pick-caret" aria-hidden="true" />
        </span>
      </td>

      {/* Priority */}
      <td>
        <span className={`tt-pick ui-priority ui-priority--${priorityMeta(task.priority).tone}`}>
          <span className="ui-priority-mark" aria-hidden="true" />
          <select
            aria-label="Priority"
            value={task.priority}
            onChange={(e) => save({ priority: e.target.value })}
            disabled={busyField === "priority"}
          >
            {PRIORITIES.map((p) => <option key={p} value={p}>{priorityMeta(p).label}</option>)}
          </select>
          <ChevronDown size={13} className="tt-pick-caret" aria-hidden="true" />
        </span>
      </td>

      {/* Project */}
      <td>
        <span className="tt-pick tt-pick--plain" title={projectNameOf(projects, task.projectId)}>
          <select
            aria-label="Project"
            value={task.projectId || ""}
            onChange={(e) => save({ projectId: e.target.value || null })}
            disabled={busyField === "projectId"}
          >
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <ChevronDown size={13} className="tt-pick-caret" aria-hidden="true" />
        </span>
      </td>

      {/* Assignees */}
      <td className="tt-assignees" ref={assigneeRef}>
        <button type="button" className="tt-assignee-btn" aria-haspopup="true" aria-expanded={assigneeMenuOpen}
          aria-label={assignees.length ? `Assignees: ${assignees.map((m) => m.name).join(", ")}. Change` : "Add assignee"}
          onClick={() => setAssigneeMenuOpen((o) => !o)}
          onKeyDown={(e) => { if (e.key === "Escape") setAssigneeMenuOpen(false); }}>
          {assignees.length === 0 && <span className="tt-add">Add</span>}
          {assignees.length > 0 && (
            <span className="ui-avatar-stack">
              {assignees.slice(0, 3).map((m) => <Avatar key={m.id} name={m.name} email={m.email} size={22} />)}
              {assignees.length > 3 && <span className="tt-more">+{assignees.length - 3}</span>}
            </span>
          )}
        </button>
        {assigneeMenuOpen && (
          <div className="tt-menu">
            {teamMembers.map((m) => (
              <label key={m.id} className="tt-menu-item">
                <input type="checkbox" checked={(task.assigneeIds || []).includes(m.id)} onChange={() => toggleAssignee(m.id)} />
                <Avatar name={m.name} email={m.email} size={20} />
                <span>{m.name}</span>
              </label>
            ))}
            {teamMembers.length === 0 && <div className="tt-menu-empty">No members yet</div>}
          </div>
        )}
      </td>

      {/* Due date */}
      <td className={overdue ? "tt-due is-overdue" : "tt-due"}>
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
          aria-label={overdue ? "Due date (overdue)" : "Due date"}
          className="tt-input tt-date"
        />
        {overdue && <span className="tt-overdue"><span className="ui-glyph ui-glyph--diamond ui-tone--blocked" aria-hidden="true" />Overdue</span>}
      </td>

      {/* Tags */}
      <td>
        {editingTags ? (
          <input
            className="tt-input"
            aria-label="Tags, separated by commas"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the user just asked to edit this field
            autoFocus
            value={tagsDraft}
            onChange={(e) => setTagsDraft(e.target.value)}
            onBlur={() => { setEditingTags(false); save({ tags: tagsDraft.split(",").map((x) => x.trim()).filter(Boolean) }); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
            placeholder="tag1, tag2"
          />
        ) : (
          <div className="tt-tags" onClick={() => setEditingTags(true)} aria-label="Edit tags" role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setEditingTags(true))?.(e); } }}>
            {(task.tags || []).length === 0 && <span className="tt-add">Add</span>}
            {(task.tags || []).map((tag) => (
              <span key={tag} className="tt-tag">{tag}</span>
            ))}
          </div>
        )}
      </td>

      {/* Actions */}
      <td className="tt-actions">
        <button className="tt-icon-btn tt-delete" title="Delete task" aria-label={`Delete ${task.title}`} onClick={() => onDelete(task.id)}>
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}
