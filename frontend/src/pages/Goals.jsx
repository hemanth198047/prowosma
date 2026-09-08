import React from "react";
import { unwrapList } from "../api/client";
import { useState, useEffect } from "react";
import {
  getGoals,
  updateGoalDependencies,
  createGoal,
  updateGoal,
  updateGoalProgress,
  deleteGoal,
  addSubGoal,
  updateSubGoal,
  deleteSubGoal,
  addStep,
  toggleStep,
  deleteStep,
  addStepComment, deleteStepComment,
  addStepAttachment, deleteStepAttachment,
  addStepDependency, removeStepDependency,
  // B-1: cascading
  // B-2: confidence
  updateConfidence,
  // B-3: check-ins
  addCheckIn, deleteCheckIn,
  // B-4: key results
  addKeyResult, updateKeyResult, deleteKeyResult,
} from "../api/goals";
import { useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../components/ToastContext";
import DateTimePicker from "../components/DateTimePicker";
import { formatDate } from "../utils/dateUtils";
import CanDo from "../components/CanDo";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import EntityActivityTab from "../components/EntityActivityTab";
import { useAuth } from "../hooks/useAuth";

import "../styles/pages/goals.css";
const STATUSES  = ["ACTIVE", "ACHIEVED", "PAUSED"];
const LEVELS    = ["COMPANY", "TEAM", "INDIVIDUAL"];
const QUARTERS  = ["Q1 2025","Q2 2025","Q3 2025","Q4 2025","Q1 2026","Q2 2026","Q3 2026","Q4 2026"];
const KR_STATUS = ["ON_TRACK","AT_RISK","BEHIND","ACHIEVED"];

const CONFIDENCE_COLOR = (v) =>
  v >= 70 ? "#10b981" : v >= 40 ? "#f59e0b" : "#ef4444";

const KR_STATUS_META = {
  ON_TRACK: { label:"On Track", color:"#10b981", bg:"rgba(5,150,105,0.12)" },
  AT_RISK:  { label:"At Risk",  color:"#f59e0b", bg:"rgba(217,119,6,0.12)" },
  BEHIND:   { label:"Behind",   color:"#ef4444", bg:"rgba(239,68,68,0.12)" },
  ACHIEVED: { label:"Achieved", color:"#6366f1", bg:"rgba(99,102,241,0.12)" },
};

const LEVEL_META = {
  COMPANY:    { icon:"🏢", label:"Company",    color:"#6366f1" },
  TEAM:       { icon:"👥", label:"Team",       color:"#06b6d4" },
  INDIVIDUAL: { icon:"👤", label:"Individual", color:"#10b981" },
};

function GoalForm({ initial, allGoals, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial || {
      title: "", description: "", status: "ACTIVE", targetDate: "",
      level: "COMPANY", owner: "", parentGoalId: "", quarter: "",
    },
  );
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  // Possible parent goals (exclude self)
  const parentCandidates = (allGoals || []).filter(g => g.id !== initial?.id);

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>{initial ? "Edit Goal" : "New Goal"}</h2>

        <div className="form-group">
          <label htmlFor={"goals-title"}>Title *</label>
          <input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Goal title" id={"goals-title"} />
        </div>

        <div className="form-group">
          <label htmlFor={"goals-description"}>Description</label>
          <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} placeholder="Optional description" id={"goals-description"} />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"goals-level-b-1"}>Level (B-1)</label>
            <select value={form.level} onChange={(e) => set("level", e.target.value)} id={"goals-level-b-1"}>
              {LEVELS.map(l => <option key={l} value={l}>{LEVEL_META[l].icon} {LEVEL_META[l].label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor={"goals-quarter"}>Quarter</label>
            <select value={form.quarter} onChange={(e) => set("quarter", e.target.value)} id={"goals-quarter"}>
              <option value="">— None —</option>
              {QUARTERS.map(q => <option key={q} value={q}>{q}</option>)}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"goals-owner"}>Owner</label>
            <input value={form.owner} onChange={(e) => set("owner", e.target.value)} placeholder="Person or team" id={"goals-owner"} />
          </div>
          <div className="form-group">
            <label htmlFor={"goals-status"}>Status</label>
            <select value={form.status} onChange={(e) => set("status", e.target.value)} id={"goals-status"}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* B-1: Parent goal for cascading */}
        <div className="form-group">
          <label htmlFor={"goals-parent-goal"}>Parent Goal <span style={{color:"var(--gray-400)",fontSize:"11px"}}>(makes this a child goal)</span></label>
          <select value={form.parentGoalId || ""} onChange={(e) => set("parentGoalId", e.target.value || null)} id={"goals-parent-goal"}>
            <option value="">— Root goal (no parent) —</option>
            {parentCandidates.map(g => (
              <option key={g.id} value={g.id}>
                {LEVEL_META[g.level]?.icon || "🎯"} {g.title}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
            <legend style={{ padding: 0 }}>Target Date</legend>
            <DateTimePicker value={form.targetDate} onChange={(val) => set("targetDate", val)} />
          </fieldset>
        </div>

        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving || !form.title.trim()}>
            {saving ? "⏳ Saving..." : "Save Goal"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProgressModal({ goal, onSave, onCancel }) {
  const [progress, setProgress] = useState(goal.progress || 0);
  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>Update Progress</h2>
        <p style={{ marginBottom: "16px", color: "#888" }}>{goal.title}</p>
        <div className="form-group">
          <label>Progress: {progress}%</label>
          <input
            type="range"
            min="0"
            max="100"
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            style={{ padding: "0", border: "none" }}
          />
        </div>
        <div className="progress-bar" style={{ marginBottom: "16px" }}>
          <div
            className="progress-fill"
            style={{ width: `${progress}%`, background: "#6366f1" }}
          />
        </div>
        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => onSave(progress)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function SubGoalForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial || { title: "", description: "", status: "ACTIVE" },
  );
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const handleSubmit = async () => {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>{initial ? "Edit Sub-Goal" : "New Sub-Goal"}</h2>
        <div className="form-group">
          <label htmlFor={"goals-title-2"}>Title *</label>
          <input
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Sub-goal title" id={"goals-title-2"}
          />
        </div>
        <div className="form-group">
          <label htmlFor={"goals-description-2"}>Description</label>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={2}
            placeholder="Optional description" id={"goals-description-2"}
          />
        </div>
        <div className="form-group">
          <label htmlFor={"goals-status-2"}>Status</label>
          <select
            value={form.status}
            onChange={(e) => set("status", e.target.value)} id={"goals-status-2"}
          >
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={saving || !form.title.trim()}
          >
            {saving ? "⏳ Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StepItem({ step, allSteps, goalId, subGoalId, onToggle, onDelete, onRefresh }) {
  const { show: showToast } = useToast?.() || {};
  const [showComments,  setShowComments]  = useState(false);
  const [showFiles,     setShowFiles]     = useState(false);
  const [showDeps,      setShowDeps]      = useState(false);
  const [commentText,   setCommentText]   = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [uploading,     setUploading]     = useState(false);
  const fileInputRef = useState(() => ({ current: null }))[0];

  const handleAddComment = async () => {
    if (!commentText.trim() || savingComment) return;
    setSavingComment(true);
    try {
      await addStepComment(goalId, subGoalId, step.id, { text: commentText.trim() });
      setCommentText("");
      onRefresh?.();
    } catch (e) { console.error(e); showToast?.("Failed to add comment", "error"); }
    finally { setSavingComment(false); }
  };

  const handleDeleteComment = async (cid) => {
    try {
      await deleteStepComment(goalId, subGoalId, step.id, cid);
      onRefresh?.();
    } catch (e) { console.error(e); showToast?.("Failed to delete comment", "error"); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      await addStepAttachment(goalId, subGoalId, step.id, fd);
      onRefresh?.();
    } catch (err) { console.error(err); showToast?.("Failed to upload file", "error"); }
    finally { setUploading(false); e.target.value = ""; }
  };

  const handleDeleteFile = async (aid) => {
    try {
      await deleteStepAttachment(goalId, subGoalId, step.id, aid);
      onRefresh?.();
    } catch (e) { console.error(e); showToast?.("Failed to delete file", "error"); }
  };

  const handleAddDep = async (blockedByStepId) => {
    try {
      await addStepDependency(goalId, subGoalId, step.id, blockedByStepId);
      onRefresh?.();
    } catch (e) { console.error(e); showToast?.("Failed to add dependency", "error"); }
  };

  const handleRemoveDep = async (blockedByStepId) => {
    try {
      await removeStepDependency(goalId, subGoalId, step.id, blockedByStepId);
      onRefresh?.();
    } catch (e) { console.error(e); showToast?.("Failed to remove dependency", "error"); }
  };

  const commentCount    = step.comments?.length || 0;
  const fileCount       = step.attachments?.length || 0;
  const depCount        = step.blockedByStepIds?.length || 0;
  const otherSteps      = allSteps.filter(s => s.id !== step.id);

  return (
    <div className="step-item-wrap">
      <div className="step-item">
        <div className="step-checkbox-area" onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onToggle)?.(e); } }}>
          <div className={`step-checkbox ${step.completed ? "checked" : ""}`}>
            {step.completed && <span>✓</span>}
          </div>
          <span className={`step-title ${step.completed ? "step-done" : ""}`}>
            {step.title}
          </span>
        </div>

        {/* Inline tool buttons */}
        <div className="step-tools">
          <button className={`step-tool-btn ${showComments ? "active" : ""}`}
            onClick={() => { setShowComments(v => !v); setShowFiles(false); setShowDeps(false); }}
            title="Comments">
            💬 {commentCount > 0
              ? <span className="step-tool-count">{commentCount}</span>
              : <span style={{ fontSize:"10px", color:"var(--gray-400)" }}>comment</span>}
          </button>
          <button className={`step-tool-btn ${showFiles ? "active" : ""}`}
            onClick={() => { setShowFiles(v => !v); setShowComments(false); setShowDeps(false); }}
            title="File attachments">
            📎 {fileCount > 0
              ? <span className="step-tool-count">{fileCount}</span>
              : <span style={{ fontSize:"10px", color:"var(--gray-400)" }}>files</span>}
          </button>
          <button className={`step-tool-btn ${showDeps ? "active" : ""}`}
            onClick={() => { setShowDeps(v => !v); setShowComments(false); setShowFiles(false); }}
            title="Manage step dependencies — set which steps must finish before this one">
            🔗 {depCount > 0
              ? <span className="step-tool-count" style={{ background:"rgba(239,68,68,0.12)", color:"#dc2626" }}>
                  {depCount} blocked
                </span>
              : <span style={{ fontSize:"10px", color:"var(--gray-400)" }}>deps</span>}
          </button>
          <button className="btn-icon" style={{ fontSize:"12px" }} onClick={onDelete}>🗑️</button>
        </div>
      </div>

      {/* Comments panel */}
      {showComments && (
        <div className="step-panel">
          {step.comments?.length === 0 || !step.comments
            ? <p className="step-panel-empty">No comments yet</p>
            : step.comments.map(c => (
              <div key={c.id} className="step-comment">
                <span className="step-comment-author">{c.author?.split("@")[0] || "User"}</span>
                <span className="step-comment-text">{c.text}</span>
                <button className="btn-icon" style={{ fontSize:"11px" }}
                  onClick={() => handleDeleteComment(c.id)}>✕</button>
              </div>
            ))
          }
          <div className="step-comment-input">
            <input value={commentText} onChange={e => setCommentText(e.target.value)}
              placeholder="Add a comment…" onKeyDown={e => e.key === "Enter" && handleAddComment()} />
            <button className="btn-primary" style={{ fontSize:"11px", padding:"4px 10px" }}
              onClick={handleAddComment} disabled={savingComment || !commentText.trim()}>
              {savingComment ? "…" : "Post"}
            </button>
          </div>
        </div>
      )}

      {/* Files panel */}
      {showFiles && (
        <div className="step-panel">
          {step.attachments?.length === 0 || !step.attachments
            ? <p className="step-panel-empty">No files attached</p>
            : step.attachments.map(a => (
              <div key={a.id} className="step-file-row">
                <span>📄</span>
                <span className="step-file-name">{a.originalName || a.fileName}</span>
                <span className="step-file-size">{a.fileSize ? `${Math.round(a.fileSize/1024)}KB` : ""}</span>
                <button className="btn-icon" style={{ fontSize:"11px" }}
                  onClick={() => handleDeleteFile(a.id)}>✕</button>
              </div>
            ))
          }
          <div style={{ marginTop:"8px" }}>
            <input type="file" ref={r => fileInputRef.current = r}
              style={{ display:"none" }} onChange={handleFileUpload} />
            <button className="btn-secondary" style={{ fontSize:"11px" }}
              disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? "⏳ Uploading…" : "📎 Attach File"}
            </button>
          </div>
        </div>
      )}

      {/* Dependencies panel */}
      {showDeps && (
        <div className="step-panel">
          <div style={{ fontSize:"12px", color:"var(--gray-500)", marginBottom:"10px", lineHeight:"1.5" }}>
            <strong>Step dependencies</strong> — mark which steps must be completed <em>before</em> this one can start.
          </div>

          {/* Currently blocked by */}
          {step.blockedByStepIds?.length > 0 ? (
            <div style={{ marginBottom:"12px" }}>
              <div className="step-panel-label">⛔ This step is blocked until these finish:</div>
              {step.blockedByStepIds.map(bid => {
                const blocker = allSteps.find(s => s.id === bid);
                return blocker ? (
                  <div key={bid} className="step-dep-row">
                    <span className={`step-dep-dot ${blocker.completed ? "done" : ""}`} />
                    <div style={{ flex:1 }}>
                      <span className="step-dep-title"
                        style={{ textDecoration: blocker.completed ? "line-through" : "none",
                                 color: blocker.completed ? "var(--gray-400)" : "var(--gray-700)" }}>
                        {blocker.title}
                      </span>
                      <span style={{ fontSize:"10px", marginLeft:"6px",
                        color: blocker.completed ? "#10b981" : "#f59e0b",
                        fontWeight:600 }}>
                        {blocker.completed ? "✓ Done" : "⏳ Pending"}
                      </span>
                    </div>
                    <button className="btn-icon" style={{ fontSize:"11px" }}
                      title="Remove this dependency"
                      onClick={() => handleRemoveDep(bid)}>✕</button>
                  </div>
                ) : null;
              })}
            </div>
          ) : (
            <p className="step-panel-empty" style={{ marginBottom:"10px" }}>
              No dependencies — this step can start anytime.
            </p>
          )}

          {/* Add new dependencies */}
          {otherSteps.filter(s => !step.blockedByStepIds?.includes(s.id)).length > 0 && (
            <div>
              <div className="step-panel-label">➕ Block this step until one of these finishes:</div>
              <div className="step-dep-add-list">
                {otherSteps.filter(s => !step.blockedByStepIds?.includes(s.id)).map(s => (
                  <button key={s.id} className="btn-secondary"
                    style={{ fontSize:"11px", padding:"4px 10px", display:"flex", gap:"5px", alignItems:"center" }}
                    title={`Add "${s.title}" as a prerequisite`}
                    onClick={() => handleAddDep(s.id)}>
                    <span className={`step-dep-dot ${s.completed ? "done" : ""}`} />
                    <span>{s.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {otherSteps.length === 0 && (
            <p className="step-panel-empty">No other steps in this sub-goal to depend on.</p>
          )}
        </div>
      )}
    </div>
  );
}

function AddStepInline({ onAdd }) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const handleAdd = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onAdd(title.trim());
      setTitle(""); // clear only after successful save
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="step-add-row">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add a step..."
        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        style={{ fontSize: "12px", padding: "6px 10px" }}
      />
      <button
        className="btn-primary"
        style={{ fontSize: "12px", padding: "6px 12px", whiteSpace: "nowrap" }}
        onClick={handleAdd}
        disabled={saving || !title.trim()}
      >
        {saving ? "⏳" : "+ Add"}
      </button>
    </div>
  );
}

function SubGoalCard({ goalId, subGoal, onEdit, onDelete, onUpdateGoal }) {
  const confirm = useConfirm();
  // Always expanded by default so steps are always visible
  const [expanded, setExpanded] = useState(true);

  const handleToggleStep = async (stepId) => {
    // Returns full Goal object
    const res = await toggleStep(goalId, subGoal.id, stepId);
    onUpdateGoal && onUpdateGoal(res.data);
  };

  const handleDeleteStep = async (stepId) => {
    const ok = await confirm({
      title: "Delete this step?",
      danger: true,
      confirmText: "Delete",
    });
    if (ok) {
      const res = await deleteStep(goalId, subGoal.id, stepId);
      onUpdateGoal && onUpdateGoal(res.data);
    }
  };

  const handleAddStep = async (title) => {
    // Returns full Goal object — update the entire goal in state
    const res = await addStep(goalId, subGoal.id, { title });
    onUpdateGoal && onUpdateGoal(res.data);
  };

  const progress =
    subGoal.steps?.length > 0
      ? Math.round(
          (subGoal.steps.filter((s) => s.completed).length /
            subGoal.steps.length) *
            100,
        )
      : 0;

  const doneCount = subGoal.steps?.filter((s) => s.completed).length || 0;
  const totalCount = subGoal.steps?.length || 0;

  return (
    <div className="subgoal-card">
      <div className="subgoal-header" onClick={() => setExpanded((e) => !e)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setExpanded((e) => !e))?.(e); } }}>
        <div className="subgoal-title-row">
          <div
            className={`subgoal-status-dot ${subGoal.status?.toLowerCase()}`}
          />
          <span className="subgoal-title">{subGoal.title}</span>
          <span className={`badge badge-${subGoal.status?.toLowerCase()}`}>
            {subGoal.status}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "11px", color: "#888" }}>
            {doneCount}/{totalCount} steps
          </span>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: progress === 100 ? "#10b981" : "#6366f1",
            }}
          >
            {progress}%
          </span>
          <CanDo action="edit">
            <button
              className="btn-icon"
              style={{ fontSize: "13px" }}
              onClick={(e) => {
                e.stopPropagation();
                onEdit(subGoal);
              }}
            >
              ✏️
            </button>
          </CanDo>
          <CanDo action="delete">
            <button
              className="btn-icon"
              style={{ fontSize: "13px" }}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(subGoal.id);
              }}
            >
              🗑️
            </button>
          </CanDo>
          <span style={{ color: "#aaa", fontSize: "11px" }}>
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </div>

      {subGoal.description && (
        <p
          style={{ fontSize: "12px", color: "#888", margin: "4px 0 6px 20px" }}
        >
          {subGoal.description}
        </p>
      )}

      <div className="progress-bar" style={{ margin: "6px 0" }}>
        <div
          className="progress-fill"
          style={{
            width: `${progress}%`,
            background: progress === 100 ? "#10b981" : "#6366f1",
          }}
        />
      </div>

      {expanded && (
        <div className="steps-container">
          <div className="steps-label">Steps</div>
          {subGoal.steps?.length > 0 ? (
            subGoal.steps.map((step) => (
              <StepItem
                key={step.id}
                step={step}
                allSteps={subGoal.steps}
                goalId={goalId}
                subGoalId={subGoal.id}
                onToggle={() => handleToggleStep(step.id)}
                onDelete={() => handleDeleteStep(step.id)}
                onRefresh={onUpdateGoal}
              />
            ))
          ) : (
            <p style={{ fontSize: "12px", color: "#aaa", padding: "6px 0" }}>
              No steps yet.
            </p>
          )}
        </div>
      )}
      {/* Always show Add Step input regardless of expanded state */}
      <div style={{ padding: "4px 12px 8px" }}>
        <AddStepInline onAdd={handleAddStep} />
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// B-2: CONFIDENCE METER + SPARKLINE
// ═══════════════════════════════════════════════════════════════
function ConfidenceMeter({ goal, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [val,     setVal]     = useState(goal.confidence ?? 50);
  const [note,    setNote]    = useState("");
  const [saving,  setSaving]  = useState(false);
  const history = goal.confidenceHistory || [];
  const color = CONFIDENCE_COLOR(goal.confidence ?? 50);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateConfidence(goal.id, val, note);
      setEditing(false);
      setNote("");
      onUpdate();
    } finally { setSaving(false); }
  };

  // Mini sparkline — last 8 confidence entries
  const spark = history.slice(-8);

  // Drift detection: if confidence dropped >15pts in last 3 entries → drifting
  const recentDrift = (() => {
    if (spark.length < 3) return null;
    const last  = spark[spark.length-1]?.value || 50;
    const prev  = spark[spark.length-3]?.value || 50;
    const delta = last - prev;
    if (delta <= -15) return { label:"⚠️ Drifting", color:"#ef4444", delta };
    if (delta >= 15)  return { label:"📈 Improving", color:"#10b981", delta };
    return null;
  })();

  return (
    <div className="goal-confidence">
      <div className="goal-confidence-header">
        <span className="goal-confidence-label">Confidence</span>
        <div className="goal-confidence-right">
          {recentDrift && (
            <span style={{fontSize:"10px",fontWeight:700,
              background:`${recentDrift.color}18`,color:recentDrift.color,
              padding:"2px 7px",borderRadius:"99px",marginRight:"4px"}}>
              {recentDrift.label} ({recentDrift.delta > 0 ? "+" : ""}{recentDrift.delta}pts)
            </span>
          )}
          {spark.length > 1 && (
            <svg width="48" height="18" className="goal-confidence-spark">
              {spark.map((e, i) => {
                const x1 = (i / (spark.length - 1)) * 44 + 2;
                const y1 = 16 - (e.value / 100) * 14;
                const x2 = ((i+1) / (spark.length - 1)) * 44 + 2;
                const y2 = 16 - (spark[i+1]?.value / 100) * 14;
                return i < spark.length - 1 ? (
                  <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={color} strokeWidth="1.5" />
                ) : null;
              })}
            </svg>
          )}
          <span className="goal-confidence-value" style={{ color }}>
            {goal.confidence ?? 50}%
          </span>
          <button className="goal-confidence-edit-btn" onClick={() => setEditing(v => !v)}>
            {editing ? "✕" : "✎"}
          </button>
        </div>
      </div>
      <div className="goal-confidence-bar">
        <div className="goal-confidence-fill" style={{ width: `${goal.confidence ?? 50}%`, background: color }} />
      </div>
      {editing && (
        <div className="goal-confidence-form">
          <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
            <input type="range" min={0} max={100} step={5} value={val}
              onChange={e => setVal(Number(e.target.value))}
              style={{ flex:1 }} />
            <span style={{ minWidth:"32px", fontWeight:700, color: CONFIDENCE_COLOR(val) }}>{val}%</span>
          </div>
          <input className="goal-ci-input" value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional note (what changed?)" />
          <button className="btn-primary" style={{ fontSize:"12px", padding:"6px 12px" }}
            disabled={saving} onClick={handleSave}>
            {saving ? "Saving…" : "Update"}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// B-3: WEEKLY CHECK-IN
// ═══════════════════════════════════════════════════════════════
function CheckInPanel({ goal, onUpdate }) {
  const [open,    setOpen]    = useState(false);
  const [form,    setForm]    = useState({ update:"", blockers:"" });
  const [saving,  setSaving]  = useState(false);
  const confirm = useConfirm();
  const checkIns = goal.checkIns || [];

  const handleAdd = async () => {
    if (!form.update.trim()) return;
    setSaving(true);
    try {
      await addCheckIn(goal.id, form);
      setForm({ update:"", blockers:"" });
      setOpen(false);
      onUpdate();
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({ title:"Delete check-in?", message:"This check-in will be removed.", danger:true });
    if (!ok) return;
    await deleteCheckIn(goal.id, id);
    onUpdate();
  };

  return (
    <div className="goal-checkin-panel">
      <div className="goal-checkin-header">
        <span className="goal-section-label">📅 Weekly Check-ins ({checkIns.length})</span>
        <button className="btn-secondary" style={{ fontSize:"11px", padding:"4px 10px" }}
          onClick={() => setOpen(v => !v)}>
          {open ? "✕ Cancel" : "+ Add Check-in"}
        </button>
      </div>

      {open && (
        <div className="goal-checkin-form">
          <div className="form-group">
            <label htmlFor={"goals-this-week-s-update"}>This week's update *</label>
            <textarea rows={2} value={form.update} placeholder="What progress was made?"
              onChange={e => setForm(f => ({ ...f, update: e.target.value }))} id={"goals-this-week-s-update"} />
          </div>
          <div className="form-group">
            <label htmlFor={"goals-blockers"}>Blockers</label>
            <textarea rows={1} value={form.blockers} placeholder="Anything blocking progress?"
              onChange={e => setForm(f => ({ ...f, blockers: e.target.value }))} id={"goals-blockers"} />
          </div>
          <button className="btn-primary" style={{ fontSize:"12px", padding:"6px 12px" }}
            disabled={saving || !form.update.trim()} onClick={handleAdd}>
            {saving ? "Saving…" : "Save Check-in"}
          </button>
        </div>
      )}

      {checkIns.slice(0, 5).map((ci) => (
        <div key={ci.id} className="goal-checkin-item">
          <div className="goal-checkin-meta">
            <span className="goal-checkin-author">{ci.author}</span>
            <span className="goal-checkin-date">
              {ci.createdAt ? new Date(ci.createdAt).toLocaleDateString([], { day:"numeric", month:"short" }) : ""}
            </span>
            <span className="goal-checkin-snap">📊 {ci.progressSnapshot}% · 🎯 {ci.confidenceSnapshot}%</span>
            <button className="goal-ci-delete-btn" onClick={() => handleDelete(ci.id)}>🗑</button>
          </div>
          <div className="goal-checkin-update">{ci.update}</div>
          {ci.blockers && <div className="goal-checkin-blockers">⚠️ {ci.blockers}</div>}
        </div>
      ))}
      {checkIns.length > 5 && (
        <div className="goal-checkin-more">+{checkIns.length - 5} older check-ins</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// B-4: KEY RESULTS PANEL
// ═══════════════════════════════════════════════════════════════
function KeyResultsPanel({ goal, onUpdate }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form,    setForm]    = useState({ title:"", metric:"", unit:"%", startValue:0, targetValue:100, currentValue:0, status:"ON_TRACK" });
  const [saving,  setSaving]  = useState(false);
  const [editingValue, setEditingValue] = useState(null); // { krId, value }
  const confirm = useConfirm();
  const krs = goal.keyResults || [];

  const resetForm = () => setForm({ title:"", metric:"", unit:"%", startValue:0, targetValue:100, currentValue:0, status:"ON_TRACK" });

  const handleAdd = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await addKeyResult(goal.id, { ...form, startValue: Number(form.startValue), targetValue: Number(form.targetValue), currentValue: Number(form.currentValue) });
      resetForm(); setShowAdd(false); onUpdate();
    } finally { setSaving(false); }
  };

  const handleUpdateValue = async (kr) => {
    if (editingValue?.krId !== kr.id) return;
    await updateKeyResult(goal.id, kr.id, { ...kr, currentValue: Number(editingValue.value) });
    setEditingValue(null); onUpdate();
  };

  const handleDelete = async (krId) => {
    const ok = await confirm({ title:"Delete Key Result?", message:"This cannot be undone.", danger:true });
    if (!ok) return;
    await deleteKeyResult(goal.id, krId);
    onUpdate();
  };

  const handleStatusChange = async (kr, status) => {
    await updateKeyResult(goal.id, kr.id, { ...kr, status });
    onUpdate();
  };

  const krProgress = (kr) => {
    const range = kr.targetValue - kr.startValue;
    if (range === 0) return kr.currentValue >= kr.targetValue ? 100 : 0;
    return Math.min(100, Math.max(0, Math.round(((kr.currentValue - kr.startValue) / range) * 100)));
  };

  return (
    <div className="goal-kr-panel">
      <div className="goal-kr-header">
        <span className="goal-section-label">🎯 Key Results ({krs.length})</span>
        <button className="btn-secondary" style={{ fontSize:"11px", padding:"4px 10px" }}
          onClick={() => { setShowAdd(v => !v); resetForm(); }}>
          {showAdd ? "✕ Cancel" : "+ Add KR"}
        </button>
      </div>

      {showAdd && (
        <div className="goal-kr-form">
          <div className="form-row">
            <div className="form-group" style={{ flex:2 }}>
              <label htmlFor={"goals-key-result-title"}>Key Result title *</label>
              <input value={form.title} onChange={e => setForm(f => ({...f, title:e.target.value}))}
                placeholder="e.g. Increase monthly revenue" id={"goals-key-result-title"} />
            </div>
            <div className="form-group" style={{ flex:1 }}>
              <label htmlFor={"goals-metric"}>Metric</label>
              <input value={form.metric} onChange={e => setForm(f => ({...f, metric:e.target.value}))}
                placeholder="Revenue, NPS…" id={"goals-metric"} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor={"goals-start"}>Start</label>
              <input type="number" value={form.startValue} onChange={e => setForm(f => ({...f, startValue:e.target.value}))} id={"goals-start"} />
            </div>
            <div className="form-group">
              <label htmlFor={"goals-target"}>Target</label>
              <input type="number" value={form.targetValue} onChange={e => setForm(f => ({...f, targetValue:e.target.value}))} id={"goals-target"} />
            </div>
            <div className="form-group">
              <label htmlFor={"goals-current"}>Current</label>
              <input type="number" value={form.currentValue} onChange={e => setForm(f => ({...f, currentValue:e.target.value}))} id={"goals-current"} />
            </div>
            <div className="form-group">
              <label htmlFor={"goals-unit"}>Unit</label>
              <input value={form.unit} onChange={e => setForm(f => ({...f, unit:e.target.value}))} placeholder="%, $, users…" id={"goals-unit"} />
            </div>
          </div>
          <button className="btn-primary" style={{ fontSize:"12px", padding:"6px 12px" }}
            disabled={saving || !form.title.trim()} onClick={handleAdd}>
            {saving ? "Saving…" : "Add Key Result"}
          </button>
        </div>
      )}

      {krs.map((kr) => {
        const pct = krProgress(kr);
        const meta = KR_STATUS_META[kr.status] || KR_STATUS_META.ON_TRACK;
        const isEditing = editingValue?.krId === kr.id;
        return (
          <div key={kr.id} className="goal-kr-item">
            <div className="goal-kr-top">
              <div className="goal-kr-title">{kr.title}</div>
              <div className="goal-kr-actions">
                <span className="goal-kr-status-badge" style={{ background:meta.bg, color:meta.color }}>
                  {meta.label}
                </span>
                <select className="goal-kr-status-select"
                  value={kr.status}
                  onChange={e => handleStatusChange(kr, e.target.value)}>
                  {KR_STATUS.map(s => <option key={s} value={s}>{KR_STATUS_META[s].label}</option>)}
                </select>
                <button className="goal-ci-delete-btn" onClick={() => handleDelete(kr.id)}>🗑</button>
              </div>
            </div>
            <div className="goal-kr-progress-row">
              <div className="goal-kr-progress-bar">
                <div className="goal-kr-progress-fill"
                  style={{ width:`${pct}%`, background: pct===100 ? "#10b981" : meta.color }} />
              </div>
              <span className="goal-kr-pct">{pct}%</span>
            </div>
            <div className="goal-kr-values">
              <span>{kr.startValue}{kr.unit}</span>
              <span style={{ color:"var(--gray-400)" }}>→</span>
              {isEditing ? (
                <div style={{ display:"flex", gap:"6px", alignItems:"center" }}>
                  <input type="number" className="goal-kr-value-input"
                    value={editingValue.value}
                    onChange={e => setEditingValue(v => ({...v, value: e.target.value }))}
                    onKeyDown={e => { if (e.key==="Enter") handleUpdateValue(kr); if (e.key==="Escape") setEditingValue(null); }}
                    />
                  <button className="btn-primary" style={{ fontSize:"11px", padding:"3px 8px" }}
                    onClick={() => handleUpdateValue(kr)}>✓</button>
                  <button className="btn-secondary" style={{ fontSize:"11px", padding:"3px 8px" }}
                    onClick={() => setEditingValue(null)}>✕</button>
                </div>
              ) : (
                <span className="goal-kr-current" onClick={() => setEditingValue({ krId:kr.id, value:kr.currentValue })} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setEditingValue({ krId:kr.id, value:kr.currentValue }))?.(e); } }}>
                  {kr.currentValue}{kr.unit} <span className="goal-kr-edit-hint">✎</span>
                </span>
              )}
              <span style={{ color:"var(--gray-400)" }}>/ {kr.targetValue}{kr.unit}</span>
              {kr.metric && <span className="goal-kr-metric">({kr.metric})</span>}
            </div>
          </div>
        );
      })}
      {krs.length === 0 && !showAdd && (
        <div className="goal-kr-empty">No key results yet. Add KRs to make this an OKR.</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// B-1: CHILD GOALS (cascade tree)
// ═══════════════════════════════════════════════════════════════
function GoalContributionPanel({ goal, onUpdate }) {
  const [tasks, setTasks] = React.useState([]);
  const [linking, setLinking] = React.useState(false);
  const [allTasks, setAllTasks] = React.useState([]);

  React.useEffect(()=>{
    import("../api/tasks").then(m=>m.getTasks()).then(r=>{
      const all = r.data||[];
      setAllTasks(all);
      setTasks(all.filter(t=>t.linkedGoalId===goal.id));
    }).catch(()=>{});
  },[goal.id]);

  const autoCalcProgress = () => {
    if (tasks.length===0) return 0;
    const totalWeight = tasks.reduce((a,t)=>a+(t.goalContributionWeight||1),0);
    const doneWeight  = tasks.filter(t=>t.status==="DONE")
      .reduce((a,t)=>a+(t.goalContributionWeight||1),0);
    return Math.round((doneWeight/totalWeight)*100);
  };

  const calculatedProgress = autoCalcProgress();

  return (
    <div style={{padding:"12px 0"}}>
      <div style={{fontWeight:800,fontSize:"13px",marginBottom:"10px",color:"var(--gray-800)"}}>
        📈 Task Contribution to Goal
      </div>

      {/* Auto-calculated progress */}
      {tasks.length > 0 && (
        <div style={{background:"rgba(99,102,241,.06)",border:"1px solid rgba(99,102,241,.2)",
          borderRadius:"var(--radius-md)",padding:"10px",marginBottom:"12px"}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:"12px",marginBottom:"5px"}}>
            <span style={{fontWeight:700,color:"#6366f1"}}>Auto-calculated progress</span>
            <span style={{fontWeight:800,color:"#6366f1"}}>{calculatedProgress}%</span>
          </div>
          <div className="kpi-progress-bar">
            <div className="kpi-progress-fill" style={{width:calculatedProgress+"%",background:"#6366f1"}}/>
          </div>
          <div style={{fontSize:"11px",color:"var(--gray-400)",marginTop:"5px"}}>
            Based on {tasks.filter(t=>t.status==="DONE").length}/{tasks.length} linked tasks completed
          </div>
          <button className="btn-primary" style={{fontSize:"11px",marginTop:"8px"}} onClick={async()=>{
            await import("../api/goals").then(m=>m.updateGoal(goal.id,{progress:calculatedProgress}));
            onUpdate();
          }}>Apply {calculatedProgress}% to Goal Progress</button>
        </div>
      )}

      {/* Linked tasks */}
      {tasks.map(t=>(
        <div key={t.id} style={{display:"flex",alignItems:"center",gap:"8px",padding:"6px 0",
          borderBottom:"1px solid var(--border)",fontSize:"12px"}}>
          <span style={{color:t.status==="DONE"?"#10b981":"#f59e0b"}}>
            {t.status==="DONE"?"✅":"⬜"}
          </span>
          <span style={{flex:1,color:"var(--gray-700)"}}>{t.title}</span>
          <span style={{fontSize:"10px",fontWeight:700,color:"#6366f1"}}>
            ×{t.goalContributionWeight||1}
          </span>
        </div>
      ))}

      {tasks.length===0 && (
        <div style={{fontSize:"12px",color:"var(--gray-400)",padding:"12px 0"}}>
          No tasks linked to this goal yet. Link tasks by setting their Goal field.
        </div>
      )}

      {/* Link existing task */}
      {linking && (
        <div style={{marginTop:"10px",display:"flex",gap:"8px",flexWrap:"wrap"}}>
          <select id="gc-task-sel" style={{flex:1}}>
            <option value="">— pick a task —</option>
            {allTasks.filter(t=>t.linkedGoalId!==goal.id).map(t=>(
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
          <button className="btn-primary" style={{fontSize:"11px"}} onClick={async()=>{
            const id = document.getElementById("gc-task-sel")?.value;
            if (!id) return;
            await import("../api/client").then(m=>m.default.patch(`/tasks/${id}/goal-link`,
              {linkedGoalId:goal.id,goalContributionWeight:1}));
            const r = await import("../api/tasks").then(m=>m.getTasks());
            setTasks((r.data||[]).filter(t=>t.linkedGoalId===goal.id));
            setLinking(false);
          }}>Link Task</button>
          <button className="btn-secondary" style={{fontSize:"11px"}} onClick={()=>setLinking(false)}>
            Cancel
          </button>
        </div>
      )}
      {!linking && (
        <button className="btn-secondary" style={{fontSize:"11px",marginTop:"10px"}}
          onClick={()=>setLinking(true)}>+ Link Task to Goal</button>
      )}
    </div>
  );
}

function ChildGoalsPanel({ goal, allGoals, onRequestAdd }) {
  const children = allGoals.filter(g => g.parentGoalId === goal.id);
  if (children.length === 0 && !onRequestAdd) return null;
  return (
    <div className="goal-children-panel">
      <div className="goal-section-label">
        🔗 Child Goals ({children.length})
        <button className="btn-secondary" style={{ fontSize:"11px", padding:"3px 8px", marginLeft:"8px" }}
          onClick={() => onRequestAdd(goal.id)}>
          + Add child goal
        </button>
      </div>
      {children.map(child => (
        <div key={child.id} className="goal-child-row">
          <span className="goal-child-level-icon">{LEVEL_META[child.level]?.icon || "🎯"}</span>
          <span className="goal-child-title">{child.title}</span>
          <div className="goal-child-progress-bar">
            <div className="goal-child-progress-fill" style={{ width:`${child.progress}%` }} />
          </div>
          <span className="goal-child-pct">{child.progress}%</span>
          <span className="goal-child-status"
            style={{ color: child.status === "ACHIEVED" ? "#10b981" : child.status === "PAUSED" ? "#f59e0b" : "#6366f1" }}>
            {child.status}
          </span>
        </div>
      ))}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// B-5: GOAL SCORECARD VIEW
// ═══════════════════════════════════════════════════════════════

// ── A-5: Goal Alignment Map (interactive visual tree) ─────────
function AlignmentMap({ goals }) {
  const [zoom, setZoom] = useState(1);
  const [pan,  setPan]  = useState({ x:0, y:0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);

  // Build tree: roots = goals with no parent
  const roots = goals.filter(g => !g.parentGoalId);
  const childrenOf = (id) => goals.filter(g => g.parentGoalId === id);

  const conf2color = (conf) =>
    conf >= 70 ? "#10b981" : conf >= 40 ? "#f59e0b" : "#ef4444";

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };
  const onMouseMove = (e) => {
    if (!dragging || !dragStart) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };
  const onMouseUp = () => { setDragging(false); setDragStart(null); };

  const NODE_W = 180, NODE_H = 60, COL_GAP = 220, ROW_GAP = 80;

  // Layout: assign x/y positions per level
  function layout(nodes, level = 0, startY = 0) {
    let result = [];
    let y = startY;
    nodes.forEach(g => {
      const children = childrenOf(g.id);
      const item = { goal:g, x: level * COL_GAP + 20, y, level };
      result.push(item);
      if (children.length > 0) {
        const sub = layout(children, level + 1, y);
        result = result.concat(sub);
        y = sub[sub.length - 1].y + ROW_GAP;
      } else {
        y += ROW_GAP;
      }
    });
    return result;
  }

  const nodes = layout(roots);
  const totalH = Math.max(400, nodes.length * ROW_GAP + 60);
  const totalW = Math.max(600, (Math.max(...nodes.map(n=>n.level), 0) + 1) * COL_GAP + NODE_W + 40);

  return (
    <div className="alignment-map-wrap">
      <div className="alignment-map-controls">
        <button className="btn-secondary" style={{ fontSize:"11px" }}
          onClick={() => setZoom(z => Math.min(2, z + 0.1))}>+ Zoom</button>
        <span style={{ fontSize:"11px", color:"var(--gray-400)" }}>{Math.round(zoom*100)}%</span>
        <button className="btn-secondary" style={{ fontSize:"11px" }}
          onClick={() => setZoom(z => Math.max(0.3, z - 0.1))}>− Zoom</button>
        <button className="btn-secondary" style={{ fontSize:"11px" }}
          onClick={() => { setZoom(1); setPan({x:0,y:0}); }}>Reset</button>
        <span className="alignment-map-hint">Drag to pan</span>
      </div>

      <div className="alignment-map-canvas"
        onMouseDown={onMouseDown} onMouseMove={onMouseMove}
        onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        style={{ cursor: dragging ? "grabbing" : "grab" }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onMouseDown)?.(e); } }}>
        <svg
          width={totalW * zoom}
          height={totalH * zoom}
          style={{ transform:`translate(${pan.x}px,${pan.y}px)`, transformOrigin:"0 0" }}>
          <g transform={`scale(${zoom})`}>
            {/* Connection lines */}
            {nodes.map(n => {
              const children = nodes.filter(c => c.goal.parentGoalId === n.goal.id);
              return children.map(c => (
                <line key={`${n.goal.id}-${c.goal.id}`}
                  x1={n.x + NODE_W} y1={n.y + NODE_H/2}
                  x2={c.x}          y2={c.y + NODE_H/2}
                  stroke="var(--border)" strokeWidth={1.5} strokeDasharray="4 3" />
              ));
            })}

            {/* Nodes */}
            {nodes.map(n => {
              const conf  = n.goal.confidence || 50;
              const color = conf2color(conf);
              const isRoot = !n.goal.parentGoalId;
              return (
                <g key={n.goal.id}>
                  <rect x={n.x} y={n.y} width={NODE_W} height={NODE_H}
                    rx={8} ry={8}
                    fill={isRoot ? "rgba(99,102,241,0.08)" : "var(--bg-card)"}
                    stroke={isRoot ? "#6366f1" : "var(--border)"}
                    strokeWidth={isRoot ? 2 : 1} />
                  {/* Confidence bar at bottom */}
                  <rect x={n.x+4} y={n.y+NODE_H-8} width={NODE_W-8} height={4}
                    rx={2} fill="var(--gray-100)" />
                  <rect x={n.x+4} y={n.y+NODE_H-8} width={(NODE_W-8)*(conf/100)} height={4}
                    rx={2} fill={color} />
                  {/* Title */}
                  <foreignObject x={n.x+8} y={n.y+6} width={NODE_W-16} height={NODE_H-16}>
                    <div xmlns="http://www.w3.org/1999/xhtml"
                      style={{ fontSize:"11px", fontWeight:700,
                        color:"var(--gray-700)", lineHeight:1.3,
                        overflow:"hidden", maxHeight:"32px" }}>
                      {n.goal.title}
                    </div>
                  </foreignObject>
                  {/* Confidence badge */}
                  <text x={n.x+NODE_W-8} y={n.y+14}
                    textAnchor="end" fontSize={10} fontWeight={700} fill={color}>
                    {conf}%
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {nodes.length === 0 && (
        <div className="empty-state">
          No goals yet. Create goals and link them as parent-child to see the alignment map.
        </div>
      )}
    </div>
  );
}


// ── Goal Dependency Mapping ───────────────────────────────────
function GoalDependencyPanel({ goal, allGoals, onRefresh }) {
  const prereqs    = goal.prerequisiteGoalIds || [];
  const [adding, setAdding] = useState(false);
  const [selId,  setSelId]  = useState("");
  const [saving, setSaving] = useState(false);

  // Goals that block THIS goal
  const blockers = allGoals.filter(g => prereqs.includes(g.id));
  // Goals that THIS goal blocks
  const blocks   = allGoals.filter(g => (g.prerequisiteGoalIds||[]).includes(goal.id));
  // Available to add (not already a prereq, not self, not a child)
  const available = allGoals.filter(g =>
    g.id !== goal.id && !prereqs.includes(g.id) && g.parentGoalId !== goal.id
  );

  const addDep = async () => {
    if (!selId) return;
    setSaving(true);
    try {
      await updateGoalDependencies(goal.id, [...prereqs, selId]);
      setAdding(false); setSelId(""); onRefresh();
    } finally { setSaving(false); }
  };

  const removeDep = async (depId) => {
    await updateGoalDependencies(goal.id, prereqs.filter(id => id !== depId));
    onRefresh();
  };

  const confColor = (g) => {
    const c = g.confidence || 50;
    return c >= 70 ? "#10b981" : c >= 40 ? "#f59e0b" : "#ef4444";
  };

  return (
    <div className="goal-dep-panel">
      <div className="goal-dep-section-title">
        🔗 Dependencies
        <span className="goal-dep-count">
          {blockers.length} prerequisite{blockers.length !== 1 ? "s" : ""}
        </span>
      </div>

      {blockers.length > 0 && (
        <div className="goal-dep-group">
          <div className="goal-dep-group-label">⛔ This goal is blocked by:</div>
          {blockers.map(g => (
            <div key={g.id} className="goal-dep-row">
              <div className="goal-dep-conf" style={{ background: confColor(g) }} />
              <span className="goal-dep-title">{g.title}</span>
              <span className="goal-dep-status"
                style={{ color: g.status==="ACHIEVED"?"#10b981":g.status==="PAUSED"?"#6b7280":"#f59e0b" }}>
                {g.status}
              </span>
              <button className="btn-icon" title="Remove dependency"
                onClick={() => removeDep(g.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {blocks.length > 0 && (
        <div className="goal-dep-group">
          <div className="goal-dep-group-label">🚧 This goal unblocks:</div>
          {blocks.map(g => (
            <div key={g.id} className="goal-dep-row goal-dep-row-blocks">
              <div className="goal-dep-conf" style={{ background: confColor(g) }} />
              <span className="goal-dep-title">{g.title}</span>
              <span className="goal-dep-status">{g.status}</span>
            </div>
          ))}
        </div>
      )}

      {blockers.length === 0 && blocks.length === 0 && (
        <div className="goal-dep-empty">No dependencies. Add prerequisites below.</div>
      )}

      {adding ? (
        <div className="goal-dep-add-row">
          <select value={selId} onChange={e => setSelId(e.target.value)} className="goal-dep-select">
            <option value="">— Select prerequisite goal —</option>
            {available.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
          <button className="btn-primary" style={{ fontSize:"11px" }}
            disabled={saving || !selId} onClick={addDep}>
            {saving ? "…" : "Add"}
          </button>
          <button className="btn-secondary" style={{ fontSize:"11px" }}
            onClick={() => { setAdding(false); setSelId(""); }}>Cancel</button>
        </div>
      ) : (
        <button className="btn-secondary" style={{ fontSize:"11px", marginTop:"6px" }}
          onClick={() => setAdding(true)}>+ Add Prerequisite</button>
      )}
    </div>
  );
}

function ScorecardView({ goals }) {
  const sorted = [...goals].sort((a, b) => (b.progress || 0) - (a.progress || 0));

  const avgConfidence = goals.length
    ? Math.round(goals.reduce((s, g) => s + (g.confidence ?? 50), 0) / goals.length)
    : 0;
  const avgProgress = goals.length
    ? Math.round(goals.reduce((s, g) => s + (g.progress || 0), 0) / goals.length)
    : 0;
  const achieved   = goals.filter(g => g.status === "ACHIEVED").length;
  const atRisk     = goals.filter(g => (g.confidence ?? 50) < 40 && g.status !== "ACHIEVED").length;

  return (
    <div className="scorecard-wrap">
      {/* Summary row */}
      <div className="scorecard-summary">
        <div className="scorecard-kpi">
          <div className="scorecard-kpi-num" style={{ color:"#6366f1" }}>{goals.length}</div>
          <div className="scorecard-kpi-label">Total Goals</div>
        </div>
        <div className="scorecard-kpi">
          <div className="scorecard-kpi-num" style={{ color:"#10b981" }}>{achieved}</div>
          <div className="scorecard-kpi-label">Achieved</div>
        </div>
        <div className="scorecard-kpi">
          <div className="scorecard-kpi-num" style={{ color:"#ef4444" }}>{atRisk}</div>
          <div className="scorecard-kpi-label">At Risk</div>
        </div>
        <div className="scorecard-kpi">
          <div className="scorecard-kpi-num" style={{ color:"#6366f1" }}>{avgProgress}%</div>
          <div className="scorecard-kpi-label">Avg Progress</div>
        </div>
        <div className="scorecard-kpi">
          <div className="scorecard-kpi-num" style={{ color: CONFIDENCE_COLOR(avgConfidence) }}>{avgConfidence}%</div>
          <div className="scorecard-kpi-label">Avg Confidence</div>
        </div>
      </div>

      {/* Scorecard table */}
      <div className="scorecard-table-wrap">
        <table className="scorecard-table">
          <thead>
            <tr>
              <th>Goal</th>
              <th>Level</th>
              <th>Quarter</th>
              <th>Owner</th>
              <th>Progress</th>
              <th>Confidence</th>
              <th>KRs</th>
              <th>Check-ins</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(g => {
              const conf = g.confidence ?? 50;
              const confColor = CONFIDENCE_COLOR(conf);
              const lm = LEVEL_META[g.level] || LEVEL_META.COMPANY;
              return (
                <tr key={g.id} className="scorecard-row">
                  <td className="scorecard-title-cell">
                    <div className="scorecard-goal-title">{g.title}</div>
                    {g.parentGoalId && <span className="scorecard-child-tag">↳ child</span>}
                  </td>
                  <td>
                    <span className="scorecard-level-chip" style={{ color:lm.color, background:`${lm.color}18` }}>
                      {lm.icon} {lm.label}
                    </span>
                  </td>
                  <td className="scorecard-meta">{g.quarter || "—"}</td>
                  <td className="scorecard-meta">{g.owner || "—"}</td>
                  <td>
                    <div className="scorecard-progress-wrap">
                      <div className="scorecard-progress-bar">
                        <div className="scorecard-progress-fill"
                          style={{ width:`${g.progress||0}%`, background: g.progress===100?"#10b981":"#6366f1" }} />
                      </div>
                      <span className="scorecard-progress-pct">{g.progress||0}%</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                      <div className="scorecard-conf-bar">
                        <div style={{ width:`${conf}%`, height:"100%", background:confColor, borderRadius:"99px" }} />
                      </div>
                      <span style={{ fontSize:"12px", fontWeight:700, color:confColor }}>{conf}%</span>
                    </div>
                  </td>
                  <td className="scorecard-meta">{g.keyResults?.length || 0}</td>
                  <td className="scorecard-meta">{g.checkIns?.length || 0}</td>
                  <td>
                    <span className={`scorecard-status-badge scorecard-status-${g.status?.toLowerCase()}`}>
                      {g.status}
                    </span>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={9} className="scorecard-empty">No goals to show</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// B-6: QUARTERLY PLANNING VIEW
// ═══════════════════════════════════════════════════════════════
function QuarterlyView({ goals, allGoals, onRequestAdd }) {
  // Group by quarter
  const groups = {};
  goals.forEach(g => {
    const q = g.quarter || "Unplanned";
    if (!groups[q]) groups[q] = [];
    groups[q].push(g);
  });
  const quarterOrder = Object.keys(groups).sort((a, b) =>
    a === "Unplanned" ? 1 : b === "Unplanned" ? -1 : a.localeCompare(b)
  );

  return (
    <div className="quarterly-wrap">
      <div className="goal-section-label" style={{ marginBottom: "12px" }}>
        <button className="btn-secondary" style={{ fontSize: "11px", padding: "3px 8px" }}
          onClick={() => onRequestAdd()}>
          + Add Goal
        </button>
      </div>
      {quarterOrder.map(quarter => {
        const qGoals = groups[quarter];
        const avgProgress = Math.round(qGoals.reduce((s, g) => s + (g.progress||0), 0) / qGoals.length);
        const achieved = qGoals.filter(g => g.status === "ACHIEVED").length;
        const atRisk   = qGoals.filter(g => (g.confidence??50) < 40 && g.status !== "ACHIEVED").length;

        return (
          <div key={quarter} className="quarterly-group">
            <div className="quarterly-header">
              <div className="quarterly-title">
                <span className="quarterly-icon">🗓</span>
                <span>{quarter}</span>
                <span className="quarterly-count">{qGoals.length} goal{qGoals.length!==1?"s":""}</span>
              </div>
              <div className="quarterly-meta-row">
                <span className="quarterly-stat"><span style={{color:"#6366f1",fontWeight:700}}>{avgProgress}%</span> avg</span>
                <span className="quarterly-stat"><span style={{color:"#10b981",fontWeight:700}}>{achieved}</span> achieved</span>
                {atRisk > 0 && <span className="quarterly-stat"><span style={{color:"#ef4444",fontWeight:700}}>{atRisk}</span> at risk</span>}
              </div>
              {/* Quarter progress bar */}
              <div className="quarterly-progress-bar">
                <div className="quarterly-progress-fill" style={{ width:`${avgProgress}%` }} />
              </div>
            </div>

            <div className="quarterly-goals-grid">
              {qGoals.map(g => {
                const lm = LEVEL_META[g.level] || LEVEL_META.COMPANY;
                const conf = g.confidence ?? 50;
                const children = allGoals.filter(x => x.parentGoalId === g.id);
                return (
                  <div key={g.id} className="quarterly-goal-card">
                    <div className="quarterly-goal-top">
                      <span className="quarterly-level-chip" style={{ color:lm.color, background:`${lm.color}18` }}>
                        {lm.icon}
                      </span>
                      <span className="quarterly-goal-title">{g.title}</span>
                      <span className={`quarterly-status scorecard-status-${g.status?.toLowerCase()}`}>
                        {g.status}
                      </span>
                    </div>
                    {g.owner && <div className="quarterly-owner">👤 {g.owner}</div>}
                    <div className="quarterly-goal-progress-row">
                      <div className="quarterly-goal-progress-bar">
                        <div style={{ width:`${g.progress||0}%`, height:"100%",
                          background:g.progress===100?"#10b981":"#6366f1", borderRadius:"99px",
                          transition:"width .3s" }} />
                      </div>
                      <span className="quarterly-pct">{g.progress||0}%</span>
                    </div>
                    <div className="quarterly-goal-footer">
                      <span style={{ color:CONFIDENCE_COLOR(conf), fontSize:"11px", fontWeight:600 }}>
                        🎯 {conf}% confidence
                      </span>
                      {g.keyResults?.length > 0 && (
                        <span className="quarterly-kr-count">{g.keyResults.length} KR{g.keyResults.length!==1?"s":""}</span>
                      )}
                      {children.length > 0 && (
                        <span className="quarterly-kr-count">🔗 {children.length} child{children.length!==1?"ren":""}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {quarterOrder.length === 0 && (
        <div className="empty-state">No goals yet. Create your first goal to start quarterly planning.</div>
      )}
    </div>
  );
}

function GoalCard({
  goal,
  allGoals,
  onEdit,
  onDelete,
  onUpdateProgress,
  onUpdateGoal,
  onRequestAddSubGoal,
  onRequestEditSubGoal,
  onRequestAddChildGoal,
  isExpanded,
  onToggleExpand,
  onRefresh,
}) {
  const handleDeleteSubGoal = async (subGoalId) => {
    const ok = await confirm({
      title: "Delete Sub-Goal?",
      message: "This will permanently delete the sub-goal and all its steps.",
      danger: true,
      confirmText: "Delete",
    });
    if (ok) {
      const res = await deleteSubGoal(goal.id, subGoalId);
      onUpdateGoal(res.data); // res.data = full updated Goal
    }
  };

  const subGoals = goal.subGoals || [];
  const [showActivity, setShowActivity]   = useState(false);
  const [activePanel, setActivePanel]     = useState(null); // "checkin" | "kr" | "children"
  const togglePanel = (p) => setActivePanel(v => v === p ? null : p);
  const levelMeta = LEVEL_META[goal.level] || LEVEL_META.COMPANY;
  const totalSteps = subGoals.reduce(
    (acc, sg) => acc + (sg.steps?.length || 0),
    0,
  );
  const doneSteps = subGoals.reduce(
    (acc, sg) => acc + (sg.steps?.filter((s) => s.completed).length || 0),
    0,
  );

  return (
    <div className="goal-card">
      {/* B-1: Level + quarter badges */}
      <div className="goal-card-badges">
        <span className="goal-level-badge" style={{ background:`${levelMeta.color}18`, color:levelMeta.color, borderColor:`${levelMeta.color}40` }}>
          {levelMeta.icon} {levelMeta.label}
        </span>
        {goal.quarter && <span className="goal-quarter-badge">{goal.quarter}</span>}
        {goal.owner && <span className="goal-owner-badge">👤 {goal.owner}</span>}
        {goal.parentGoalId && <span className="goal-child-indicator">↳ child goal</span>}
      </div>

      <div className="goal-card-header">
        <h3>{goal.title}</h3>
        <span className={`badge badge-${goal.status?.toLowerCase()}`}>
          {goal.status}
        </span>
      </div>

      <p className="project-desc">{goal.description}</p>

      {goal.targetDate && (
        <div className="goal-date">🎯 Target: {formatDate(goal.targetDate, true)}</div>
      )}

      {/* Overall Progress */}
      <div className="goal-progress-label">
        <span>Overall Progress</span>
        <span>{goal.progress || 0}%</span>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{
          width: `${goal.progress || 0}%`,
          background: goal.progress === 100 ? "#10b981" : "#6366f1",
        }} />
      </div>

      {/* B-2: Confidence meter */}
      <ConfidenceMeter goal={goal} onUpdate={onRefresh} />

      {/* Sub-goals summary */}
      {subGoals.length > 0 && (
        <div className="goal-stats-row">
          <span>📋 {subGoals.length} sub-goal{subGoals.length > 1 ? "s" : ""}</span>
          <span>🪜 {doneSteps}/{totalSteps} steps done</span>
        </div>
      )}

      {/* Actions */}
      <div className="goal-card-footer">
        <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
          <button className="btn-secondary" style={{ fontSize:"12px", padding:"6px 10px" }}
            onClick={onUpdateProgress}>Update Progress</button>
          <button className={`btn-secondary${isExpanded ? " btn-active" : ""}`}
            style={{ fontSize:"12px", padding:"6px 10px" }} onClick={onToggleExpand}>
            {isExpanded ? "▲" : "▼"} {subGoals.length > 0 ? `${subGoals.length} Sub-Goals` : "Sub-Goals"}
          </button>
          <button className={`btn-secondary${activePanel==="kr" ? " btn-active" : ""}`}
            style={{ fontSize:"12px", padding:"6px 10px" }} onClick={() => togglePanel("kr")}>
            🎯 KRs {goal.keyResults?.length > 0 ? `(${goal.keyResults.length})` : ""}
          </button>
          <button className={`btn-secondary${activePanel==="checkin" ? " btn-active" : ""}`}
            style={{ fontSize:"12px", padding:"6px 10px" }} onClick={() => togglePanel("checkin")}>
            📅 Check-ins {goal.checkIns?.length > 0 ? `(${goal.checkIns.length})` : ""}
          </button>
          <button className={`btn-secondary${activePanel==="children" ? " btn-active" : ""}`}
            style={{ fontSize:"12px", padding:"6px 10px" }} onClick={() => togglePanel("children")}>
            🔗 Children {(allGoals||[]).filter(g=>g.parentGoalId===goal.id).length > 0 ? `(${(allGoals||[]).filter(g=>g.parentGoalId===goal.id).length})` : ""}
          </button>
          <button className={`btn-secondary${activePanel==="contribution" ? " btn-active" : ""}`}
            style={{ fontSize:"12px", padding:"6px 10px" }} onClick={() => togglePanel("contribution")}>
            📈 Contribution
          </button>
          <button className={`btn-secondary${activePanel==="deps" ? " btn-active" : ""}`}
            style={{ fontSize:"12px", padding:"6px 10px" }} onClick={() => togglePanel("deps")}>
            🔀 Dependencies
          </button>
          <button className={`btn-secondary ${showActivity ? "btn-active" : ""}`}
            style={{ fontSize:"12px", padding:"6px 10px" }}
            onClick={() => setShowActivity(a => !a)}>📋 Activity</button>
        </div>
        <div className="card-actions">
          <CanDo action="edit">
            <button className="btn-icon" onClick={() => onEdit(goal)}>✏️</button>
          </CanDo>
          <CanDo action="delete">
            <button className="btn-icon" onClick={() => onDelete(goal.id)}>🗑️</button>
          </CanDo>
        </div>
      </div>

      {/* B-4: Key Results panel */}
      {activePanel === "kr" && (
        <KeyResultsPanel goal={goal} onUpdate={onRefresh} />
      )}

      {/* B-3: Check-in panel */}
      {activePanel === "checkin" && (
        <CheckInPanel goal={goal} onUpdate={onRefresh} />
      )}

      {/* B-1: Child goals */}
      {activePanel === "children" && (
        <ChildGoalsPanel goal={goal} allGoals={allGoals||[]} onRequestAdd={onRequestAddChildGoal} />
      )}

      {/* Goal Contribution panel */}
      {activePanel === "contribution" && (
        <GoalContributionPanel goal={goal} onUpdate={onRefresh} />
      )}

      {/* Goal Dependency Mapping panel */}
      {activePanel === "deps" && (
        <GoalDependencyPanel goal={goal} allGoals={allGoals||[]} onRefresh={onRefresh} />
      )}

      {/* Sub-goals section */}
      {isExpanded && (
        <div className="subgoals-container">
          <div className="subgoals-header">
            <span className="subgoals-label">Sub-Goals</span>
            <button
              className="btn-primary"
              style={{ fontSize: "11px", padding: "5px 10px" }}
              onClick={() => onRequestAddSubGoal(goal.id)}
            >
              + Add Sub-Goal
            </button>
          </div>

          {subGoals.length > 0 ? (
            subGoals.map((sg) => (
              <SubGoalCard
                key={sg.id}
                goalId={goal.id}
                subGoal={sg}
                onEdit={(s) => onRequestEditSubGoal(goal.id, s)}
                onDelete={handleDeleteSubGoal}
                onUpdateGoal={onUpdateGoal}
              />
            ))
          ) : (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <p
                style={{
                  color: "#aaa",
                  fontSize: "13px",
                  marginBottom: "10px",
                }}
              >
                No sub-goals yet.
              </p>
              <button
                className="btn-primary"
                style={{ fontSize: "12px" }}
                onClick={() => onRequestAddSubGoal(goal.id)}
              >
                + Add First Sub-Goal
              </button>
            </div>
          )}
        </div>
      )}
      {showActivity && (
        <div className="entity-activity-panel">
          <div className="entity-activity-panel-title">📋 Goal Activity</div>
          <EntityActivityTab entityType="goal" entityId={goal.id} />
        </div>
      )}
    </div>
  );
}

export default function Goals() {
  const { activeWorkspace } = useAuth();
  const [goals, setGoals] = useState([]);
  const { show: showToast } = useToast();
  const confirm = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [showProgress, setShowProgress] = useState(null);
  const [editing, setEditing] = useState(null);
  // SubGoal form lifted to root to prevent GoalCard re-render flicker
  const [subGoalForm, setSubGoalForm] = useState(null); // { goalId, editing: null | subGoal }
  // Expanded goal cards — stored at root so re-renders don't reset them
  const [expandedGoalIds, setExpandedGoalIds] = useState([]);
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const highlightColor = searchParams.get("hcolor") || "ef4444";
  const filterSpecial = searchParams.get("filter") || "";

  const load = async () => {
    const res = await getGoals();
    setGoals(unwrapList(res));
  };

  useEffect(() => {
    const fetchData = async () => {
      const res = await getGoals();
      setGoals(unwrapList(res));
    };
    fetchData();
  }, [activeWorkspace?.id]);

  const toggleGoalCard = (goalId) => {
    setExpandedGoalIds((prev) =>
      prev.includes(goalId)
        ? prev.filter((id) => id !== goalId)
        : [...prev, goalId],
    );
  };

  const handleAddSubGoal = async (form) => {
    if (!subGoalForm) return;
    const res = await addSubGoal(subGoalForm.goalId, form);
    setSubGoalForm(null);
    setGoals((prev) => prev.map((g) => (g.id === res.data.id ? res.data : g)));
  };

  const handleEditSubGoal = async (form) => {
    if (!subGoalForm?.editing) return;
    const res = await updateSubGoal(
      subGoalForm.goalId,
      subGoalForm.editing.id,
      form,
    );
    setSubGoalForm(null);
    setGoals((prev) => prev.map((g) => (g.id === res.data.id ? res.data : g)));
  };

  const handleSave = async (form) => {
    const payload = {
      ...form,
      targetDate: form.targetDate
        ? new Date(form.targetDate).toISOString()
        : null,
    };
    // Close form immediately to prevent double-submit
    setShowForm(false);
    setEditing(null);
    try {
      if (editing) await updateGoal(editing.id, payload);
      else await createGoal(payload);
      load();
    } catch (e) {
      // Re-open form on failure
      setShowForm(true);
      showToast(e.response?.data?.message || "Failed to save goal", "error");
    }
  };

  const handleProgress = async (progress) => {
    await updateGoalProgress(showProgress.id, progress);
    setShowProgress(null);
    load();
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: "Delete this goal?",
      message:
        "This will permanently delete the goal and all its sub-goals and steps.",
      danger: true,
      confirmText: "Delete Goal",
    });
    if (ok) {
      // Optimistic: remove from UI immediately
      setGoals((prev) => prev.filter((g) => g.id !== id));
      try {
        await deleteGoal(id);
        showToast("Goal deleted successfully", "success");
      } catch (err) {
        load();
        const errMsg =
          err.response?.data?.message ||
          err.response?.data?.error ||
          (typeof err.response?.data === "string" ? err.response.data : null) ||
          err.message ||
          "Failed to delete goal";
        showToast(errMsg, "error");
      }
    }
  };

  const handleExportCSV = () => {
    const data = filtered.map((g) => ({
      Title: g.title,
      Status: g.status,
      Progress: `${g.progress || 0}%`,
      TargetDate: g.targetDate
        ? new Date(g.targetDate).toLocaleDateString()
        : "None",
      SubGoals: g.subGoals?.length || 0,
      Description: g.description || "",
    }));
    exportToCSV(data, "goals");
  };

  const handleExportPDF = () => {
    const columns = ["Title", "Status", "Progress", "Target Date", "Sub-Goals"];
    const rows = filtered.map((g) => [
      g.title,
      g.status,
      `${g.progress || 0}%`,
      g.targetDate ? new Date(g.targetDate).toLocaleDateString() : "None",
      g.subGoals?.length || 0,
    ]);
    exportToPDF("Goals Report", columns, rows, "goals");
  };

  const [levelFilter,   setLevelFilter]   = useState("");
  const [quarterFilter, setQuarterFilter] = useState("");
  const [statusFilter,  setStatusFilter]  = useState("");
  const [view, setView] = useState("grid"); // "grid" | "scorecard" | "quarterly"

  const filtered = goals.filter((g) => {
    if (filterSpecial === "overdue") {
      return g.targetDate && new Date(g.targetDate) < new Date() && g.status !== "ACHIEVED";
    }
    if (levelFilter   && g.level   !== levelFilter)   return false;
    if (quarterFilter && g.quarter !== quarterFilter)  return false;
    if (statusFilter  && g.status  !== statusFilter)   return false;
    return true;
  });

  // Unique quarters from data
  const usedQuarters = [...new Set(goals.map(g => g.quarter).filter(Boolean))];

  return (
    <div>
      <PageHeader
        icon="🎯"
        title="Goals"
        description="Set goals, create sub-goals, and track steps to achieve them"
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
            <div className="goal-view-switcher">
              <button className={`goal-view-btn${view==="grid"?" active":""}`} onClick={() => setView("grid")} title="Card grid">⊞ Grid</button>
              <button className={`goal-view-btn${view==="scorecard"?" active":""}`} onClick={() => setView("scorecard")} title="Scorecard">📊 Scorecard</button>
              <button className={`goal-view-btn${view==="quarterly"?" active":""}`} onClick={() => setView("quarterly")} title="Quarterly plan">🗓 Quarterly</button>
              <button className={`goal-view-btn${view==="alignment"?" active":""}`} onClick={() => setView("alignment")} title="Alignment map">🕸 Alignment</button>
            </div>
            <CanDo action="create">
              <button className="btn-primary" onClick={() => setShowForm(true)}>
                + New Goal
              </button>
            </CanDo>
          </div>
        }
      />
      {filterSpecial === "overdue" && (
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
              background: "#fff5f5",
              color: "#ef4444",
              padding: "4px 12px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: 600,
              border: "1px solid #fecaca",
            }}
          >
            ⚠️ Showing Overdue Goals
          </span>
        </div>
      )}

      {/* B-1: Level / Quarter / Status filter bar */}
      <div className="goal-filter-bar">
        <div className="goal-filter-group">
          <span className="goal-filter-label">Level</span>
          {LEVELS.map(l => (
            <button key={l}
              className={`goal-filter-btn${levelFilter === l ? " active" : ""}`}
              style={levelFilter === l ? { background:`${LEVEL_META[l].color}18`, color:LEVEL_META[l].color, borderColor:`${LEVEL_META[l].color}40` } : {}}
              onClick={() => setLevelFilter(v => v === l ? "" : l)}>
              {LEVEL_META[l].icon} {LEVEL_META[l].label}
            </button>
          ))}
        </div>
        {usedQuarters.length > 0 && (
          <div className="goal-filter-group">
            <span className="goal-filter-label">Quarter</span>
            {usedQuarters.map(q => (
              <button key={q}
                className={`goal-filter-btn${quarterFilter === q ? " active" : ""}`}
                onClick={() => setQuarterFilter(v => v === q ? "" : q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        <div className="goal-filter-group">
          {STATUSES.map(s => (
            <button key={s}
              className={`goal-filter-btn${statusFilter === s ? " active" : ""}`}
              onClick={() => setStatusFilter(v => v === s ? "" : s)}>
              {s}
            </button>
          ))}
        </div>
        <span className="goal-filter-count">{filtered.length} goal{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* B-5: Scorecard view */}
      {view === "scorecard"  && <ScorecardView goals={filtered} />}
      {/* A-5: Alignment map */}
      {view === "alignment"  && <AlignmentMap  goals={goals} />}

      {/* B-6: Quarterly view */}
      {view === "quarterly" && (
        <QuarterlyView
          goals={filtered}
          allGoals={goals}
          onRequestAdd={(parentId) => { setEditing({ parentGoalId: parentId }); setShowForm(true); }}
          onRefresh={load}
        />
      )}

      {/* Default: card grid */}
      {view === "grid" && <div className="cards-grid">
        {filtered.map((g) => (
          <div
            key={g.id}
            className={highlightId === g.id ? "task-row-highlight" : ""}
            ref={
              highlightId === g.id
                ? (el) =>
                    el?.scrollIntoView({ behavior: "smooth", block: "center" })
                : null
            }
            style={
              highlightId === g.id
                ? {
                    "--highlight-color": `#${highlightColor}`,
                    "--highlight-bg": `#${highlightColor}11`,
                    "--highlight-shadow": `rgba(${parseInt(highlightColor.slice(0, 2), 16)},${parseInt(highlightColor.slice(2, 4), 16)},${parseInt(highlightColor.slice(4, 6), 16)},0.2)`,
                  }
                : undefined
            }
          >
            <GoalCard
              goal={g}
              allGoals={goals}
              onEdit={(goal) => {
                setEditing({
                  ...goal,
                  targetDate: goal.targetDate ? goal.targetDate.slice(0, 16) : "",
                });
                setShowForm(true);
              }}
              onDelete={handleDelete}
              onUpdateProgress={() => setShowProgress(g)}
              onUpdateGoal={(updatedGoal) =>
                setGoals((prev) => prev.map((g) => (g.id === updatedGoal.id ? updatedGoal : g)))
              }
              onRefresh={load}
              isExpanded={expandedGoalIds.includes(g.id)}
              onToggleExpand={() => toggleGoalCard(g.id)}
              onRequestAddSubGoal={(goalId) => setSubGoalForm({ goalId, editing: null })}
              onRequestEditSubGoal={(goalId, sub) => setSubGoalForm({ goalId, editing: sub })}
              onRequestAddChildGoal={(parentId) => {
                setEditing({ parentGoalId: parentId });
                setShowForm(true);
              }}
            />
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="empty-state">No goals yet. Set your first goal!</p>
        )}
      </div>}

      {/* SubGoalForm rendered at root — prevents GoalCard flicker */}
      {subGoalForm && !subGoalForm.editing && (
        <SubGoalForm
          onSave={handleAddSubGoal}
          onCancel={() => setSubGoalForm(null)}
        />
      )}
      {subGoalForm?.editing && (
        <SubGoalForm
          initial={subGoalForm.editing}
          onSave={handleEditSubGoal}
          onCancel={() => setSubGoalForm(null)}
        />
      )}

      {showForm && (
        <GoalForm
          initial={editing}
          allGoals={goals}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}
      {showProgress && (
        <ProgressModal
          goal={showProgress}
          onSave={handleProgress}
          onCancel={() => setShowProgress(null)}
        />
      )}
    </div>
  );
}