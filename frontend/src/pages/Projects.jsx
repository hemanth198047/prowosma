import { useState, useEffect } from "react";
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
import PageHeader from "../components/PageHeader";
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

const COLORS = [
  "#6366f1",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#3b82f6",
  "#8b5cf6",
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
  const [form, setForm] = useState(
    initial || {
      name: "",
      description: "",
      color: "#6366f1",
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
  const [newCatColor, setNewCatColor] = useState("#6366f1");
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
      setNewCatColor("#6366f1");
      setShowNewCat(false);
    } catch (e) {
      const msg = apiErrorMessage(e, e.message);
      alert("Failed to create category: " + msg);
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
      alert("Failed to create goal: " + msg);
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
                border: "1px solid #e2e8f0",
                background: showNewCat ? "#6366f1" : "#f8fafc",
                color: showNewCat ? "#fff" : "#6366f1",
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
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>
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
                  border: "1px solid #e2e8f0",
                  borderRadius: "6px",
                  fontSize: "14px",
                  outline: "none",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <label style={{ fontSize: "13px", color: "#6b7280" }} htmlFor={"projects-color"}>Color</label>
                <input
                  type="color"
                  value={newCatColor}
                  onChange={(e) => setNewCatColor(e.target.value)}
                  style={{ width: "36px", height: "30px", border: "none", cursor: "pointer", borderRadius: "4px" }} id={"projects-color"}
                />
                <span style={{ fontSize: "13px", color: "#6b7280" }}>{newCatColor}</span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={handleCreateCategory}
                  disabled={catSaving || !newCatName.trim()}
                  style={{
                    padding: "7px 16px",
                    background: "#6366f1",
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
                    border: "1px solid #e2e8f0",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "13px",
                    color: "#6b7280",
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
                border: "1px solid #e2e8f0",
                background: showNewGoal ? "#10b981" : "#f8fafc",
                color: showNewGoal ? "#fff" : "#10b981",
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
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>
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
                <label style={{ fontSize: "13px", color: "#6b7280" }} htmlFor={"projects-status"}>Status</label>
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
                    background: "#10b981",
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
                    color: "#6b7280",
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
          background:"var(--gray-50,#f8fafc)",
          border:"1px solid var(--border,#e2e8f0)",
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
  const subColor = sub.color || "#6366f1";
  const subPct   = progress || 0;
  return (
    <div onClick={(e) => e.stopPropagation()} style={{
      borderLeft: `3px solid ${subColor}`,
      borderRadius: "8px",
      background: "var(--gray-50,#f8fafc)",
      border: `1px solid var(--border,#e2e8f0)`,
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
              color:"var(--gray-800,#1e293b)",
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
              flex:1, minWidth:0, cursor:"pointer",
            }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ((e) => { e.stopPropagation(); navigate(`/tasks?projectId=${sub.id}`); })?.(e); } }}>{sub.name}</span>
          <span style={{
            flexShrink:0, fontSize:"9px", fontWeight:700,
            padding:"1px 7px", borderRadius:"99px",
            background:"rgba(16,185,129,0.1)", color:"#059669",
            border:"1px solid rgba(16,185,129,0.2)", whiteSpace:"nowrap",
          }}>{sub.status || "ACTIVE"}</span>
        </div>
        {/* Right: action buttons */}
        <div style={{ display:"flex", alignItems:"center", gap:2, flexShrink:0 }}>
          <button title="Add Task" onClick={(e) => { e.stopPropagation(); onAddSubTask(sub); }} style={{
            width:26, height:26, border:"none", background:"transparent",
            borderRadius:6, cursor:"pointer", fontSize:13,
            display:"flex", alignItems:"center", justifyContent:"center",
            opacity:0.6, flexShrink:0,
          }}>➕</button>
          <button onClick={(e) => { e.stopPropagation(); onEdit(sub); }} style={{
            width:26, height:26, border:"none", background:"transparent",
            borderRadius:6, cursor:"pointer", fontSize:13,
            display:"flex", alignItems:"center", justifyContent:"center",
            opacity:0.6, flexShrink:0,
          }}>✏️</button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(sub.id); }} style={{
            width:26, height:26, border:"none", background:"transparent",
            borderRadius:6, cursor:"pointer", fontSize:13,
            display:"flex", alignItems:"center", justifyContent:"center",
            opacity:0.6, flexShrink:0,
          }}>🗑️</button>
          <button onClick={(e) => { e.stopPropagation(); navigate(`/tasks?projectId=${sub.id}`); }} style={{
            flexShrink:0, fontSize:10, fontWeight:700, padding:"2px 8px",
            border:`1px solid ${subColor}`, borderRadius:6, background:"transparent",
            color:subColor, cursor:"pointer", whiteSpace:"nowrap",
          }}>Tasks →</button>
        </div>
      </div>
      {/* Progress bar */}
      <div style={{ height:3, background:"var(--gray-100,#f1f5f9)", borderRadius:99, overflow:"hidden", margin:"6px 0 3px" }}>
        <div style={{ height:"100%", width:`${subPct}%`, background:subColor, borderRadius:99, transition:"width 0.4s" }} />
      </div>
      {/* Footer */}
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#94a3b8" }}>
        <span>{sub.dueDate ? `📅 ${formatDate(sub.dueDate)}` : "No due date"}</span>
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
        <span>📅 Project Meetings</span>
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
              <div key={m.id} className="pending-invite-row" style={{ cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); navigate(`/meetings?open=${m.id}`); }}>
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

function ProjectCard({
  p,
  cat,
  progress,
  subProjects,
  subProgress,
  navigate,
  highlightId,
  highlightColor,
  onEdit,
  onDelete,
  onAddSub,
  onEditSub,
  onDeleteSub,
  onAddSubTask,
}) {
  const [expanded, setExpanded] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [showMeetings, setShowMeetings] = useState(false);

  return (
    <div
      className={`project-card ${highlightId === p.id ? "task-row-highlight" : ""}`}
      ref={
        highlightId === p.id
          ? (el) => el?.scrollIntoView({ behavior: "smooth", block: "center" })
          : null
      }
      style={
        highlightId === p.id
          ? {
              "--highlight-color": `#${highlightColor}`,
              "--highlight-bg": `#${highlightColor}11`,
              "--highlight-shadow": `rgba(${parseInt(highlightColor.slice(0, 2), 16)},${parseInt(highlightColor.slice(2, 4), 16)},${parseInt(highlightColor.slice(4, 6), 16)},0.2)`,
            }
          : {}
      }
    >
      <div className="project-card-top">
        <div
          className="project-color-bar"
          style={{ background: p.color || "#6366f1" }}
        />
        <div className="project-card-body">
          <div className="project-card-header">
            <h3>
              <button
                type="button"
                onClick={() => navigate(`/tasks?projectId=${p.id}`)}
                style={{ font: "inherit", color: "inherit", background: "none", border: "none", padding: 0, margin: 0, cursor: "pointer", textAlign: "left" }}
              >
                {p.name}
              </button>
            </h3>
            <span className={`badge badge-${p.status?.toLowerCase()}`}>
              {p.status}
            </span>
          </div>
          {cat && (
            <div className="project-category-tag" style={{ color: cat.color }}>
              {cat.icon} {cat.name}
            </div>
          )}
          {p.linkedGoalId && (
            <div
              style={{
                fontSize: "11px",
                color: "#8b5cf6",
                marginBottom: "4px",
              }}
            >
              🎯 Linked to goal
            </div>
          )}
          <p className="project-desc">{p.description}</p>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: `${progress || 0}%`,
                background: p.color || "#6366f1",
              }}
            />
          </div>
          <div className="project-card-footer">
            <div className="project-footer-row1">
              <span className="project-progress-text">{progress || 0}% complete</span>
              <div className="project-footer-actions">
                <button
                  className="btn-icon"
                  onClick={(e) => { e.stopPropagation(); onEdit(p); }}
                  title="Edit"
                >
                  ✏️
                </button>
                <button className="btn-icon" title="Clone project"
                  onClick={async(e)=>{ e.stopPropagation();
                    const name = prompt("Name for the cloned project:", p.name+" (Copy)");
                    if (!name) return;
                    await import("../api/client").then(m=>m.default.post(`/projects/${p.id}/clone`,{name}));
                    window.location.reload();
                  }}>🔀</button>
                <button className="btn-icon" title={p.archived?"Unarchive":"Archive"}
                  onClick={async(e)=>{ e.stopPropagation();
                    await import("../api/client").then(m=>m.default.patch(`/projects/${p.id}`,
                      {archived:!p.archived,status:!p.archived?"PAUSED":p.status}));
                    window.location.reload();
                  }}>{p.archived?"📦":"🗂"}</button>
                <button
                  className="btn-icon"
                  onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
                  title="Delete"
                >
                  🗑️
                </button>
              </div>
            </div>
            <div className="project-footer-row2">
              {subProjects.length > 0 && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: "11px", padding: "4px 10px" }}
                  onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
                >
                  {expanded ? "▲" : "▼"} {subProjects.length} Sub-project
                  {subProjects.length > 1 ? "s" : ""}
                </button>
              )}
              <button
                className="btn-secondary"
                style={{ fontSize: "11px", padding: "4px 10px" }}
                onClick={(e) => { e.stopPropagation(); onAddSub(p); }}
              >
                + Sub-project
              </button>
              <button
                className={`btn-secondary ${showActivity ? "btn-active" : ""}`}
                style={{ fontSize: "11px", padding: "4px 10px" }}
                onClick={(e) => { e.stopPropagation(); setShowActivity(a => !a); }}
              >
                📋 Activity
              </button>
              <button
                className={`btn-secondary ${showMeetings ? "btn-active" : ""}`}
                style={{ fontSize: "11px", padding: "4px 10px" }}
                onClick={(e) => { e.stopPropagation(); setShowMeetings(m => !m); }}
              >
                📅 Meetings
              </button>
            </div>
          </div>

          {/* Sub-projects */}
          {expanded && subProjects.length > 0 && (
            <div className="sub-projects-container" onClick={(e) => e.stopPropagation()} role="presentation">
              <div className="sub-projects-label">Sub-projects</div>
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
          {showActivity && (
            <div className="entity-activity-panel">
              <div className="entity-activity-panel-title">📋 Project Activity</div>
              <EntityActivityTab entityType="project" entityId={p.id} />
            </div>
          )}
          {showMeetings && (
            <ProjectMeetingsPanel projectId={p.id} navigate={navigate} />
          )}
        </div>
      </div>
    </div>
  );
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

  const load = async () => {
    const [projRes, catRes, goalRes] = await Promise.all([
      getProjects({ size: 200 }),
      getCategories(),
      getGoals(),
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
        getGoals(),
      ]);
      const allProjects = unwrapList(projRes);
      setProjects(allProjects);
      setCategories(unwrapList(catRes));
      setGoals(unwrapList(goalRes));

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
    fetchData();
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
      alert(err.response?.data?.message || "Error saving project");
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
  const filtered = filterCategory
    ? rootProjects.filter((p) => p.categoryId === filterCategory)
    : rootProjects;

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
        color: parentForNew.color || "#6366f1",
        status: "ACTIVE",
        dueDate: "",
        categoryId: parentForNew.categoryId || "",
        parentProjectId: parentForNew.id,
      };
    return null;
  };

  return (
    <div>
      <PageHeader
        icon="📁"
        title="Projects"
        description="Manage your projects and track progress"
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
            <button
              className="btn-primary"
              onClick={() => {
                setEditing(null);
                setParentForNew(null);
                setShowForm(true);
              }}
            >
              + New Project
            </button>
          </div>
        }
      />

      <div className="filter-bar">
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="cards-grid" onClick={(e) => e.stopPropagation()} role="presentation">
        {filtered.map((p) => {
          const cat = getCategoryById(p.categoryId);
          const subs = subProjectsMap[p.id] || [];
          return (
            <ProjectCard
              key={p.id}
              p={p}
              cat={cat}
              progress={progress[p.id]}
              subProjects={subs}
              subProgress={progress}
              categories={categories}
              navigate={navigate}
              highlightId={highlightId}
              highlightColor={highlightColor}
              onEdit={(proj) => {
                setEditing(proj);
                setParentForNew(null);
                setShowForm(true);
              }}
              onDelete={handleDelete}
              onAddSub={openAddSub}
              onEditSub={(proj) => {
                // Only called from the explicit ✏️ button inside SubProjectCard
                setEditing(proj);
                setParentForNew(null);
                setShowForm(true);
              }}
              onDeleteSub={handleDelete}
              onAddSubTask={openAddSubTask}
            />
          );
        })}
        {filtered.length === 0 && (
          <p className="empty-state">No projects found.</p>
        )}
      </div>

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