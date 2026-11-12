import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { getTasks, createTask, updateTask, patchTask, deleteTask } from "../api/tasks";
import { unwrapList } from "../api/client";
import { getDocs } from "../api/docs";
import { getGoals, toggleStep, deleteStep, addStep, updateSubGoal,
  addStepComment, deleteStepComment,
  addStepAttachment, deleteStepAttachment,
  addStepDependency, removeStepDependency,
} from "../api/goals";
import { getProjects } from "../api/projects";
import ActionMenu from "../components/ui/ActionMenu";
import StatusPill from "../components/ui/StatusPill";
import PriorityTag from "../components/ui/PriorityTag";
import { taskMatches, facetCount, matchesDue, groupTasks } from "../utils/taskFilters";
import IntegrationPanel from "../components/IntegrationPanel";
import { useToast } from "../components/ToastContext";
import { useAuth } from "../hooks/useAuth";
import { useConfirm } from "../hooks/useConfirm";
import DateTimePicker from "../components/DateTimePicker";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import TaskComments from "../components/TaskComments";
import TimeTracker from "../components/TimeTracker";
import { getTeamMembers } from "../api/team";
import FileAttachments from "../components/FileAttachments";
import TaskDependencies from "../components/TaskDependencies";
import CustomFieldValues from "../components/CustomFieldValues";
import EntityActivityTab from "../components/EntityActivityTab";
import TaskTable from "../components/TaskTable";
import TaskDrawer from "../components/TaskDrawer";

import "../styles/pages/tasks.css";
import "../styles/pages/task-list.css";
import { apiErrorMessage } from "../utils/apiError";
import { statusText } from "../utils/statusText";
import {
  AlertTriangle, Check, ChevronDown, Download, Eye, FileSpreadsheet, FileText, GitBranch, History, Link2, List,
  PanelRight, Pencil, Plus, Search, SlidersHorizontal, Table2, Trash2,
} from "lucide-react";
import { isTaskOverdue } from "../utils/overdue";
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
const STATUSES = ["TODO", "IN_PROGRESS", "DONE"];

// ── Linked Docs Panel — shows docs that embed this task ──────
// allDocs is loaded ONCE at page level and passed down — no N+1 calls
function LinkedDocsPanel({ taskId, allDocs }) {
  const linked = useMemo(() =>
    (allDocs || []).filter(d => {
      if (d.deleted) return false;
      try {
        const blocks = JSON.parse(d.content || "[]");
        return blocks.some(b => b.type === "taskembed" && b.content === taskId);
      } catch { return false; }
    }),
    [taskId, allDocs]
  );

  if (linked.length === 0) return null;

  return (
    <div className="task-linked-docs">
      <span className="task-linked-docs-label">📄 Linked docs</span>
      {linked.map(d => (
        <a key={d.id} href={`/docs?id=${d.id}`} className="task-linked-doc-chip" title={d.title}>
          {d.emoji || "📄"} {d.title || "Untitled"}
        </a>
      ))}
    </div>
  );
}

function TaskForm({ initial, projects, onSave, onCancel }) {
  const confirm = useConfirm();
  const [formSaving, setFormSaving] = useState(false);
  const [form, setForm] = useState(
    initial || {
      title: "",
      description: "",
      projectId: "",
      status: "TODO",
      priority: "MEDIUM",
      dueDate: "",
      tags: "",
      recurrence: "NONE",
      customFieldValues: {},
    },
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>{initial ? "Edit Task" : "New Task"}</h2>
        <div className="form-group">
          <label htmlFor={"tasks-title"}>Title *</label>
          <input
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Task title" id={"tasks-title"}
          />
        </div>
        <div className="form-group">
          <label htmlFor={"tasks-description"}>Description</label>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
            placeholder="Optional description" id={"tasks-description"}
          />
        </div>
        <div className="form-group">
          <label htmlFor={"tasks-project"}>Project</label>
          <select
            value={form.projectId}
            onChange={(e) => set("projectId", e.target.value)} id={"tasks-project"}
          >
            <option value="">-- No Project --</option>
            {projects
              .filter((p) => !p.parentProjectId)
              .map((p) => (
                <optgroup key={p.id} label={p.name}>
                  <option value={p.id}>{p.name}</option>
                  {projects
                    .filter((sp) => sp.parentProjectId === p.id)
                    .map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        ↳ {sp.name}
                      </option>
                    ))}
                </optgroup>
              ))}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"tasks-status"}>Status</label>
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value)} id={"tasks-status"}
            >
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor={"tasks-priority"}>Priority</label>
            <select
              value={form.priority}
              onChange={(e) => set("priority", e.target.value)} id={"tasks-priority"}
            >
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-group">
          <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
            <legend style={{ padding: 0 }} className="field-label">Due Date</legend>
            <DateTimePicker value={form.dueDate} onChange={(val) => set("dueDate", val)} />
          </fieldset>
        </div>
        <div className="form-group">
          <label htmlFor={"tasks-tags-comma-separated"}>Tags (comma separated)</label>
          <input
            value={form.tags}
            onChange={(e) => set("tags", e.target.value)}
            placeholder="e.g. urgent, frontend, bug" id={"tasks-tags-comma-separated"}
          />
        </div>
        <div className="form-group">
          <label htmlFor={"tasks-recurrence"}>Recurrence</label>
          <select
            value={form.recurrence}
            onChange={(e) => set("recurrence", e.target.value)} id={"tasks-recurrence"}
          >
            <option value="NONE">No Recurrence</option>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
          </select>
        </div>
        <CustomFieldValues
          entityType="TASK"
          values={form.customFieldValues || {}}
          onChange={(vals) => set("customFieldValues", vals)}
        />

        {/* ── Task type + severity ── */}
        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"tasks-type"}>Type</label>
            <select value={form.type||"TASK"} onChange={e=>set("type",e.target.value)} id={"tasks-type"}>
              {["TASK","BUG","STORY","FEATURE","IMPROVEMENT","EPIC"].map(t=>(
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor={"tasks-severity"}>Severity</label>
            <select value={form.severity||"NONE"} onChange={e=>set("severity",e.target.value)} id={"tasks-severity"}>
              {["NONE","LOW","MEDIUM","HIGH","CRITICAL"].map(s=>(
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor={"tasks-sla-hours"}>SLA (hours)</label>
            <input type="number" value={form.slaHours||""} min={1}
              onChange={e=>set("slaHours",e.target.value?Number(e.target.value):null)}
              placeholder="e.g. 24" id={"tasks-sla-hours"} />
          </div>
        </div>

        {/* ── Watchers ── */}
        <div className="form-group">
          <label htmlFor={"tasks-watchers-emails-comma-separated"}>Watchers (emails, comma-separated)</label>
          <input value={(form.watcherIds||[]).join(",")}
            onChange={e=>set("watcherIds",e.target.value.split(",").map(x=>x.trim()).filter(Boolean))}
            placeholder="alice@co.com, bob@co.com" id={"tasks-watchers-emails-comma-separated"} />
        </div>

        {/* Integration panel — Confluence & Slack links */}
        {initial?.id && (
          <IntegrationPanel entity={{ type:"task", id:initial.id, title:initial.title }} />
        )}

        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary"
            disabled={formSaving || !form.title.trim()}
            onClick={async () => {
              if (formSaving || !form.title.trim()) return;
              // Only for brand-new tasks (not edits — marking an existing
              // task Done is the normal, expected way to complete it).
              // Creating one already-Done isn't blocked outright, since
              // retroactively logging finished work is a legitimate,
              // common use case — just double-checked, since it's also an
              // easy status to pick by habit/muscle-memory without
              // noticing, right after opening a brand new task form.
              if (!initial && form.status === "DONE") {
                const ok = await confirm({
                  title: "Create this task as already Done?",
                  message: "This will create a brand-new task with its status set to Done. If that's not intentional, go back and pick a different status.",
                  confirmText: "Create as Done",
                });
                if (!ok) return;
              }
              setFormSaving(true);
              try { await onSave(form); } finally { setFormSaving(false); }
            }}>
            {formSaving ? "⏳ Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Remembered per browser: the list/table choice and the list's grouping.
function readPref(key, allowed, fallback) {
  try { const v = localStorage.getItem(key); return allowed.includes(v) ? v : fallback; } catch { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: not remembered */ }
}

// Status as a pill that opens a small menu of the three statuses.
function StatusMenu({ task, onUpdate }) {
  return (
    <ActionMenu
      label={`Status of ${task.title}`}
      align="start"
      className="tk-status-trigger"
      items={STATUSES.map((s) => ({
        label: (task.status === s ? "✓ " : "") + statusText(s),
        onSelect: () => { if (task.status !== s) onUpdate(task, s); },
      }))}
    >
      <StatusPill status={task.status} />
      <ChevronDown size={12} aria-hidden="true" className="tk-status-chev" />
    </ActionMenu>
  );
}

function GoalStepAdder({ onAdd }) {
  const [title, setTitle] = useState("");
  const [adderSaving, setAdderSaving] = useState(false);
  const handleAdd = async () => {
    if (!title.trim() || adderSaving) return;
    setAdderSaving(true);
    try { await onAdd(title.trim()); setTitle(""); }
    finally { setAdderSaving(false); }
  };
  return (
    <div className="step-add-row" style={{ padding: "6px 12px" }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder="Add a step..." onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        style={{ fontSize: "12px", padding: "5px 10px" }} />
      <button className="btn-primary"
        style={{ fontSize: "12px", padding: "5px 12px", whiteSpace: "nowrap" }}
        onClick={handleAdd} disabled={adderSaving || !title.trim()}>
        {adderSaving ? "⏳" : "+ Add"}
      </button>
    </div>
  );
}

// ── Inline step tools for Tasks page Goal Steps tab ──────────
function StepToolsInline({ step, allSteps, goalId, subGoalId, onRefresh }) {
  const [open, setOpen]         = useState(null); // "comments"|"files"|"deps"
  const [commentText, setCommentText] = useState("");
  const [uploading, setUploading]     = useState(false);
  const fileRef = useRef(null);

  const toggle = (panel) => setOpen(o => o === panel ? null : panel);

  const postComment = async () => {
    if (!commentText.trim()) return;
    await addStepComment(goalId, subGoalId, step.id, { text: commentText.trim() });
    setCommentText(""); onRefresh();
  };

  const uploadFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    const fd = new FormData(); fd.append("file", file);
    await addStepAttachment(goalId, subGoalId, step.id, fd);
    setUploading(false); e.target.value = ""; onRefresh();
  };

  const cc = step.comments?.length || 0;
  const fc = step.attachments?.length || 0;
  const dc = step.blockedByStepIds?.length || 0;

  return (
    <>
      <button className="step-tool-btn" title="Comments" onClick={() => toggle("comments")}>
        💬{cc > 0 && <span className="step-tool-count">{cc}</span>}
      </button>
      <button className="step-tool-btn" title="Files" onClick={() => toggle("files")}>
        📎{fc > 0 && <span className="step-tool-count">{fc}</span>}
      </button>
      <button className="step-tool-btn" title="Manage step dependencies — set which steps must finish before this one"
        onClick={() => toggle("deps")}>
        🔗{dc > 0
          ? <span className="step-tool-count" style={{ background:"rgba(239,68,68,0.12)", color:"var(--danger)" }}>{dc} blocked</span>
          : <span style={{ fontSize:"10px", color:"var(--gray-400)" }}>deps</span>}
      </button>

      {open === "comments" && (
        <div className="step-panel" style={{ gridColumn:"1/-1", marginLeft:"24px" }}>
          {step.comments?.length > 0 ? step.comments.map(c => (
            <div key={c.id} className="step-comment">
              <span className="step-comment-author">{c.author?.split("@")[0]}</span>
              <span className="step-comment-text">{c.text}</span>
              <button className="btn-icon" style={{ fontSize:"11px" }}
                onClick={async () => { await deleteStepComment(goalId, subGoalId, step.id, c.id); onRefresh(); }}>✕</button>
            </div>
          )) : <p className="step-panel-empty">No comments yet</p>}
          <div className="step-comment-input">
            <input value={commentText} onChange={e => setCommentText(e.target.value)}
              placeholder="Add a comment…" onKeyDown={e => e.key === "Enter" && postComment()} />
            <button className="btn-primary" style={{ fontSize:"11px", padding:"4px 10px" }}
              onClick={postComment} disabled={!commentText.trim()}>Post</button>
          </div>
        </div>
      )}

      {open === "files" && (
        <div className="step-panel" style={{ gridColumn:"1/-1", marginLeft:"24px" }}>
          {step.attachments?.length > 0 ? step.attachments.map(a => (
            <div key={a.id} className="step-file-row">
              <span>📄</span><span className="step-file-name">{a.originalName || a.fileName}</span>
              <span className="step-file-size">{a.fileSize ? `${Math.round(a.fileSize/1024)}KB` : ""}</span>
              <button className="btn-icon" style={{ fontSize:"11px" }}
                onClick={async () => { await deleteStepAttachment(goalId, subGoalId, step.id, a.id); onRefresh(); }}>✕</button>
            </div>
          )) : <p className="step-panel-empty">No files attached</p>}
          <input type="file" ref={fileRef} style={{ display:"none" }} onChange={uploadFile} />
          <button className="btn-secondary" style={{ fontSize:"11px", marginTop:"4px" }} disabled={uploading}
            onClick={() => fileRef.current?.click()}>
            {uploading ? "⏳ Uploading…" : "📎 Attach File"}
          </button>
        </div>
      )}

      {open === "deps" && (
        <div className="step-panel" style={{ gridColumn:"1/-1", marginLeft:"24px" }}>
          <div style={{ fontSize:"12px", color:"var(--gray-500)", marginBottom:"10px", lineHeight:"1.5" }}>
            <strong>Step dependencies</strong> — mark which steps must be completed <em>before</em> this one can start.
          </div>

          {step.blockedByStepIds?.length > 0 ? (
            <div style={{ marginBottom:"12px" }}>
              <div className="step-panel-label">⛔ This step is blocked until these finish:</div>
              {step.blockedByStepIds.map(bid => {
                const b = allSteps.find(s => s.id === bid);
                return b ? (
                  <div key={bid} className="step-dep-row">
                    <span className={`step-dep-dot ${b.completed ? "done" : ""}`} />
                    <div style={{ flex:1 }}>
                      <span className="step-dep-title"
                        style={{ textDecoration: b.completed ? "line-through" : "none",
                                 color: b.completed ? "var(--gray-400)" : "var(--gray-700)" }}>
                        {b.title}
                      </span>
                      <span style={{ fontSize:"10px", marginLeft:"6px",
                        color: b.completed ? "var(--success)" : "var(--warning)", fontWeight:600 }}>
                        {b.completed ? "✓ Done" : "⏳ Pending"}
                      </span>
                    </div>
                    <button className="btn-icon" style={{ fontSize:"11px" }}
                      title="Remove this dependency"
                      onClick={async () => { await removeStepDependency(goalId, subGoalId, step.id, bid); onRefresh(); }}>✕</button>
                  </div>
                ) : null;
              })}
            </div>
          ) : (
            <p className="step-panel-empty" style={{ marginBottom:"10px" }}>
              No dependencies — this step can start anytime.
            </p>
          )}

          {allSteps.filter(s => s.id !== step.id && !step.blockedByStepIds?.includes(s.id)).length > 0 && (
            <div>
              <div className="step-panel-label">➕ Block this step until one of these finishes:</div>
              <div className="step-dep-add-list">
                {allSteps.filter(s => s.id !== step.id && !step.blockedByStepIds?.includes(s.id)).map(s => (
                  <button key={s.id} className="btn-secondary"
                    style={{ fontSize:"11px", padding:"4px 10px", display:"flex", gap:"5px", alignItems:"center" }}
                    title={`Add "${s.title}" as a prerequisite`}
                    onClick={async () => { await addStepDependency(goalId, subGoalId, step.id, s.id); onRefresh(); }}>
                    <span className={`step-dep-dot ${s.completed ? "done" : ""}`} />
                    {s.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          {allSteps.filter(s => s.id !== step.id).length === 0 && (
            <p className="step-panel-empty">No other steps in this sub-goal to depend on.</p>
          )}
        </div>
      )}
    </>
  );
}

export default function Tasks() {
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const highlightColor = searchParams.get("hcolor") || "ef4444";
  const newTaskParam = searchParams.get("newTask");

  const { show: showToast } = useToast();
  const confirm = useConfirm();
  const { activeWorkspace } = useAuth();
  const [allDocs, setAllDocs] = useState([]);
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    getDocs(activeWorkspace.id)
      .then(r => setAllDocs(Array.isArray(r.data) ? r.data : (r.data?.data ?? [])))
      .catch(() => {});
  }, [activeWorkspace?.id]);
  const [mainTab, setMainTab] = useState("projects");
  const [tasks, setTasks] = useState([]);
  const [goals, setGoals] = useState([]);
  const [goalSearch, setGoalSearch] = useState("");
  const [goalFilterStatus, setGoalFilterStatus] = useState("");
  const [expandedGoals, setExpandedGoals] = useState(null);
  const [editingStep, setEditingStep] = useState(null);
  const [editStepTitle, setEditStepTitle] = useState("");
  const [projects, setProjects] = useState([]);
  const [filterStatus, setFilterStatus] = useState(
    searchParams.get("status") || "",
  );
  const [filterPriority, setFilterPriority] = useState("");
  const [filterProject, setFilterProject] = useState(
    searchParams.get("projectId") || "",
  );
  // Extended to cover more than the original overdue/today (see the
  // combined "Due Date" dropdown below) — kept as one state, still
  // seeded from ?filter=, so existing links into this page (the
  // Dashboard's Overdue/Today stat tiles) keep working unchanged.
  const [filterSpecial, setFilterSpecial] = useState(
    searchParams.get("filter") || "",
  );
  const [filterAssignee, setFilterAssignee] = useState("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(newTaskParam === "true");
  const [editing, setEditing] = useState(null);
  // Table is the default: a task list is dense, comparable, tabular data
  // (status/priority/assignee/due-date per row) — the same reasoning that
  // makes a table the right choice in a spreadsheet applies here. The
  // other three views (by-project, plain list, by-tag) stay available
  // for when grouping matters more than side-by-side comparison.
  const [viewMode, setViewMode] = useState(() => readPref("tasks.view", ["list", "table"], "list"));
  const [groupBy, setGroupBy] = useState(() => readPref("tasks.groupBy", ["due", "status", "project", "tag"], "due"));
  const [railOpen, setRailOpen] = useState(false); // phones only: the rail folds away
  const chooseView = (v) => { setViewMode(v); writePref("tasks.view", v); };
  const chooseGroupBy = (g) => { setGroupBy(g); writePref("tasks.groupBy", g); };
  const [drawerTask, setDrawerTask] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [activityOpenIds, setActivityOpenIds] = useState({});
  const toggleActivity = (id) => setActivityOpenIds(prev => ({ ...prev, [id]: !prev[id] }));

  // ── Bulk actions ────────────────────────────────────────────
  const [selectedIds, setSelectedIds]   = useState(new Set());
  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const clearSelection = () => { setSelectedIds(new Set()); };
  const selectAllInList = (list, checked) => {
    if (checked) setSelectedIds(new Set(list.map((t) => t.id)));
    else clearSelection();
  };

  const load = async () => {
    const [taskRes, projRes, memberRes, goalRes] = await Promise.all([
      getTasks(), getProjects(), getTeamMembers(), getGoals(),
    ]);
    setTasks(unwrapList(taskRes));
    setProjects(unwrapList(projRes));
    setTeamMembers(unwrapList(memberRes));
    setGoals(unwrapList(goalRes));
    setExpandedGoals((prev) => prev || new Set(unwrapList(goalRes).length > 0 ? [unwrapList(goalRes)[0].id] : []));
  };

  useEffect(() => {
    const fetchData = async () => {
      const [taskRes, projRes, memberRes, goalRes] = await Promise.all([
        getTasks(), getProjects(), getTeamMembers(), getGoals(),
      ]);
      setTasks(unwrapList(taskRes));
      setProjects(unwrapList(projRes));
      setTeamMembers(unwrapList(memberRes));
      setGoals(unwrapList(goalRes));
      setExpandedGoals(new Set(unwrapList(goalRes).length > 0 ? [unwrapList(goalRes)[0].id] : []));
    };
    fetchData();
  }, []);

  const handleSave = async (form) => {
    const payload = {
      ...form,
      dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      tags: form.tags
        ? form.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
    };
    // Previously had no try/catch at all: if createTask/updateTask rejected
    // for any reason, the error vanished silently — nothing shown to the
    // user, and since setShowForm(false) only ran on the line *after* a
    // successful save, the modal just sat there looking frozen with no
    // indication anything had gone wrong. Now the failure is visible, and
    // the form stays open (with whatever was typed still in it) so the
    // person can fix it and retry instead of having to start over.
    try {
      if (editing) await updateTask(editing.id, payload);
      else await createTask(payload);
      setShowForm(false);
      setEditing(null);
      load();
    } catch (err) {
      // Not re-thrown: TaskForm's click handler only has try/finally (no
      // catch) around this call, so letting the error keep propagating
      // would just become an unhandled promise rejection in the console
      // with nothing left to actually handle it. The toast above is the
      // full handling; TaskForm's own finally still resets its saving
      // spinner regardless of whether this throws or returns normally.
      showToast(err.response?.data?.message || "Failed to save task", "error");
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({ title: "Delete this task?", message: "Permanently delete this task.", danger: true, confirmText: "Delete Task" });
    if (ok) {
      setTasks((prev) => prev.filter((t) => t.id !== id));
      try { await deleteTask(id); showToast("Task deleted", "success"); }
      catch (err) { load(); showToast(err.response?.data?.message || "Failed to delete task", "error"); }
    }
  };

  // Raw delete with no built-in confirmation — used by TaskDrawer, which
  // already shows its own confirm dialog before calling this. Reusing
  // handleDelete there would show two confirmation dialogs back to back.
  const rawDeleteTask = async (id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try { await deleteTask(id); showToast("Task deleted", "success"); }
    catch (err) { load(); showToast(err.response?.data?.message || "Failed to delete task", "error"); }
  };

  // Single-field (or few-field) inline edit — used by the table and drawer's
  // per-cell/per-field controls. Optimistically updates local state so the
  // UI feels instant, backed by a real PATCH so it's never just cosmetic.
  const handlePatchField = async (id, fields) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...fields } : t)));
    try {
      await patchTask(id, fields);
    } catch (err) {
      load(); // fields didn't actually save - resync with the server and let the user see the real state
      showToast(apiErrorMessage(err, "Couldn't save that change"), "error");
    }
  };

  const handleStatusUpdate = async (task, newStatus) => {
    await updateTask(task.id, { ...task, status: newStatus });
    load();
  };

  const handleBulkStatus = async (status) => {
    await Promise.all([...selectedIds].map(id => {
      const t = tasks.find(t => t.id === id);
      return t ? updateTask(id, { ...t, status }) : null;
    }));
    showToast(`${selectedIds.size} task${selectedIds.size > 1 ? "s" : ""} updated to ${status.replace("_", " ")}`, "success");
    clearSelection(); load();
  };

  const handleBulkDelete = async () => {
    const ok = await confirm({ title: `Delete ${selectedIds.size} tasks?`,
      message: "This cannot be undone.", danger: true, confirmText: "Delete All" });
    if (!ok) return;
    await Promise.all([...selectedIds].map(id => deleteTask(id)));
    showToast(`${selectedIds.size} tasks deleted`, "success");
    clearSelection(); load();
  };

  const handleExportCSV = () => {
    const data = filtered.map((t) => ({
      Title: t.title,
      Status: t.status,
      Priority: t.priority,
      Project: getProjectName(t.projectId) || "None",
      DueDate: t.dueDate ? new Date(t.dueDate).toLocaleDateString() : "None",
      Tags: t.tags?.join(", ") || "",
    }));
    exportToCSV(data, "tasks");
  };

  const handleExportPDF = () => {
    const columns = ["Title", "Status", "Priority", "Project", "Due Date"];
    const rows = filtered.map((t) => [
      t.title,
      t.status,
      t.priority,
      getProjectName(t.projectId) || "None",
      t.dueDate ? new Date(t.dueDate).toLocaleDateString() : "None",
    ]);
    exportToPDF("Tasks Report", columns, rows, "tasks");
  };

  const getProjectName = (id) => {
    const proj = projects.find((p) => p.id === id);
    if (!proj) return "";
    if (proj.parentProjectId) {
      const parent = projects.find((p) => p.id === proj.parentProjectId);
      return parent ? `${parent.name} › ${proj.name}` : proj.name;
    }
    return proj.name;
  };

  const now = new Date();
  const getProjectAndSubIds = (projectId) => {
    if (!projectId) return [];
    const subIds = projects
      .filter((p) => p.parentProjectId === projectId)
      .map((p) => p.id);
    return [projectId, ...subIds];
  };

  const filters = {
    status: filterStatus,
    priority: filterPriority,
    project: filterProject,
    assignee: filterAssignee,
    due: filterSpecial,
    search,
  };
  const filterCtx = { now, projectIds: getProjectAndSubIds };
  const filtered = tasks.filter((t) => taskMatches(t, filters, filterCtx));
  const countFor = (key, value) => facetCount(tasks, filters, key, value, filterCtx);
  const activeFilterCount = [filterStatus, filterPriority, filterProject, filterAssignee, filterSpecial].filter(Boolean).length;
  const anyFilter = activeFilterCount > 0 || !!search;
  const clearFilters = () => {
    setFilterStatus(""); setFilterPriority(""); setFilterProject("");
    setFilterAssignee(""); setFilterSpecial(""); setSearch("");
  };
  const openCount = tasks.filter((t) => t.status !== "DONE").length;
  const overdueCount = tasks.filter((t) => isTaskOverdue(t, now)).length;
  const todayCount = tasks.filter((t) => t.status !== "DONE" && matchesDue(t, "today", now)).length;
  const groups = viewMode === "list" ? groupTasks(filtered, groupBy, { projects, statusLabel: statusText, now }) : [];

  const memberById = (id) => teamMembers.find((m) => m.id === id);
  const projectById = (id) => projects.find((p) => p.id === id);
  const editInForm = (t) => {
    setEditing({ ...t, dueDate: t.dueDate ? t.dueDate.slice(0, 16) : "", tags: t.tags?.join(", ") || "" });
    setShowForm(true);
  };

  /* One task in the list view. Every tool the old row had is still here:
     quick view, full edit, status, comments, time, files, dependencies,
     activity, linked docs, delete. */
  const renderTaskRow = (t) => {
    const overdue = isTaskOverdue(t, now);
    const proj = projectById(t.projectId);
    const people = (t.assigneeIds || []).map(memberById).filter(Boolean);
    const blocked = t.blockedByTaskIds?.length > 0;
    return (
      <li
        key={t.id}
        className={`tk-row ${highlightId === t.id ? "task-row-highlight" : ""} ${selectedIds.has(t.id) ? "tk-row--selected" : ""}`}
        ref={highlightId === t.id ? (el) => el?.scrollIntoView({ behavior: "smooth", block: "center" }) : null}
        style={highlightId === t.id ? {
          "--highlight-color": `#${highlightColor}`,
          "--highlight-bg": `#${highlightColor}11`,
          "--highlight-shadow": `rgba(${parseInt(highlightColor.slice(0,2),16)},${parseInt(highlightColor.slice(2,4),16)},${parseInt(highlightColor.slice(4,6),16)},0.2)`,
        } : {}}
      >
        <div className="tk-row-main">
          <input type="checkbox" className="tk-check"
            aria-label={`Select ${t.title}`}
            checked={selectedIds.has(t.id)}
            onChange={() => toggleSelect(t.id)}
            onClick={e => e.stopPropagation()}
          />
          <div className="tk-body">
            <button type="button" className={"tk-title" + (t.status === "DONE" ? " tk-title--done" : "")} onClick={() => setDrawerTask(t)}>
              {t.title}
            </button>
            <div className="tk-sub">
              {proj && <span className="tk-proj"><span className="tk-dot" style={{ background: proj.color || "var(--gray-400)" }} aria-hidden="true" />{getProjectName(t.projectId)}</span>}
              <StatusMenu task={t} onUpdate={handleStatusUpdate} />
              {blocked && <span className="tk-flag tk-flag--late" title="This task has dependencies"><Link2 size={12} aria-hidden="true" />Blocked</span>}
              {t.type && t.type !== "TASK" && <span className="tk-flag">{statusText(t.type)}</span>}
              {t.severity && t.severity !== "NONE" && <span className={"tk-flag" + (t.severity === "CRITICAL" || t.severity === "HIGH" ? " tk-flag--late" : "")}>Severity: {statusText(t.severity)}</span>}
              {t.slaStatus && t.slaStatus !== "NONE" && <span className={"tk-flag" + (t.slaStatus === "BREACHED" ? " tk-flag--late" : "")}>SLA: {statusText(t.slaStatus)}</span>}
              {(t.subtaskIds || []).length > 0 && <span className="tk-flag" title="Sub-tasks"><GitBranch size={12} aria-hidden="true" />{t.subtaskIds.length}</span>}
              {(t.watcherIds || []).length > 0 && <span className="tk-flag" title="Watchers"><Eye size={12} aria-hidden="true" />{t.watcherIds.length}</span>}
              {t.tags?.map(tag => <span key={tag} className="tk-tag">{tag}</span>)}
            </div>
          </div>
          <span className="tk-col-pri"><PriorityTag priority={t.priority} /></span>
          <span className="tk-col-who">
            {people.length > 0 ? (
              <>
                <span className="tk-avatars">
                  {people.slice(0, 3).map((m) => (
                    <span key={m.id} className="tk-avatar" style={{ background: m.color || "var(--brand-500)" }} title={m.name}>
                      {(m.name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                    </span>
                  ))}
                </span>
                <span className="tk-who-name">{people.length === 1 ? people[0].name.split(" ")[0] : `${people.length} people`}</span>
              </>
            ) : <span className="tk-who-none">Unassigned</span>}
          </span>
          <span className={"tk-col-due" + (overdue ? " tk-due--late" : "")}>
            {t.dueDate ? (
              <>
                {overdue && <AlertTriangle size={12} aria-hidden="true" />}
                {overdue && <span className="sr-only">Overdue: </span>}
                {new Date(t.dueDate).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </>
            ) : <span className="tk-who-none">—</span>}
          </span>
          <span className="tk-tools">
            <TaskComments task={t} onRefresh={load} compact />
            <TimeTracker task={t} onRefresh={load} compact />
            <FileAttachments task={t} onRefresh={load} compact />
            <TaskDependencies task={t} allTasks={tasks} onRefresh={load} compact />
          </span>
          <ActionMenu label={`More actions for ${t.title}`} items={[
            { label: "Quick view", icon: PanelRight, onSelect: () => setDrawerTask(t) },
            { label: "Edit in full form", icon: Pencil, onSelect: () => editInForm(t) },
            { label: activityOpenIds[t.id] ? "Hide activity" : "Activity", icon: History, onSelect: () => toggleActivity(t.id) },
            "divider",
            { label: "Delete", icon: Trash2, danger: true, onSelect: () => handleDelete(t.id) },
          ]} />
        </div>
        {activityOpenIds[t.id] && (
          <div className="task-activity-inline">
            <EntityActivityTab entityType="task" entityId={t.id} />
          </div>
        )}
        <LinkedDocsPanel taskId={t.id} allDocs={allDocs} />
      </li>
    );
  };

  const updateGoalInState = (updated) =>
    setGoals((prev) => prev.map((g) => g.id === updated.id ? updated : g));
  const handleToggleStep = async (goalId, subGoalId, stepId) => {
    const res = await toggleStep(goalId, subGoalId, stepId);
    updateGoalInState(res.data);
  };
  const handleDeleteStep = async (goalId, subGoalId, stepId) => {
    const ok = await confirm({ title: "Delete this step?", danger: true, confirmText: "Delete" });
    if (ok) { const res = await deleteStep(goalId, subGoalId, stepId); updateGoalInState(res.data); }
  };
  const handleSaveEditStep = async () => {
    if (!editingStep || !editStepTitle.trim()) return;
    const { goalId, subGoalId, step } = editingStep;
    const goal = goals.find((g) => g.id === goalId);
    const sg = goal?.subGoals?.find((s) => s.id === subGoalId);
    if (!sg) return;
    const updatedSteps = sg.steps.map((s) => s.id === step.id ? { ...s, title: editStepTitle.trim() } : s);
    const res = await updateSubGoal(goalId, subGoalId, { ...sg, steps: updatedSteps });
    updateGoalInState(res.data);
    setEditingStep(null); setEditStepTitle("");
  };
  const handleAddGoalStep = async (goalId, subGoalId, title) => {
    const res = await addStep(goalId, subGoalId, { title });
    updateGoalInState(res.data);
  };
  const toggleGoalExpanded = (goalId) => {
    setExpandedGoals((prev) => {
      const next = new Set(prev);
      if (next.has(goalId)) next.delete(goalId); else next.add(goalId);
      return next;
    });
  };
  const filteredGoals = goals.filter((g) => {
    const matchSearch = !goalSearch || g.title.toLowerCase().includes(goalSearch.toLowerCase()) ||
      g.subGoals?.some((sg) => sg.title.toLowerCase().includes(goalSearch.toLowerCase()) ||
        sg.steps?.some((s) => s.title.toLowerCase().includes(goalSearch.toLowerCase())));
    const matchStatus = !goalFilterStatus || g.status === goalFilterStatus;
    return matchSearch && matchStatus;
  });

  const STATUS_FACET = [["TODO", "To do"], ["IN_PROGRESS", "In progress"], ["DONE", "Done"]];
  const DUE_FACET = [["overdue", "Overdue"], ["today", "Due today"], ["week", "This week"], ["month", "This month"], ["nodate", "No due date"]];
  const PRIORITY_FACET = [["HIGH", "High"], ["MEDIUM", "Medium"], ["LOW", "Low"]];
  const renderFacet = (legend, fkey, value, setValue, options) => (
    <fieldset className="tk-facet">
      <legend>{legend}</legend>
      {options.map(([v, label]) => {
        const on = value === v;
        const n = countFor(fkey, v);
        return (
          <button key={v} type="button" className={"tk-facet-opt" + (on ? " on" : "")} aria-pressed={on}
            onClick={() => setValue(on ? "" : v)} disabled={!on && n === 0}>
            <span className="tk-facet-box" aria-hidden="true">{on && <Check size={12} strokeWidth={3} />}</span>
            <span className="tk-facet-label">{label}</span>
            <span className="tk-facet-n">{n}</span>
          </button>
        );
      })}
    </fieldset>
  );

  return (
    <div className="tk-page">
      <header className="pg-title-row">
        <div className="pg-title-text">
          <h1>Tasks</h1>
          {mainTab === "projects" ? (
            <p>
              {openCount} open
              {overdueCount > 0 && <> · <button type="button" className="tk-inline-link tk-inline-link--late" onClick={() => setFilterSpecial("overdue")}>{overdueCount} overdue</button></>}
              {todayCount > 0 && <> · <button type="button" className="tk-inline-link" onClick={() => setFilterSpecial("today")}>{todayCount} due today</button></>}
            </p>
          ) : (
            <p>Steps from your goals, in one place.</p>
          )}
        </div>
        <div className="pg-title-actions">
          <div className="tk-tabs" role="tablist" aria-label="Task source">
            <button type="button" role="tab" aria-selected={mainTab === "projects"} onClick={() => setMainTab("projects")}>Project tasks</button>
            <button type="button" role="tab" aria-selected={mainTab === "goals"} onClick={() => setMainTab("goals")}>Goal steps</button>
          </div>
          {mainTab === "projects" && (
            <ActionMenu label="Export" className="btn-secondary pg-btn" items={[
              { label: "CSV spreadsheet", icon: FileSpreadsheet, onSelect: handleExportCSV },
              { label: "PDF report", icon: FileText, onSelect: handleExportPDF },
            ]}>
              <Download size={14} aria-hidden="true" />Export
            </ActionMenu>
          )}
          <button type="button" className="btn-primary pg-btn" onClick={() => setShowForm(true)}>
            <Plus size={15} aria-hidden="true" />New task
          </button>
        </div>
      </header>

      {mainTab === "projects" && (
      <><div className="tk-layout">
        <aside className={"tk-rail" + (railOpen ? " open" : "")} aria-label="Filters">
          <button type="button" className="btn-secondary pg-btn tk-rail-toggle" aria-expanded={railOpen} onClick={() => setRailOpen(o => !o)}>
            <SlidersHorizontal size={14} aria-hidden="true" />
            Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
          </button>
          <label className="pg-find">
            <Search size={14} aria-hidden="true" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a task" placeholder="Find a task" />
          </label>
          {renderFacet("Status", "status", filterStatus, setFilterStatus, STATUS_FACET)}
          {renderFacet("Due", "due", filterSpecial, setFilterSpecial, DUE_FACET)}
          {renderFacet("Priority", "priority", filterPriority, setFilterPriority, PRIORITY_FACET)}
          <fieldset className="tk-facet">
            <legend>Project</legend>
            <select className="pg-select" aria-label="Filter by project" value={filterProject} onChange={(e) => setFilterProject(e.target.value)}>
              <option value="">All projects</option>
              {projects
                .filter((p) => !p.parentProjectId)
                .map((p) => (
                  <optgroup key={p.id} label={p.name}>
                    <option value={p.id}>{p.name}</option>
                    {projects
                      .filter((sp) => sp.parentProjectId === p.id)
                      .map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          ↳ {sp.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
            </select>
          </fieldset>
          <fieldset className="tk-facet">
            <legend>Assignee</legend>
            <select className="pg-select" aria-label="Filter by assignee" value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
              <option value="">Anyone</option>
              <option value="__unassigned__">Unassigned</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </fieldset>
          {anyFilter && (
            <button type="button" className="tk-clear" onClick={clearFilters}>Clear filters</button>
          )}
        </aside>

        <div className="tk-main">
          <div className="tk-toolbar">
            {filtered.length > 0 && (
              <label className="tk-select-all">
                <input type="checkbox"
                  checked={selectedIds.size === filtered.length && filtered.length > 0}
                  onChange={e => e.target.checked ? setSelectedIds(new Set(filtered.map(t => t.id))) : clearSelection()}
                />
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
              </label>
            )}
            {selectedIds.size > 0 ? (
              <div className="tk-bulk" role="group" aria-label="Bulk actions">
                <span className="tk-bulk-label">Mark as</span>
                <button type="button" className="btn-secondary tk-bulk-btn" onClick={() => handleBulkStatus("TODO")}>To do</button>
                <button type="button" className="btn-secondary tk-bulk-btn" onClick={() => handleBulkStatus("IN_PROGRESS")}>In progress</button>
                <button type="button" className="btn-secondary tk-bulk-btn" onClick={() => handleBulkStatus("DONE")}>Done</button>
                <span className="tk-bulk-sep" aria-hidden="true" />
                <button type="button" className="btn-secondary tk-bulk-btn tk-bulk-danger" onClick={handleBulkDelete}><Trash2 size={13} aria-hidden="true" />Delete ({selectedIds.size})</button>
                <button type="button" className="btn-secondary tk-bulk-btn" onClick={clearSelection}>Clear</button>
              </div>
            ) : (
              <span className="tk-count" aria-live="polite">{filtered.length} {filtered.length === 1 ? "task" : "tasks"}{anyFilter ? " match" : ""}</span>
            )}
            <span className="pg-spacer" />
            {viewMode === "list" && (
              <label className="tk-groupby">
                <span>Group by</span>
                <select className="pg-select" value={groupBy} onChange={(e) => chooseGroupBy(e.target.value)}>
                  <option value="due">Due date</option>
                  <option value="status">Status</option>
                  <option value="project">Project</option>
                  <option value="tag">Tag</option>
                </select>
              </label>
            )}
            <div className="pg-seg" role="group" aria-label="Layout">
              <button type="button" aria-pressed={viewMode === "list"} onClick={() => chooseView("list")}><List size={14} aria-hidden="true" />List</button>
              <button type="button" aria-pressed={viewMode === "table"} onClick={() => chooseView("table")}><Table2 size={14} aria-hidden="true" />Table</button>
            </div>
          </div>

          {filtered.length === 0 && (
            <div className="pg-empty">
              {tasks.length === 0 ? (
                <>
                  <h2>No tasks yet</h2>
                  <p>Add a task to a project to start tracking work.</p>
                  <button type="button" className="btn-primary pg-btn" onClick={() => setShowForm(true)}><Plus size={15} aria-hidden="true" />New task</button>
                </>
              ) : (
                <>
                  <h2>No tasks match</h2>
                  <p>Try a different filter{search ? ` or search than “${search}”` : ""}.</p>
                  <button type="button" className="btn-secondary pg-btn" onClick={clearFilters}>Clear filters</button>
                </>
              )}
            </div>
          )}

          {viewMode === "list" && groups.map((g) => (
            <section key={g.key} className={"tk-group" + (g.tone === "late" ? " tk-group--late" : "")} aria-label={g.label}>
              <h2 className="tk-group-head">
                {g.color && <span className="tk-dot" style={{ background: g.color }} aria-hidden="true" />}
                {g.label} <span>{g.tasks.length}</span>
              </h2>
              <ul className="tk-list">
                {g.tasks.map(renderTaskRow)}
              </ul>
            </section>
          ))}
      {viewMode === "table" && (
        <TaskTable
          tasks={filtered}
          projects={projects}
          teamMembers={teamMembers}
          selectedIds={selectedIds}
          toggleSelect={toggleSelect}
          onSelectAll={(checked) => selectAllInList(filtered, checked)}
          onUpdate={handlePatchField}
          onDelete={handleDelete}
          onOpenDrawer={setDrawerTask}
          highlightId={highlightId}
        />
      )}
        </div>
      </div>

      {showForm && (
        <TaskForm
          initial={editing}
          projects={projects}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      <TaskDrawer
        task={drawerTask}
        projects={projects}
        teamMembers={teamMembers}
        allTasks={tasks}
        onClose={() => setDrawerTask(null)}
        onUpdate={handlePatchField}
        onDelete={rawDeleteTask}
        onRefresh={load}
      />
      </>
      )}
      {mainTab === "goals" && (
        <div>
          <div className="filter-bar" style={{ marginBottom: "16px" }}>
            <label className="pg-find">
              <Search size={14} aria-hidden="true" />
              <input type="search" value={goalSearch} aria-label="Find a goal or step"
                onChange={(e) => setGoalSearch(e.target.value)}
                placeholder="Find a goal or step" />
            </label>
            <select className="pg-select" aria-label="Filter goals by status" value={goalFilterStatus} onChange={(e) => setGoalFilterStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="ACHIEVED">Achieved</option>
            </select>
            <span style={{ fontSize: "12px", color: "var(--gray-400)", marginLeft: "auto" }}>
              {filteredGoals.length} goal{filteredGoals.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="goal-steps-container">
            {filteredGoals.length === 0 ? (
              <div className="empty-state">
                {goals.length === 0 ? "No goals yet." : "No goals match your search."}
              </div>
            ) : filteredGoals.map((goal) => {
              const isExpanded = expandedGoals?.has(goal.id);
              return (
                <div key={goal.id} className="goal-steps-group">
                  <div className="goal-steps-group-header"
                    onClick={() => toggleGoalExpanded(goal.id)} style={{ cursor: "pointer" }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => toggleGoalExpanded(goal.id))?.(e); } }}>
                    <span className="goal-steps-icon">{"🎯"}</span>
                    <span className="goal-steps-title">{goal.title}</span>
                    <span className={"goal-steps-status " + goal.status.toLowerCase()}>{statusText(goal.status)}</span>
                    <div className="goal-steps-progress-bar">
                      <div className="goal-steps-progress-fill" style={{ width: (goal.progress || 0) + "%" }} />
                    </div>
                    <span className="goal-steps-progress">{goal.progress || 0}%</span>
                    <span style={{ marginLeft: "8px", fontSize: "12px", color: "var(--gray-400)" }}>
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  </div>
                  {isExpanded && (
                    <div>
                      {(!goal.subGoals || goal.subGoals.length === 0) ? (
                        <p className="goal-steps-empty">No sub-goals yet.</p>
                      ) : goal.subGoals.map((sg) => {
                        const done = sg.steps?.filter((s) => s.completed).length || 0;
                        const total = sg.steps?.length || 0;
                        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                        return (
                          <div key={sg.id} className="goal-steps-subgoal">
                            <div className="goal-steps-subgoal-header">
                              <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--gray-700)" }}>
                                {"↳ " + sg.title}
                              </span>
                              <span className="goal-step-mini-progress">
                                <span className="goal-step-mini-bar">
                                  <span style={{ width: pct + "%", background: pct === 100 ? "var(--success)" : "var(--brand-500)" }} />
                                </span>
                                {done}/{total} done
                              </span>
                            </div>
                            {(!sg.steps || sg.steps.length === 0) ? (
                              <p className="goal-steps-empty">No steps yet.</p>
                            ) : (
                              <div className="goal-steps-list">
                                {sg.steps.map((step) => (
                                  <div key={step.id} className={"goal-step-item" + (step.completed ? " done" : "")}>
                                    <div
                                      className={"goal-step-check" + (step.completed ? " checked" : "")}
                                      onClick={() => handleToggleStep(goal.id, sg.id, step.id)}
                                      style={{ cursor: "pointer" }}
                                      title={step.completed ? "Mark incomplete" : "Mark complete"} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => handleToggleStep(goal.id, sg.id, step.id))?.(e); } }}
                                    >
                                      {step.completed && <span>{"✓"}</span>}
                                    </div>
                                    {editingStep?.step.id === step.id ? (
                                      <input className="goal-step-edit-input" value={editStepTitle}
                                        onChange={(e) => setEditStepTitle(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") handleSaveEditStep();
                                          if (e.key === "Escape") { setEditingStep(null); setEditStepTitle(""); }
                                        }} />
                                    ) : (
                                      <span className="goal-step-label">{step.title}</span>
                                    )}
                                    {step.completed && editingStep?.step.id !== step.id && (
                                      <span className="goal-step-done-badge">Done</span>
                                    )}
                                    <div className="goal-step-actions">
                                      {editingStep?.step.id === step.id ? (
                                        <>
                                          <button className="btn-icon"
                                            style={{ color: "var(--brand-600)", fontSize: "11px" }}
                                            onClick={handleSaveEditStep} title="Save">{"✓"}</button>
                                          <button className="btn-icon" style={{ fontSize: "11px" }}
                                            onClick={() => { setEditingStep(null); setEditStepTitle(""); }}
                                            title="Cancel">{"✕"}</button>
                                        </>
                                      ) : (
                                        <>
                                          <button className="btn-icon" style={{ fontSize: "12px" }}
                                            onClick={() => { setEditingStep({ goalId: goal.id, subGoalId: sg.id, step }); setEditStepTitle(step.title); }}
                                            title="Edit">{"✏️"}</button>
                                          <StepToolsInline
                                            step={step}
                                            allSteps={sg.steps}
                                            goalId={goal.id}
                                            subGoalId={sg.id}
                                            onRefresh={load}
                                          />
                                          <button className="btn-icon" style={{ fontSize: "12px" }}
                                            onClick={() => handleDeleteStep(goal.id, sg.id, step.id)}
                                            title="Delete">{"🗑️"}</button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            <GoalStepAdder onAdd={(title) => handleAddGoalStep(goal.id, sg.id, title)} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
