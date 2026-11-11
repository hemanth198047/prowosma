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
import PageHeader from "../components/PageHeader";
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
import { apiErrorMessage } from "../utils/apiError";
import { statusText } from "../utils/statusText";
import { AlertTriangle } from "lucide-react";
import { isTaskOverdue, OVERDUE_COLOR } from "../utils/overdue";
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

function groupByTag(tasks) {
  const map = {};
  tasks.forEach((t) => {
    const tags = t.tags?.length > 0 ? t.tags : ["No Tag"];
    tags.forEach((tag) => {
      if (!map[tag]) map[tag] = [];
      map[tag].push(t);
    });
  });
  return Object.entries(map).map(([tag, tasks]) => ({ tag, tasks }));
}

function groupByProject(tasks, projects) {
  const map = {};
  tasks.forEach((t) => {
    const proj = projects.find((p) => p.id === t.projectId);
    const key  = proj ? proj.id : "__none__";
    if (!map[key]) map[key] = { project: proj || null, tasks: [] };
    map[key].tasks.push(t);
  });
  // Sort: named projects first (alphabetically), then no-project
  return Object.values(map).sort((a, b) => {
    if (!a.project) return 1;
    if (!b.project) return -1;
    return a.project.name.localeCompare(b.project.name);
  });
}

function StatusDropdown({ task, onUpdate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const statusColor = {
    TODO: "var(--brand-500)",
    IN_PROGRESS: "var(--warning)",
    DONE: "var(--success)",
  };
  const statuses = ["TODO", "IN_PROGRESS", "DONE"];

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <div
        className="status-quick-btn"
        style={{
          background: statusColor[task.status] + "22",
          color: statusColor[task.status],
          border: `1px solid ${statusColor[task.status]}`,
        }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ((e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        })?.(e); } }}
      >
        {statusText(task.status)}
        <span style={{ fontSize: "10px", marginLeft: "4px" }}>▼</span>
      </div>
      {open && (
        <div className="status-dropdown">
          {statuses.map((s) => (
            <div
              key={s}
              className={`status-dropdown-item ${task.status === s ? "active" : ""}`}
              style={{ color: statusColor[s] }}
              onClick={(e) => {
                e.stopPropagation();
                onUpdate(task, s);
                setOpen(false);
              }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ((e) => {
                e.stopPropagation();
                onUpdate(task, s);
                setOpen(false);
              })?.(e); } }}
            >
              <div
                className="task-status-dot"
                style={{ background: statusColor[s] }}
              />
              {s.replace("_", " ")}
              {task.status === s && (
                <span style={{ marginLeft: "auto" }}>✓</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
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
  const [viewMode, setViewMode] = useState("table");
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

  // Due-date windows for the "This Week" / "This Month" options below —
  // calendar week (through Sunday) and calendar month, not a rolling
  // 7/30-day count, since "due this week" normally means "by the end of
  // the current week" rather than "within the next 7 days from right now".
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + (6 - endOfWeek.getDay())); // through Saturday
  endOfWeek.setHours(23, 59, 59, 999);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const filtered = tasks.filter((t) => {
    if (filterSpecial === "overdue") {
      if (!(t.dueDate && new Date(t.dueDate) < now && t.status !== "DONE")) return false;
    } else if (filterSpecial === "today") {
      if (!(t.dueDate && new Date(t.dueDate).toDateString() === now.toDateString())) return false;
    } else if (filterSpecial === "week") {
      if (!(t.dueDate && new Date(t.dueDate) >= startOfToday && new Date(t.dueDate) <= endOfWeek)) return false;
    } else if (filterSpecial === "month") {
      if (!(t.dueDate && new Date(t.dueDate) >= startOfToday && new Date(t.dueDate) <= endOfMonth)) return false;
    } else if (filterSpecial === "nodate") {
      if (t.dueDate) return false;
    }
    if (filterStatus && t.status !== filterStatus) return false;
    if (filterPriority && t.priority !== filterPriority) return false;
    if (filterProject) {
      const validIds = getProjectAndSubIds(filterProject);
      if (!validIds.includes(t.projectId)) return false;
    }
    if (filterAssignee) {
      if (filterAssignee === "__unassigned__") {
        if (t.assigneeIds?.length > 0) return false;
      } else if (!t.assigneeIds?.includes(filterAssignee)) {
        return false;
      }
    }
    if (search && !t.title.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  const priorityColor = { LOW: "var(--success)", MEDIUM: "var(--warning)", HIGH: "var(--danger)" };
  const statusColor = {
    TODO: "var(--brand-500)",
    IN_PROGRESS: "var(--warning)",
    DONE: "var(--success)",
  };

  /* Inner render helper — shared across all 3 view modes */
  const TaskRow = ({ t }) => (
    <div
      className={`task-row ${highlightId === t.id ? "task-row-highlight" : ""} ${selectedIds.has(t.id) ? "task-row-selected" : ""}`}
      key={t.id}
      ref={highlightId === t.id ? (el) => el?.scrollIntoView({ behavior: "smooth", block: "center" }) : null}
      style={highlightId === t.id ? {
        "--highlight-color": `#${highlightColor}`,
        "--highlight-bg": `#${highlightColor}11`,
        "--highlight-shadow": `rgba(${parseInt(highlightColor.slice(0,2),16)},${parseInt(highlightColor.slice(2,4),16)},${parseInt(highlightColor.slice(4,6),16)},0.2)`,
      } : {}}
    >
      <input type="checkbox" className="task-row-checkbox"
        checked={selectedIds.has(t.id)}
        onChange={() => toggleSelect(t.id)}
        onClick={e => e.stopPropagation()}
      />
      <div className="task-status-dot"
        style={{ background: t.blockedByTaskIds?.length > 0 ? "var(--danger)" : statusColor[t.status] }}
        title={t.blockedByTaskIds?.length > 0 ? "This task has dependencies" : t.status}
      />
      <div className="task-info">
        <div className="task-title">
          {t.title}
          <button className="btn-icon" style={{ fontSize: "14px", marginLeft: "6px" }}
            title="Quick view"
            onClick={() => setDrawerTask(t)}>
            ⤢
          </button>
          <button className="btn-icon" style={{ fontSize: "14px" }}
            title="Edit in full form"
            onClick={() => { setEditing({ ...t, dueDate: t.dueDate ? t.dueDate.slice(0,16) : "", tags: t.tags?.join(", ") || "" }); setShowForm(true); }}>
            ✏️
          </button>
          <StatusDropdown task={t} onUpdate={handleStatusUpdate} />
          <TaskComments task={t} onRefresh={load} />
          <TimeTracker task={t} onRefresh={load} />
          <FileAttachments task={t} onRefresh={load} />
          <TaskDependencies task={t} allTasks={tasks} onRefresh={load} />
          <button
            className={`btn-icon task-activity-btn ${activityOpenIds[t.id] ? "active" : ""}`}
            style={{ fontSize: "12px", padding: "2px 6px" }}
            title="Activity history"
            onClick={() => toggleActivity(t.id)}
          >📋</button>
        </div>
        {t.assigneeIds?.length > 0 && (
          <span style={{ display: "flex", gap: "2px", alignItems: "center" }}>
            👤{" "}
            {t.assigneeIds.map((id) => {
              const m = teamMembers.find((m) => m.id === id);
              return m ? (
                <span key={id} style={{ background: m.color || "var(--brand-500)", color: "#fff", borderRadius: "50%",
                  width: "18px", height: "18px", fontSize: "9px", fontWeight: 700,
                  display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  {m.name.slice(0, 2).toUpperCase()}
                </span>
              ) : null;
            })}
          </span>
        )}
        {t.dueDate && (isTaskOverdue(t)
          ? <span className="task-meta" style={{ marginTop: "2px", color: OVERDUE_COLOR, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <AlertTriangle size={11} aria-hidden="true" /><span className="sr-only">Overdue: </span>{new Date(t.dueDate).toLocaleDateString()}
            </span>
          : <span className="task-meta" style={{ marginTop: "2px" }}>📅 {new Date(t.dueDate).toLocaleDateString()}</span>)}
        {t.tags?.length > 0 && (
          <div className="task-meta" style={{ marginTop: "2px" }}>
            {t.tags.map(tag => <span key={tag} className="task-tag">{tag}</span>)}
          </div>
        )}
      </div>
      {activityOpenIds[t.id] && (
        <div className="task-activity-inline">
          <EntityActivityTab entityType="task" entityId={t.id} />
        </div>
      )}
      <div className="task-badges">
        <span className="badge" style={{ background: priorityColor[t.priority], color: "#fff" }}>
          {t.priority}
        </span>
        {t.type && t.type !== "TASK" && (
          <span className="badge" style={{ background:"#6366f118",color:"var(--brand-500)",border:"1px solid #6366f133" }}>
            {t.type}
          </span>
        )}
        {t.severity && t.severity !== "NONE" && (
          <span className="badge" style={{
            background: t.severity==="CRITICAL"?"#7c3aed18":t.severity==="HIGH"?"#ef444418":"#f59e0b18",
            color: t.severity==="CRITICAL"?"var(--purple)":t.severity==="HIGH"?"var(--danger)":"var(--warning)",
          }}>⚡{t.severity}</span>
        )}
        {t.slaStatus && t.slaStatus !== "NONE" && (
          <span className="badge" style={{
            background: t.slaStatus==="BREACHED"?"#ef444418":t.slaStatus==="AT_RISK"?"#f59e0b18":"#10b98118",
            color: t.slaStatus==="BREACHED"?"var(--danger)":t.slaStatus==="AT_RISK"?"var(--warning)":"var(--success)",
          }}>SLA:{t.slaStatus}</span>
        )}
        {(t.subtaskIds||[]).length > 0 && (
          <span className="badge" style={{background:"var(--gray-100)",color:"var(--gray-600)"}}>
            🔀{t.subtaskIds.length}
          </span>
        )}
        {(t.watcherIds||[]).length > 0 && (
          <span className="badge" style={{background:"var(--gray-100)",color:"var(--gray-600)"}}>
            👁{t.watcherIds.length}
          </span>
        )}
      </div>
      <LinkedDocsPanel taskId={t.id} allDocs={allDocs} />
      <div className="card-actions">
        <button className="btn-icon" onClick={() => handleDelete(t.id)}>🗑️</button>
      </div>
    </div>
  );

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

  return (
    <div>
      <PageHeader
        icon="✅"
        title="Tasks"
        description="Track and manage all your tasks"
        action={
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="btn-secondary"
              style={{ fontSize: "12px", padding: "8px 12px" }}
              onClick={handleExportCSV}
            >
              ⬇️ CSV
            </button>
            <button
              className="btn-secondary"
              style={{ fontSize: "12px", padding: "8px 12px" }}
              onClick={handleExportPDF}
            >
              ⬇️ PDF
            </button>
            <button className="btn-primary" onClick={() => setShowForm(true)}>
              + New Task
            </button>
          </div>
        }
      />

      <div className="tab-bar" style={{ marginBottom: "20px" }}>
        <button className={"tab-btn" + (mainTab === "projects" ? " tab-active" : "")} onClick={() => setMainTab("projects")}>
          📁 Project Tasks
        </button>
        <button className={"tab-btn" + (mainTab === "goals" ? " tab-active" : "")} onClick={() => setMainTab("goals")}>
          🎯 Goal Steps
        </button>
      </div>

      {mainTab === "projects" && (
      <><div className="filter-bar">
        <input
          style={{ width: "200px" }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search tasks..."
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
        >
          <option value="">All Priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select
          value={filterProject}
          onChange={(e) => setFilterProject(e.target.value)}
        >
          <option value="">All Projects</option>
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
        <select
          value={filterAssignee}
          onChange={(e) => setFilterAssignee(e.target.value)}
        >
          <option value="">All Assignees</option>
          <option value="__unassigned__">Unassigned</option>
          {teamMembers.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <select
          value={filterSpecial}
          onChange={(e) => setFilterSpecial(e.target.value)}
        >
          <option value="">Any Due Date</option>
          <option value="overdue">⚠️ Overdue</option>
          <option value="today">📅 Due Today</option>
          <option value="week">Due This Week</option>
          <option value="month">Due This Month</option>
          <option value="nodate">No Due Date</option>
        </select>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          {/* Overdue/Due Today used to be their own standalone toggle
              buttons here, duplicating what the new "Due Date" dropdown
              above now covers (plus This Week/This Month/No Due Date,
              which the buttons never offered) — one control for this
              instead of two. Deep links into this page still work the
              same either way (?filter=overdue / ?filter=today), since
              both drove and still drive the same filterSpecial state. */}
          {/* Table leads: it's the default and the recommended view for
              comparing tasks side-by-side. The other three stay for when
              grouping matters more than comparison. */}
          <button
            className={viewMode === "table" ? "btn-primary" : "btn-secondary"}
            style={{ padding: "8px 14px", fontSize: "12px" }}
            onClick={() => setViewMode("table")}
          >
            📊 Table
          </button>
          <button
            className={viewMode === "project" ? "btn-primary" : "btn-secondary"}
            style={{ padding: "8px 14px", fontSize: "12px" }}
            onClick={() => setViewMode("project")}
          >
            📁 By Project
          </button>
          <button
            className={viewMode === "grouped" ? "btn-primary" : "btn-secondary"}
            style={{ padding: "8px 14px", fontSize: "12px" }}
            onClick={() => setViewMode("grouped")}
          >
            🏷️ By Tag
          </button>
          <button
            className={viewMode === "list" ? "btn-primary" : "btn-secondary"}
            style={{ padding: "8px 14px", fontSize: "12px" }}
            onClick={() => setViewMode("list")}
          >
            ☰ List
          </button>
        </div>
      </div>

      {filterSpecial && (
        <div
          style={{
            marginBottom: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span
            style={{
              background: filterSpecial === "overdue" ? "#fff5f5" : "#fffbeb",
              color: filterSpecial === "overdue" ? "var(--danger)" : "var(--warning)",
              padding: "4px 12px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: 600,
              border: `1px solid ${filterSpecial === "overdue" ? "#fecaca" : "#fde68a"}`,
            }}
          >
            {filterSpecial === "overdue"
              ? "⚠️ Showing Overdue Tasks"
              : "📅 Showing Due Today Tasks"}
          </span>
          <button
            className="btn-link"
            style={{ fontSize: "12px" }}
            onClick={() => setFilterSpecial("")}
          >
            Clear Filter ✕
          </button>
        </div>
      )}

      {/* ── Bulk action toolbar ── */}
      {filtered.length > 0 && (
        <div className="bulk-toolbar">
          <label className="bulk-select-all">
            <input type="checkbox"
              checked={selectedIds.size === filtered.length && filtered.length > 0}
              onChange={e => e.target.checked ? setSelectedIds(new Set(filtered.map(t => t.id))) : clearSelection()}
            />
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
          </label>
          {selectedIds.size > 0 && (
            <div className="bulk-actions">
              <span style={{ fontSize:"12px", color:"var(--gray-400)", marginRight:"4px" }}>Mark as:</span>
              <button className="btn-secondary" style={{ fontSize:"11px", padding:"4px 10px" }}
                onClick={() => handleBulkStatus("TODO")}>⬜ Todo</button>
              <button className="btn-secondary" style={{ fontSize:"11px", padding:"4px 10px" }}
                onClick={() => handleBulkStatus("IN_PROGRESS")}>🔄 In Progress</button>
              <button className="btn-secondary" style={{ fontSize:"11px", padding:"4px 10px" }}
                onClick={() => handleBulkStatus("DONE")}>✅ Done</button>
              <div style={{ width:"1px", background:"var(--border)", margin:"0 4px" }} />
              <button className="btn-secondary" style={{ fontSize:"11px", padding:"4px 10px", color:"var(--danger)" }}
                onClick={handleBulkDelete}>🗑️ Delete ({selectedIds.size})</button>
              <button className="btn-secondary" style={{ fontSize:"11px", padding:"4px 10px" }}
                onClick={clearSelection}>✕ Clear</button>
            </div>
          )}
        </div>
      )}

      {/* ── Task list rendering ── */}
      {viewMode === "list" && (
        <div className="task-list">
          {filtered.map((t) => <TaskRow key={t.id} t={t} />)}
          {filtered.length === 0 && <p className="empty-state">No tasks found.</p>}
        </div>
      )}

      {viewMode === "project" && (
        <div>
          {groupByProject(filtered, projects).length === 0 ? (
            <p className="empty-state">No tasks found.</p>
          ) : (
            groupByProject(filtered, projects).map(({ project, tasks: ptasks }) => (
              <div className="project-task-group" key={project?.id || "__none__"}>
                <div className="project-task-group-header">
                  <div className="project-task-group-dot"
                    style={{ background: project?.color || "var(--gray-400)" }} />
                  <span className="project-task-group-name">
                    {project ? project.name : "No Project"}
                  </span>
                  <span className="project-task-group-count">
                    {ptasks.length} task{ptasks.length !== 1 ? "s" : ""}
                  </span>
                  {project && (
                    <span className="badge"
                      style={{ fontSize: "10px", padding: "2px 8px",
                        background: project.status === "ACTIVE" ? "rgba(5,150,105,0.12)" : "var(--gray-100)",
                        color: project.status === "ACTIVE" ? "#15803d" : "var(--gray-600)" }}>
                      {statusText(project.status)}
                    </span>
                  )}
                </div>
                <div className="task-list">
                  {ptasks.map((t) => <TaskRow key={t.id} t={t} />)}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {viewMode === "grouped" && (
        <div>
          {groupByTag(filtered).map(({ tag, tasks: gtasks }) => (
            <div className="tag-group" key={tag}>
              <div className="tag-group-header">
                <span className="task-tag" style={{ fontSize: "13px", padding: "4px 12px" }}>
                  🏷️ {tag}
                </span>
                <span style={{ fontSize: "12px", color: "#888" }}>
                  {gtasks.length} task{gtasks.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="task-list">
                {gtasks.map((t) => <TaskRow key={t.id} t={t} />)}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <p className="empty-state">No tasks found.</p>}
        </div>
      )}

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
            <input style={{ width: "220px" }} value={goalSearch}
              onChange={(e) => setGoalSearch(e.target.value)}
              placeholder="🔍 Search goals or steps..." />
            <select value={goalFilterStatus} onChange={(e) => setGoalFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
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
