import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, Archive, ArchiveRestore, Bot, CalendarDays, ChevronRight, Copy, Download, FileSpreadsheet,
  FileText, FolderPlus, History, LayoutGrid, List, ListChecks, Lock, Pencil, Plus, Search, Target, Trash2, Users,
} from "lucide-react";
import { unwrapList } from "../api/client";
import IntegrationPanel from "../components/IntegrationPanel";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  getProjects,
  getSubProjects,
  createProject,
  updateProject,
  deleteProject,
  getProjectProgress,
} from "../api/projects";
import { getCategories, createCategory } from "../api/categories";
import ActionMenu from "../components/ui/ActionMenu";
import StatusPill from "../components/ui/StatusPill";
import { usePeople } from "../context/PeopleContext";
import { groupProjects, projectSummary, isOverdue, dueLabel } from "../utils/projectGroups";
import "../styles/pages/projects.css";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../components/ToastContext";
import DateTimePicker from "../components/DateTimePicker";
import { formatDate } from "../utils/dateUtils";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import { getGoals, createGoal } from "../api/goals";
import CustomFieldValues from "../components/CustomFieldValues";
import EntityActivityTab from "../components/EntityActivityTab";
import { useAuth } from "../hooks/useAuth";
import { getMeetingsForProject } from "../api/meetings";
import { apiErrorMessage } from "../utils/apiError";
import { useAccess } from "../hooks/useAccess";
import ProjectAccessModal from "../components/ProjectAccessModal";
import ProjectTeamModal from "../components/ProjectTeamModal";
import PersonAvatar from "../components/people/PersonAvatar";

const COLORS = [
  "var(--brand-500)",
  "var(--warning)",
  "var(--success)",
  "var(--danger)",
  "#3b82f6",
  "var(--purple)",
  "#ec4899",
];
const STATUS = ["ACTIVE", "PAUSED", "DONE"];

function ProjectForm({
  initial,
  categories,
  projects,
  goals,
  onSave,
  onCancel,
  onCategoryCreated,
  onGoalCreated,
}) {
  const { show: showToast } = useToast();
  const [form, setForm] = useState(
    initial || {
      name: "",
      description: "",
      color: "var(--brand-500)",
      status: "ACTIVE",
      dueDate: "",
      categoryId: "",
      parentProjectId: "",
      linkedGoalId: "",
      customFieldValues: {},
    },
  );
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Close on ESC
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCancel]);

  // Local copies of categories/goals so we can add new ones immediately
  // without waiting for parent re-render
  const [localCategories, setLocalCategories] = useState(categories || []);
  const [localGoals,      setLocalGoals]      = useState(goals || []);

  // ── Inline category creation ──────────────────────────────
  const [showNewCat, setShowNewCat]   = useState(false);
  const [newCatName, setNewCatName]   = useState("");
  const [newCatColor, setNewCatColor] = useState("var(--brand-500)");
  const [catSaving, setCatSaving]     = useState(false);

  // ── Inline goal creation ───────────────────────────────────
  const [showNewGoal, setShowNewGoal]   = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalStatus, setNewGoalStatus] = useState("ACTIVE");
  const [goalSaving, setGoalSaving]     = useState(false);

  const handleCreateCategory = async () => {
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    setCatSaving(true);
    try {
      const res = await createCategory({ name: trimmed, color: newCatColor });
      // Backend returns Category object directly at res.data
      const created = res.data;
      if (!created || !created.id) {
        throw new Error("Server did not return a valid category. Response: " + JSON.stringify(created));
      }
      // 1. Add to local list first so the option exists in the dropdown
      setLocalCategories((prev) => [...prev, created]);
      // 2. Tell parent to refresh its list too
      if (onCategoryCreated) onCategoryCreated(created);
      // 3. Now select it — the option will exist on next render
      set("categoryId", created.id);
      setNewCatName("");
      setNewCatColor("var(--brand-500)");
      setShowNewCat(false);
    } catch (e) {
      const msg = apiErrorMessage(e, e.message);
      showToast("Failed to create category: " + msg, "error");
    } finally {
      setCatSaving(false);
    }
  };

  const handleCreateGoal = async () => {
    const trimmed = newGoalTitle.trim();
    if (!trimmed) return;
    setGoalSaving(true);
    try {
      const res = await createGoal({ title: trimmed, status: newGoalStatus, progress: 0 });
      const created = res.data;
      if (!created || !created.id) {
        throw new Error("Server did not return a valid goal. Response: " + JSON.stringify(created));
      }
      // 1. Add to local list first
      setLocalGoals((prev) => [...prev, created]);
      // 2. Tell parent
      if (onGoalCreated) onGoalCreated(created);
      // 3. Select it
      set("linkedGoalId", created.id);
      setNewGoalTitle("");
      setNewGoalStatus("ACTIVE");
      setShowNewGoal(false);
    } catch (e) {
      const msg = apiErrorMessage(e, e.message);
      showToast("Failed to create goal: " + msg, "error");
    } finally {
      setGoalSaving(false);
    }
  };

  const rootProjects = projects.filter(
    (p) => !p.parentProjectId && p.id !== initial?.id,
  );

  return (
    <div className="modal-overlay" onClick={onCancel} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onCancel)?.(e); } }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="presentation">
        <h2>{initial?.id ? "Edit Project" : initial?.parentProjectId ? "New Sub-Project" : "New Project"}</h2>
        <div className="form-group">
          <label htmlFor={"projects-name"}>Name *</label>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Project name" id={"projects-name"}
          />
        </div>
        <div className="form-group">
          <label htmlFor={"projects-description"}>Description</label>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
            placeholder="Optional description" id={"projects-description"}
          />
        </div>
        <div className="form-group">
          <label htmlFor={"projects-parent-project-optional"}>Parent Project (optional)</label>
          <select
            value={form.parentProjectId}
            onChange={(e) => set("parentProjectId", e.target.value)} id={"projects-parent-project-optional"}
          >
            <option value="">-- No Parent (Root Project) --</option>
            {rootProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor={"projects-category"}>Category</label>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <select
              value={form.categoryId}
              onChange={(e) => set("categoryId", e.target.value)}
              style={{ flex: 1 }} id={"projects-category"}
            >
              <option value="">-- No Category --</option>
              {localCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowNewCat((v) => !v)}
              title="Create a new category"
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                background: showNewCat ? "var(--brand-500)" : "var(--gray-50)",
                color: showNewCat ? "#fff" : "var(--brand-500)",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: "16px",
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              +
            </button>
          </div>

          {showNewCat && (
            <div style={{
              marginTop: "10px",
              padding: "14px",
              background: "var(--gray-50)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--gray-700)" }}>
                New Category
              </div>
              <input
                type="text"
                placeholder="Category name"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateCategory()}
               
                style={{
                  padding: "8px 10px",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  fontSize: "14px",
                  outline: "none",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <label style={{ fontSize: "13px", color: "var(--gray-500)" }} htmlFor={"projects-color"}>Color</label>
                <input
                  type="color"
                  value={newCatColor}
                  onChange={(e) => setNewCatColor(e.target.value)}
                  style={{ width: "36px", height: "30px", border: "none", cursor: "pointer", borderRadius: "4px" }} id={"projects-color"}
                />
                <span style={{ fontSize: "13px", color: "var(--gray-500)" }}>{newCatColor}</span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={handleCreateCategory}
                  disabled={catSaving || !newCatName.trim()}
                  style={{
                    padding: "7px 16px",
                    background: "var(--brand-500)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: "13px",
                    opacity: catSaving || !newCatName.trim() ? 0.6 : 1,
                  }}
                >
                  {catSaving ? "Creating..." : "Create & Select"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowNewCat(false); setNewCatName(""); }}
                  style={{
                    padding: "7px 12px",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "13px",
                    color: "var(--gray-500)",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="form-group">
          <label htmlFor={"projects-link-to-goal-optional"}>Link to Goal (optional)</label>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <select
              value={form.linkedGoalId}
              onChange={(e) => set("linkedGoalId", e.target.value)}
              style={{ flex: 1 }} id={"projects-link-to-goal-optional"}
            >
              <option value="">-- No Goal --</option>
              {localGoals.map((g) => (
                <option key={g.id} value={g.id}>
                  🎯 {g.title} ({g.progress || 0}%)
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowNewGoal((v) => !v)}
              title="Create a new goal"
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                background: showNewGoal ? "var(--success)" : "var(--gray-50)",
                color: showNewGoal ? "#fff" : "var(--success)",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: "16px",
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              +
            </button>
          </div>

          {showNewGoal && (
            <div style={{
              marginTop: "10px",
              padding: "14px",
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: "8px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--gray-700)" }}>
                🎯 New Goal
              </div>
              <input
                type="text"
                placeholder="Goal title"
                value={newGoalTitle}
                onChange={(e) => setNewGoalTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateGoal()}
               
                style={{
                  padding: "8px 10px",
                  border: "1px solid #d1fae5",
                  borderRadius: "6px",
                  fontSize: "14px",
                  outline: "none",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <label style={{ fontSize: "13px", color: "var(--gray-500)" }} htmlFor={"projects-status"}>Status</label>
                <select
                  value={newGoalStatus}
                  onChange={(e) => setNewGoalStatus(e.target.value)}
                  style={{ padding: "5px 8px", borderRadius: "6px", border: "1px solid #d1fae5", fontSize: "13px" }} id={"projects-status"}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="DRAFT">Draft</option>
                  <option value="ON_HOLD">On Hold</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={handleCreateGoal}
                  disabled={goalSaving || !newGoalTitle.trim()}
                  style={{
                    padding: "7px 16px",
                    background: "var(--success)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: "13px",
                    opacity: goalSaving || !newGoalTitle.trim() ? 0.6 : 1,
                  }}
                >
                  {goalSaving ? "Creating..." : "Create & Link"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowNewGoal(false); setNewGoalTitle(""); }}
                  style={{
                    padding: "7px 12px",
                    background: "transparent",
                    border: "1px solid #d1fae5",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "13px",
                    color: "var(--gray-500)",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="form-group">
          <label htmlFor={"projects-due-date"}>Due Date</label>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <DateTimePicker
              value={form.dueDate}
              onChange={(val) => set("dueDate", val)}
              disabled={form.noDate || false}
            />
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                whiteSpace: "nowrap",
                width: "auto",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={form.noDate || false}
                style={{ width: "auto" }}
                onChange={(e) => {
                  set("noDate", e.target.checked);
                  if (e.target.checked) set("dueDate", "");
                }} id={"projects-due-date"}
              />
              No date
            </label>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor={"projects-status-2"}>Status</label>
          <select
            value={form.status}
            onChange={(e) => set("status", e.target.value)} id={"projects-status-2"}
          >
            {STATUS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <span id="projects-color-label" className="field-label">Color</span>
          <div className="color-picker" role="radiogroup" aria-labelledby="projects-color-label">
            {COLORS.map((c) => (
              <div
                key={c}
                className={`color-dot ${form.color === c ? "selected" : ""}`}
                style={{ background: c }}
                onClick={() => set("color", c)} role="radio" aria-checked={form.color===c} tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => set("color", c))?.(e); } }}
              />
            ))}
          </div>
        </div>
        <CustomFieldValues
          entityType="PROJECT"
          values={form.customFieldValues || {}}
          onChange={(vals) => set("customFieldValues", vals)}
        />
        {/* Project type, template flag, capacity */}
        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"projects-project-type"}>Project Type</label>
            <select value={form.projectType||"DEFAULT"} onChange={e=>set("projectType",e.target.value)} id={"projects-project-type"}>
              {["DEFAULT","SCRUM","KANBAN","WATERFALL","CUSTOM"].map(t=>(
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          {form.projectType==="CUSTOM" && (
            <div className="form-group" style={{flex:2}}>
              <label htmlFor={"projects-custom-type-name"}>Custom Type Name</label>
              <input value={form.customType||""} onChange={e=>set("customType",e.target.value)}
                placeholder="e.g. Design Sprint, Client Engagement" id={"projects-custom-type-name"} />
            </div>
          )}
          <div className="form-group">
            <label htmlFor={"projects-team-capacity-pts-sprint"}>Team Capacity (pts/sprint)</label>
            <input type="number" value={form.teamCapacityPoints||""} min={1}
              onChange={e=>set("teamCapacityPoints",e.target.value?Number(e.target.value):null)}
              placeholder="e.g. 40" id={"projects-team-capacity-pts-sprint"} />
          </div>
        </div>
        <label style={{
          display:"flex", alignItems:"center", gap:"8px",
          fontSize:"13px", color:"var(--gray-700)",
          cursor:"pointer", marginBottom:"12px",
          padding:"8px 10px",
          background:"var(--gray-50,var(--gray-50))",
          border:"1px solid var(--border,var(--border))",
          borderRadius:"8px",
        }}>
          <input type="checkbox" checked={form.isTemplate||false}
            onChange={e=>set("isTemplate",e.target.checked)}
            style={{ width:15, height:15, cursor:"pointer", flexShrink:0, margin:0 }} />
          <span style={{ lineHeight:1.4 }}>Save as reusable project template</span>
        </label>

        {/* Integrations */}
        {initial?.id && (
          <IntegrationPanel entity={{ type:"project", id:initial.id, title:initial.name }} />
        )}
        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary"
            disabled={saving}
            onClick={async () => {
              if (saving) return;
              setSaving(true);
              try { await onSave(form); }
              finally { setSaving(false); }
            }}
          >
            {saving ? "⏳ Saving..." : initial?.id ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SubProjectCard({
  sub,
  progress,
  navigate,
  onEdit,
  onDelete,
  onAddSubTask,
}) {
  const subColor = sub.color || "var(--brand-500)";
  const subPct   = progress || 0;
  return (
    <div onClick={(e) => e.stopPropagation()} style={{
      borderLeft: `3px solid ${subColor}`,
      borderRadius: "8px",
      background: "var(--gray-50,var(--gray-50))",
      border: `1px solid var(--border,var(--border))`,
      borderLeftWidth: "3px",
      borderLeftColor: subColor,
      padding: "8px 10px",
      boxSizing: "border-box",
      width: "100%",
    }} role="presentation">
      {/* Row 1: name + badge + actions */}
      <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
        {/* Left: dot + name + badge */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flex:1, minWidth:0, overflow:"hidden" }}>
          <div style={{
            width:8, height:8, borderRadius:"50%",
            background:subColor, flexShrink:0,
          }} />
          <span
            onClick={(e) => { e.stopPropagation(); navigate(`/tasks?projectId=${sub.id}`); }}
            style={{
              fontSize:12, fontWeight:600,
              color:"var(--gray-800,var(--gray-800))",
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
              flex:1, minWidth:0, cursor:"pointer",
            }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ((e) => { e.stopPropagation(); navigate(`/tasks?projectId=${sub.id}`); })?.(e); } }}>{sub.name}</span>
          <StatusPill status={sub.status || "ACTIVE"} className="pj-sub-pill" />
        </div>
        {/* Right: action buttons */}
        <div style={{ display:"flex", alignItems:"center", gap:2, flexShrink:0 }}>
          <button title="Add task" aria-label={`Add a task to ${sub.name}`} className="pj-sub-icon" onClick={(e) => { e.stopPropagation(); onAddSubTask(sub); }} style={{
            width:26, height:26, border:"none", background:"transparent",
            borderRadius:6, cursor:"pointer", fontSize:13,
            display:"flex", alignItems:"center", justifyContent:"center",
            opacity:0.6, flexShrink:0,
          }}><Plus size={14} aria-hidden="true" /></button>
          <button title="Edit" aria-label={`Edit ${sub.name}`} className="pj-sub-icon" onClick={(e) => { e.stopPropagation(); onEdit(sub); }} style={{
            width:26, height:26, border:"none", background:"transparent",
            borderRadius:6, cursor:"pointer", fontSize:13,
            display:"flex", alignItems:"center", justifyContent:"center",
            opacity:0.6, flexShrink:0,
          }}><Pencil size={14} aria-hidden="true" /></button>
          <button title="Delete" aria-label={`Delete ${sub.name}`} className="pj-sub-icon" onClick={(e) => { e.stopPropagation(); onDelete(sub.id); }} style={{
            width:26, height:26, border:"none", background:"transparent",
            borderRadius:6, cursor:"pointer", fontSize:13,
            display:"flex", alignItems:"center", justifyContent:"center",
            opacity:0.6, flexShrink:0,
          }}><Trash2 size={14} aria-hidden="true" /></button>
          <button onClick={(e) => { e.stopPropagation(); navigate(`/tasks?projectId=${sub.id}`); }} style={{
            flexShrink:0, fontSize:10, fontWeight:700, padding:"2px 8px",
            border:`1px solid ${subColor}`, borderRadius:6, background:"transparent",
            color:subColor, cursor:"pointer", whiteSpace:"nowrap",
          }}>Tasks →</button>
        </div>
      </div>
      {/* Progress bar */}
      <div style={{ height:3, background:"var(--gray-100,var(--gray-100))", borderRadius:99, overflow:"hidden", margin:"6px 0 3px" }}>
        <div style={{ height:"100%", width:`${subPct}%`, background:subColor, borderRadius:99, transition:"width 0.4s" }} />
      </div>
      {/* Footer */}
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"var(--gray-400)" }}>
        <span>{sub.dueDate ? `Due ${formatDate(sub.dueDate)}` : "No due date"}</span>
        <span>{subPct}% complete</span>
      </div>
    </div>
  );
}

// ── Project-scoped meeting history ───────────────────────────
// Surfaces the notes/summary carried in each meeting that discussed this
// project — the backend (GET /meetings/project/{id}) already supported
// this, it just had no UI consumer anywhere until now. Answers "what was
// said about this project across meetings" directly from the project card,
// instead of hunting through the Meetings page.
function ProjectMeetingsPanel({ projectId, navigate }) {
  const [meetings, setMeetings] = useState(null); // null = loading
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMeetingsForProject(projectId)
      .then(r => { if (!cancelled) setMeetings(r.data?.items || r.data?.content || r.data || []); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [projectId]);

  return (
    <div className="entity-activity-panel">
      <div className="entity-activity-panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Project meetings</span>
        <button
          className="btn-secondary"
          style={{ fontSize: "11px", padding: "4px 10px" }}
          onClick={(e) => { e.stopPropagation(); navigate(`/meetings?projectId=${projectId}`); }}
        >
          + New meeting for this project
        </button>
      </div>
      {meetings === null && !error && <p className="empty-state" style={{ fontSize: "12px" }}>Loading…</p>}
      {error && <p className="empty-state" style={{ fontSize: "12px" }}>Couldn't load meetings for this project.</p>}
      {meetings && meetings.length === 0 && (
        <p className="empty-state" style={{ fontSize: "12px" }}>
          No meetings have discussed this project yet.
        </p>
      )}
      {meetings && meetings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {meetings.slice(0, 5).map(m => {
            const pd = m.projectDiscussions?.find(d => d.projectId === projectId);
            return (
              <div key={m.id} className="pending-invite-row" style={{ cursor: "pointer" }} role="link" tabIndex={0}
                onClick={(e) => { e.stopPropagation(); navigate(`/meetings?open=${m.id}`); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); navigate(`/meetings?open=${m.id}`); } }}>
                <div className="pending-invite-info">
                  <div className="pending-invite-email">{m.title}</div>
                  <div className="pending-invite-meta">
                    {m.meetingDate ? new Date(m.meetingDate).toLocaleDateString() : "—"}
                    {pd?.statusSnapshot && <> · {pd.statusSnapshot.replace("_", " ")}</>}
                    {pd?.discussionNotes && <> · {pd.discussionNotes.slice(0, 80)}{pd.discussionNotes.length > 80 ? "…" : ""}</>}
                  </div>
                </div>
              </div>
            );
          })}
          {meetings.length > 5 && (
            <button className="btn-secondary" style={{ fontSize: "11px", alignSelf: "flex-start" }}
              onClick={(e) => { e.stopPropagation(); navigate(`/meetings?projectId=${projectId}`); }}>
              View all {meetings.length} meetings →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Everything you can do to one project ─────────────────────
// Shared by the card and the list row so both offer exactly the same
// actions (the old card's icon buttons, now named, in one ⋯ menu).
function useProjectActions(p, { navigate, onEdit, onDelete, onAddSub }) {
  const [showActivity, setShowActivity] = useState(false);
  const [showMeetings, setShowMeetings] = useState(false);
  const [showAccess, setShowAccess] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [teamSaved, setTeamSaved] = useState(null);
  const { enabled: accessEnabled, can } = useAccess();
  const team = teamSaved || p;

  const items = [
    { label: "Edit project", icon: Pencil, onSelect: () => onEdit(p) },
    { label: "Open tasks", icon: ListChecks, onSelect: () => navigate(`/tasks?projectId=${p.id}`) },
    { label: "Team", icon: Users, onSelect: () => setShowTeam(true) },
    { label: "Add sub-project", icon: FolderPlus, onSelect: () => onAddSub(p) },
    "divider",
    { label: showActivity ? "Hide activity" : "Activity", icon: History, onSelect: () => setShowActivity(a => !a) },
    { label: showMeetings ? "Hide meetings" : "Meetings", icon: CalendarDays, onSelect: () => setShowMeetings(m => !m) },
    { label: "Analyse a meeting", icon: Bot, hidden: !can("USE_MEETING_ASSISTANT"),
      onSelect: () => navigate(`/meeting-assistant?project=${encodeURIComponent(p.id)}`) },
    { label: "Who can see this", icon: Lock, hidden: !accessEnabled, onSelect: () => setShowAccess(true) },
    "divider",
    { label: "Clone", icon: Copy, onSelect: async () => {
      const name = prompt("Name for the cloned project:", p.name + " (Copy)");
      if (!name) return;
      await import("../api/client").then(m => m.default.post(`/projects/${p.id}/clone`, { name }));
      window.location.reload();
    } },
    { label: p.archived ? "Unarchive" : "Archive", icon: p.archived ? ArchiveRestore : Archive, onSelect: async () => {
      await import("../api/client").then(m => m.default.patch(`/projects/${p.id}`,
        { archived: !p.archived, status: !p.archived ? "PAUSED" : p.status }));
      window.location.reload();
    } },
    { label: "Delete", icon: Trash2, danger: true, onSelect: () => onDelete(p.id) },
  ];

  const anyModal = showAccess || showTeam;
  const modals = anyModal && createPortal(
    <>
      {showAccess && (
        <ProjectAccessModal project={p} onClose={() => setShowAccess(false)} onSaved={() => window.location.reload()} />
      )}
      {showTeam && (
        <ProjectTeamModal project={team} onClose={() => setShowTeam(false)} onSaved={(saved) => saved && setTeamSaved(saved)} />
      )}
    </>,
    document.body,
  );

  const panels = (
    <>
      {showActivity && (
        <div className="entity-activity-panel">
          <div className="entity-activity-panel-title">Project activity</div>
          <EntityActivityTab entityType="project" entityId={p.id} />
        </div>
      )}
      {showMeetings && <ProjectMeetingsPanel projectId={p.id} navigate={navigate} />}
    </>
  );

  return { items, modals, panels, team, openTeam: () => setShowTeam(true), hasPanel: showActivity || showMeetings };
}

function highlightProps(p, highlightId, highlightColor) {
  if (highlightId !== p.id) return {};
  return {
    ref: (el) => el?.scrollIntoView({ behavior: "smooth", block: "center" }),
    style: {
      "--highlight-color": `#${highlightColor}`,
      "--highlight-bg": `#${highlightColor}11`,
      "--highlight-shadow": `rgba(${parseInt(highlightColor.slice(0, 2), 16)},${parseInt(highlightColor.slice(2, 4), 16)},${parseInt(highlightColor.slice(4, 6), 16)},0.2)`,
    },
  };
}

function DueText({ p }) {
  const late = isOverdue(p);
  return (
    <span className={"pj-due" + (late ? " pj-due--late" : "")} title={p.dueDate ? formatDate(p.dueDate) : undefined}>
      {late && <AlertTriangle size={13} aria-hidden="true" />}
      {dueLabel(p)}
    </span>
  );
}

function ProgressBar({ value, color, name }) {
  const pct = Math.max(0, Math.min(100, Math.round(value || 0)));
  return (
    <div className="pj-progress">
      <div className="pj-progress-track" role="progressbar" aria-label={`${name} progress`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="pj-progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="pj-progress-num">{pct}%</span>
    </div>
  );
}

function TeamLine({ emails, onOpen, projectName, max = 4 }) {
  const { byEmail } = usePeople();
  const first = (e) => (byEmail.get(String(e).toLowerCase())?.name || String(e).split("@")[0]).split(" ")[0];
  const names = emails.length > 2
    ? `${first(emails[0])}, ${first(emails[1])} +${emails.length - 2}`
    : emails.map(first).join(" & ");
  return (
    <div className="pj-team">
      {emails.length > 0 ? (
        <>
          <div className="pj-team-stack" aria-label={`${emails.length} people on ${projectName}`}>
            {emails.slice(0, max).map((e) => <PersonAvatar key={e} email={e} size={26} />)}
            {emails.length > max && (
              <button type="button" className="project-team-more" onClick={(ev) => { ev.stopPropagation(); onOpen(); }}>
                +{emails.length - max}
              </button>
            )}
          </div>
          <span className="pj-team-names">{names}</span>
        </>
      ) : (
        <span className="pj-team-names pj-team-empty">No team yet</span>
      )}
      <button type="button" className="pj-team-btn" onClick={(ev) => { ev.stopPropagation(); onOpen(); }}>
        {emails.length ? "Team" : "Add team"}
      </button>
    </div>
  );
}

function SubProjects({ subProjects, subProgress, navigate, onEditSub, onDeleteSub, onAddSubTask }) {
  const [expanded, setExpanded] = useState(false);
  if (!subProjects.length) return null;
  return (
    <>
      <button type="button" className="pj-subtoggle" aria-expanded={expanded} onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}>
        <ChevronRight size={14} className={expanded ? "open" : ""} aria-hidden="true" />
        {subProjects.length} sub-project{subProjects.length > 1 ? "s" : ""}
      </button>
      {expanded && (
        <div className="sub-projects-container" onClick={(e) => e.stopPropagation()} role="presentation">
          {subProjects.map((sub) => (
            <SubProjectCard
              key={sub.id}
              sub={sub}
              progress={subProgress[sub.id]}
              navigate={navigate}
              onEdit={onEditSub}
              onDelete={onDeleteSub}
              onAddSubTask={onAddSubTask}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ProjectMeta({ p, cat }) {
  if (!cat && !p.linkedGoalId && !p.archived) return null;
  return (
    <div className="pj-meta">
      {cat && <span className="pj-chip"><span className="pj-chip-dot" style={{ background: cat.color }} aria-hidden="true" />{cat.name}</span>}
      {p.linkedGoalId && <span className="pj-chip"><Target size={12} aria-hidden="true" />Linked to goal</span>}
      {p.archived && <span className="pj-chip"><Archive size={12} aria-hidden="true" />Archived</span>}
    </div>
  );
}

function ProjectCard({
  p, cat, progress, subProjects, subProgress, navigate, highlightId, highlightColor,
  onEdit, onDelete, onAddSub, onEditSub, onDeleteSub, onAddSubTask,
}) {
  const { items, modals, panels, team, openTeam } = useProjectActions(p, { navigate, onEdit, onDelete, onAddSub });
  const color = p.color || "var(--brand-500)";
  return (
    <article
      className={`pj-card ${highlightId === p.id ? "task-row-highlight" : ""}`}
      {...highlightProps(p, highlightId, highlightColor)}
    >
      <div className="pj-card-top">
        <StatusPill status={p.status} />
        <span className="pj-spacer" />
        <DueText p={p} />
        <ActionMenu items={items} label={`More actions for ${p.name}`} />
      </div>
      <div>
        <h3 className="pj-name">
          <span className="pj-swatch" style={{ background: color }} aria-hidden="true" />
          <button type="button" className="pj-name-link" title={p.name} onClick={() => navigate(`/tasks?projectId=${p.id}`)}>{p.name}</button>
        </h3>
        <p className="pj-desc">{p.description || <span className="pj-desc-none">No description</span>}</p>
        <ProjectMeta p={p} cat={cat} />
      </div>
      <ProgressBar value={progress} color={color} name={p.name} />
      <TeamLine emails={team.memberEmails || []} onOpen={openTeam} projectName={p.name} />
      <SubProjects subProjects={subProjects} subProgress={subProgress} navigate={navigate}
        onEditSub={onEditSub} onDeleteSub={onDeleteSub} onAddSubTask={onAddSubTask} />
      {panels}
      {modals}
    </article>
  );
}

function ProjectRow({
  p, cat, progress, subProjects, subProgress, navigate, highlightId, highlightColor,
  onEdit, onDelete, onAddSub, onEditSub, onDeleteSub, onAddSubTask,
}) {
  const { items, modals, panels, team, openTeam, hasPanel } = useProjectActions(p, { navigate, onEdit, onDelete, onAddSub });
  const color = p.color || "var(--brand-500)";
  const emails = team.memberEmails || [];
  return (
    <>
      <tr className={`pj-row ${highlightId === p.id ? "task-row-highlight" : ""}`} {...highlightProps(p, highlightId, highlightColor)}>
        <td>
          <div className="pj-cell-name">
            <span className="pj-swatch" style={{ background: color }} aria-hidden="true" />
            <div className="pj-cell-name-text">
              <button type="button" className="pj-name-link" onClick={() => navigate(`/tasks?projectId=${p.id}`)}>{p.name}</button>
              {(p.description || cat) && <span className="pj-cell-sub">{[cat?.name, p.description].filter(Boolean).join(" · ")}</span>}
            </div>
          </div>
        </td>
        <td><StatusPill status={p.status} /></td>
        <td><DueText p={p} /></td>
        <td className="pj-cell-progress"><ProgressBar value={progress} color={color} name={p.name} /></td>
        <td>
          {emails.length ? (
            <button type="button" className="pj-row-team" onClick={openTeam} aria-label={`Team for ${p.name}: ${emails.length} people`}>
              <span className="pj-team-stack">
                {emails.slice(0, 3).map((e) => <PersonAvatar key={e} email={e} size={24} />)}
              </span>
              {emails.length > 3 && <span className="pj-row-more">+{emails.length - 3}</span>}
            </button>
          ) : (
            <button type="button" className="pj-team-btn" onClick={openTeam}>Add team</button>
          )}
        </td>
        <td className="pj-cell-actions"><ActionMenu items={items} label={`More actions for ${p.name}`} />{modals}</td>
      </tr>
      {(hasPanel || subProjects.length > 0) && (
        <tr className="pj-row-extra">
          <td colSpan={6}>
            <SubProjects subProjects={subProjects} subProgress={subProgress} navigate={navigate}
              onEditSub={onEditSub} onDeleteSub={onDeleteSub} onAddSubTask={onAddSubTask} />
            {panels}
          </td>
        </tr>
      )}
    </>
  );
}

const VIEW_KEY = "projects.view";
function readView() {
  try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "cards"; } catch { return "cards"; }
}

export default function Projects() {
  const { activeWorkspace } = useAuth();
  const { show: showToast } = useToast();
  const confirm = useConfirm();
  const [projects, setProjects] = useState([]);
  const [categories, setCategories] = useState([]);
  const [progress, setProgress] = useState({});
  const [subProjectsMap, setSubProjectsMap] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [parentForNew, setParentForNew] = useState(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const highlightColor = searchParams.get("hcolor") || "ef4444";
  const [goals, setGoals] = useState([]);
  const [filterCategory, setFilterCategory] = useState(
    searchParams.get("categoryId") || "",
  );
  const [query, setQuery] = useState("");
  const [view, setViewState] = useState(readView);
  const [loaded, setLoaded] = useState(false);
  const setView = (v) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };

  const load = async () => {
    const [projRes, catRes, goalRes] = await Promise.all([
      getProjects({ size: 200 }),
      getCategories(),
      getGoals().catch(() => ({ data: [] })),   // department access has no goals area
    ]);
    setProjects(unwrapList(projRes));
    setCategories(unwrapList(catRes));
    setGoals(unwrapList(goalRes));

    const progressMap = {};
    const subMap = {};

    const allProjects = unwrapList(projRes);
    for (const p of allProjects) {
      try {
        const pr = await getProjectProgress(p.id);
        progressMap[p.id] = pr.data?.progress ?? 0;
      } catch { progressMap[p.id] = 0; }
      if (!p.parentProjectId) {
        try {
          const subs = await getSubProjects(p.id);
          subMap[p.id] = unwrapList(subs);
        } catch { subMap[p.id] = []; }
      }
    }
    setProgress(progressMap);
    setSubProjectsMap(subMap);
  };

  useEffect(() => {
    const fetchData = async () => {
      const [projRes, catRes, goalRes] = await Promise.all([
        getProjects({ size: 200 }),
        getCategories({ size: 200 }),
        getGoals().catch(() => ({ data: [] })),   // department access has no goals area
      ]);
      const allProjects = unwrapList(projRes);
      setProjects(allProjects);
      setCategories(unwrapList(catRes));
      setGoals(unwrapList(goalRes));
      setLoaded(true);

      const progressMap = {};
      const subMap = {};
      for (const p of allProjects) {
        try {
          const pr = await getProjectProgress(p.id);
          progressMap[p.id] = pr.data?.progress ?? 0;
        } catch { progressMap[p.id] = 0; }
        if (!p.parentProjectId) {
          try {
            const subs = await getSubProjects(p.id);
            subMap[p.id] = unwrapList(subs);
          } catch { subMap[p.id] = []; }
        }
      }
      setProgress(progressMap);
      setSubProjectsMap(subMap);
    };
    fetchData().catch(() => setLoaded(true));
  }, [activeWorkspace?.id]);

  const handleSave = async (form) => {
    try {
      const payload = {
        ...form,
        dueDate:          form.dueDate          ? new Date(form.dueDate).toISOString() : null,
        parentProjectId:  form.parentProjectId  || null,
        categoryId:       form.categoryId       || null,
        linkedGoalId:     form.linkedGoalId     || null,
        customFieldValues: form.customFieldValues || {},
      };
      if (editing) await updateProject(editing.id, payload);
      else await createProject(payload);
      setShowForm(false);
      setEditing(null);
      setParentForNew(null);
      load();
    } catch (err) {
      showToast(err.response?.data?.message || "Error saving project", "error");
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({ title: "Delete this project?", message: "Sub-projects will also be deleted. This cannot be undone.", danger: true, confirmText: "Delete Project" });
    if (ok) {
      // Optimistic: remove from projects list AND from subProjectsMap
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setSubProjectsMap((prev) => {
        const updated = { ...prev };
        // Remove if it was a root project key
        delete updated[id];
        // Remove it from any parent's sub-list
        Object.keys(updated).forEach((parentId) => {
          updated[parentId] = updated[parentId].filter((s) => s.id !== id);
        });
        return updated;
      });
      try {
        await deleteProject(id);
        showToast("Project deleted successfully", "success");
      } catch (err) {
        // Revert on failure — reload fresh from server
        load();
        const errMsg = apiErrorMessage(
          err,
          (typeof err.response?.data === "string" ? err.response.data : null) ||
            err.message ||
            "Failed to delete project"
        );
        showToast(errMsg, "error");
      }
    }
  };

  const handleExportCSV = () => {
    const data = filtered.map((p) => ({
      Name: p.name,
      Status: p.status,
      Category: getCategoryById(p.categoryId)?.name || "None",
      Progress: `${progress[p.id] || 0}%`,
      DueDate: p.dueDate ? formatDate(p.dueDate) : "None",
      Description: p.description || "",
    }));
    exportToCSV(data, "projects");
  };

  const handleExportPDF = () => {
    const columns = ["Name", "Status", "Category", "Progress", "Due Date"];
    const rows = filtered.map((p) => [
      p.name,
      p.status,
      getCategoryById(p.categoryId)?.name || "None",
      `${progress[p.id] || 0}%`,
      p.dueDate ? formatDate(p.dueDate) : "None",
    ]);
    exportToPDF("Projects Report", columns, rows, "projects");
  };

  const getCategoryById = (id) => categories.find((c) => c.id === id);
  // Show all projects - only exclude sub-projects that are ALREADY shown
  // inside an expanded parent card to avoid duplicates
  const shownAsSubIds = new Set(
    Object.values(subProjectsMap).flat().map(s => s.id)
  );
  const rootProjects = projects.filter(p => !shownAsSubIds.has(p.id));
  const q = query.trim().toLowerCase();
  const filtered = rootProjects
    .filter((p) => !filterCategory || p.categoryId === filterCategory)
    .filter((p) => !q || `${p.name ?? ""} ${p.description ?? ""}`.toLowerCase().includes(q));
  const sections = groupProjects(filtered);
  const summary = projectSummary(filtered);

  const openAddSub = (parentProject) => {
    setParentForNew(parentProject);
    setEditing(null);
    setShowForm(true);
  };

  const openAddSubTask = (subProject) => {
    navigate(`/tasks?projectId=${subProject.id}&newTask=true`);
  };

  const getInitialForForm = () => {
    if (editing) return editing;
    if (parentForNew)
      return {
        name: "",
        description: "",
        color: parentForNew.color || "var(--brand-500)",
        status: "ACTIVE",
        dueDate: "",
        categoryId: parentForNew.categoryId || "",
        parentProjectId: parentForNew.id,
      };
    return null;
  };

  const itemProps = (p) => ({
    p,
    cat: getCategoryById(p.categoryId),
    progress: progress[p.id],
    subProjects: subProjectsMap[p.id] || [],
    subProgress: progress,
    navigate,
    highlightId,
    highlightColor,
    onEdit: (proj) => { setEditing(proj); setParentForNew(null); setShowForm(true); },
    onDelete: handleDelete,
    onAddSub: openAddSub,
    // Only called from the explicit edit button inside SubProjectCard
    onEditSub: (proj) => { setEditing(proj); setParentForNew(null); setShowForm(true); },
    onDeleteSub: handleDelete,
    onAddSubTask: openAddSubTask,
  });

  const countText = `${filtered.length} ${filtered.length === 1 ? "project" : "projects"}`;
  const stats = [
    { key: "motion", label: "in motion", value: summary.motion },
    { key: "notstarted", label: "not started", value: summary.notstarted },
    { key: "paused", label: "paused", value: summary.paused },
    { key: "done", label: "done", value: summary.done },
  ].filter(s => s.value > 0 || s.key === "motion");

  return (
    <div className="pj-page">
      <header className="pg-title-row">
        <div className="pg-title-text">
          <h1>Projects</h1>
          <p>{loaded ? `${countText}${filtered.length > 1 ? ", soonest due first" : ""}.` : "Loading projects…"}</p>
        </div>
        <div className="pg-title-actions">
          <label className="pg-find">
            <Search size={14} aria-hidden="true" />
            <input type="search" placeholder="Find a project" aria-label="Find a project" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {categories.length > 0 && (
            <select className="pg-select" aria-label="Filter by category" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <div className="pg-seg" role="group" aria-label="Layout">
            <button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")}><LayoutGrid size={14} aria-hidden="true" />Cards</button>
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={14} aria-hidden="true" />List</button>
          </div>
          <ActionMenu label="Export" className="btn-secondary pg-btn" items={[
            { label: "CSV spreadsheet", icon: FileSpreadsheet, onSelect: handleExportCSV },
            { label: "PDF report", icon: FileText, onSelect: handleExportPDF },
          ]}>
            <Download size={14} aria-hidden="true" />Export
          </ActionMenu>
          <button
            type="button"
            className="btn-primary pg-btn"
            onClick={() => { setEditing(null); setParentForNew(null); setShowForm(true); }}
          >
            <Plus size={15} aria-hidden="true" />New project
          </button>
        </div>
      </header>

      {filtered.length > 0 && (
        <div className="pg-summary" aria-label="Summary">
          {stats.map(s => (
            <div key={s.key} className="pg-stat"><span className="pg-stat-num">{s.value}</span><span className="pg-stat-label">{s.label}</span></div>
          ))}
          <div className={"pg-stat" + (summary.overdue ? " pg-stat--late" : "")}>
            <span className="pg-stat-num">{summary.overdue}</span>
            <span className="pg-stat-label">past {summary.overdue === 1 ? "its" : "their"} due date</span>
          </div>
        </div>
      )}

      {loaded && filtered.length === 0 && (
        <div className="pg-empty">
          {rootProjects.length === 0 ? (
            <>
              <h2>No projects yet</h2>
              <p>Projects hold your tasks, team and timeline. Create the first one to get started.</p>
              <button type="button" className="btn-primary pg-btn" onClick={() => { setEditing(null); setParentForNew(null); setShowForm(true); }}>
                <Plus size={15} aria-hidden="true" />New project
              </button>
            </>
          ) : (
            <>
              <h2>No projects match</h2>
              <p>Nothing matches {q ? `“${query.trim()}”` : "this filter"}.</p>
              <button type="button" className="btn-secondary pg-btn" onClick={() => { setQuery(""); setFilterCategory(""); }}>Clear filters</button>
            </>
          )}
        </div>
      )}

      {view === "cards" ? (
        sections.map(sec => (
          <section key={sec.key} className="pj-section" aria-label={sec.label}>
            <h2 className="pg-section-title">{sec.label} <span>· {sec.projects.length}</span></h2>
            <div className="pj-grid">
              {sec.projects.map((p) => <ProjectCard key={p.id} {...itemProps(p)} />)}
            </div>
          </section>
        ))
      ) : filtered.length > 0 && (
        <div className="pj-table-wrap">
          <table className="pj-table">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Status</th>
                <th scope="col">Due</th>
                <th scope="col">Progress</th>
                <th scope="col">Team</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            {sections.map(sec => (
              <tbody key={sec.key}>
                <tr className="pj-table-group"><th scope="rowgroup" colSpan={6}>{sec.label} <span>· {sec.projects.length}</span></th></tr>
                {sec.projects.map((p) => <ProjectRow key={p.id} {...itemProps(p)} />)}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {showForm && (
        <ProjectForm
          initial={getInitialForForm()}
          categories={categories}
          projects={projects}
          goals={goals}
          onSave={handleSave}
          onCategoryCreated={(cat) => setCategories(prev => [...prev, cat])}
          onGoalCreated={(goal) => setGoals(prev => [...prev, goal])}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
            setParentForNew(null);
          }}
        />
      )}
    </div>
  );
}
