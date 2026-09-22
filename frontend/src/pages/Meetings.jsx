import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getMeetings, createMeeting, updateMeeting, deleteMeeting,
  extractMeeting, markActionConverted,
  getMeetingsPrepare, getMeetingContinuity, getMeetingWhatsChanged,
  upsertProjectDiscussion, addActionItemForProject, carryActionItemIntoMeeting,
  addBlockerForProject, carryBlockerIntoMeeting,
  addDecisionForProject, carryDecisionIntoMeeting,
} from "../api/meetings";
import {
  completeMeetingActionItem, deferMeetingActionItem, dismissMeetingActionItem,
} from "../api/meetingActionItems";
import { createTask }    from "../api/tasks";
import { getProjects }   from "../api/projects";
import { getTeamMembers }from "../api/team";
import { useAuth }       from "../hooks/useAuth";
import { useToast }      from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import PageHeader        from "../components/PageHeader";
import MeetingContinuityPanel from "../components/MeetingContinuityPanel";
import MeetingTrendsPanel from "../components/MeetingTrendsPanel";

import "../styles/pages/meetings.css";
// ── Helpers ────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { day:"numeric", month:"short", year:"numeric" });
}
function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
}
function projectNameFor(projects, id) {
  return projects?.find(p => p.id === id)?.name || "Unknown project";
}

const PRIORITY_COLOR = { HIGH:"var(--danger)", MEDIUM:"var(--warning)", LOW:"var(--success)" };

const MEETING_TYPES = [
  { value: "STANDUP", label: "Morning Stand-up" },
  { value: "EOD",      label: "Evening Meeting" },
  { value: "REVIEW",   label: "Project Review" },
  { value: "OTHER",    label: "Other" },
];
const PROJECT_STATUS_OPTIONS = ["NOT_STARTED","IN_PROGRESS","ON_TRACK","AT_RISK","BLOCKED","COMPLETED"];
const QUICK_UPDATE_OPTIONS = [
  { value: "NO_CHANGE",       label: "No change" },
  { value: "PROGRESS",        label: "Progress" },
  { value: "BLOCKED",         label: "Blocked" },
  { value: "COMPLETED",       label: "Completed" },
  { value: "NEEDS_DISCUSSION",label: "Needs discussion" },
];
const STATUS_BADGE_COLOR = {
  NOT_STARTED: "var(--gray-400)", IN_PROGRESS: "var(--brand-500)", ON_TRACK: "var(--success)",
  AT_RISK: "var(--warning)", BLOCKED: "var(--danger)", COMPLETED: "var(--success)",
};

// ── Meeting Form Modal ─────────────────────────────────────────
const EMPTY = {
  title:"", agenda:"", notes:"", attendees:"",
  meetingDate: new Date().toISOString().slice(0,16), status:"COMPLETED",
  meetingType: "OTHER", projectDiscussions: [],
};

function MeetingFormModal({ initial, prefill, projects, wsId, onSave, onCancel }) {
  const [form, setForm]     = useState(() => initial
    ? { ...initial, attendees: initial.attendees?.join(", ") || "",
        meetingDate: initial.meetingDate?.slice(0,16) || "",
        meetingType: initial.meetingType || "OTHER" }
    : { ...EMPTY, ...(prefill?.form || {}) });
  const [projectBlocks, setProjectBlocks] = useState(() =>
    (initial?.projectDiscussions || prefill?.projectDiscussions || []).map(pd => ({
      projectId: pd.projectId, statusSnapshot: pd.statusSnapshot || "",
      quickUpdate: pd.quickUpdate || "", discussionNotes: pd.discussionNotes || "",
    })));
  const [extracting, setExtracting] = useState(false);
  const [extracted,  setExtracted]  = useState(null);  // AI result
  const [saving,     setSaving]     = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addProjectBlock = () => setProjectBlocks(b => [...b, { projectId: "", statusSnapshot: "IN_PROGRESS", quickUpdate: "", discussionNotes: "" }]);
  const updateProjectBlock = (i, patch) => setProjectBlocks(b => b.map((blk, idx) => idx === i ? { ...blk, ...patch } : blk));
  const removeProjectBlock = (i) => setProjectBlocks(b => b.filter((_, idx) => idx !== i));

  const handleExtract = async () => {
    if (!form.notes.trim()) return;
    setExtracting(true);
    try {
      const r = await extractMeeting(form.notes);
      const d = r.data || {};
      setExtracted(d);
      if (d.summary) set("summary", d.summary);
    } catch { setExtracted(null); }
    finally { setExtracting(false); }
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        workspaceId: wsId,
        attendees: form.attendees ? form.attendees.split(",").map(a => a.trim()).filter(Boolean) : [],
        meetingDate: form.meetingDate ? new Date(form.meetingDate).toISOString() : null,
        meetingType: form.meetingType || "OTHER",
        projectDiscussions: projectBlocks.filter(b => b.projectId),
        actionItems: extracted?.actionItems?.map((a, i) => ({
          id: `ai_${i}_${Date.now()}`,
          title: a.title,
          assignee: a.assignee || "",
          dueDate:  a.dueDate  || "",
          priority: a.priority || "MEDIUM",
          converted: false,
        })) || initial?.actionItems || [],
      };
      await onSave(payload);
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onCancel} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onCancel)?.(e); } }}>
      <div className="modal meet-modal" onClick={e => e.stopPropagation()} role="presentation">
        <div className="meet-modal-header">
          <h2>{initial ? "Edit Meeting" : "New Meeting Notes"}</h2>
          <button className="meet-modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="meet-modal-body">
          {/* Left column: form fields */}
          <div className="meet-form-col">
            <div className="form-group">
              <label htmlFor={"meetings-meeting-title"}>Meeting title *</label>
              <input value={form.title}
                onChange={e => set("title", e.target.value)}
                placeholder="e.g. Sprint Planning — Week 23" id={"meetings-meeting-title"} />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor={"meetings-date-time"}>Date & time</label>
                <input type="datetime-local" value={form.meetingDate}
                  onChange={e => set("meetingDate", e.target.value)} id={"meetings-date-time"} />
              </div>
              <div className="form-group">
                <label htmlFor={"meetings-type"}>Meeting type</label>
                <select value={form.meetingType} onChange={e => set("meetingType", e.target.value)} id={"meetings-type"}>
                  {MEETING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor={"meetings-status"}>Status</label>
                <select value={form.status} onChange={e => set("status", e.target.value)} id={"meetings-status"}>
                  <option value="SCHEDULED">Scheduled</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor={"meetings-attendees-comma-separated"}>Attendees (comma separated)</label>
              <input value={form.attendees}
                onChange={e => set("attendees", e.target.value)}
                placeholder="alice@co.com, bob@co.com" id={"meetings-attendees-comma-separated"} />
            </div>

            <div className="form-group">
              <label>Projects discussed</label>
              {projectBlocks.map((blk, i) => (
                <div key={i} className="meet-project-block">
                  <div className="meet-project-block-row">
                    <select value={blk.projectId} onChange={e => updateProjectBlock(i, { projectId: e.target.value })}>
                      <option value="">Select project…</option>
                      {projects?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <select value={blk.statusSnapshot} onChange={e => updateProjectBlock(i, { statusSnapshot: e.target.value })}>
                      {PROJECT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace("_"," ")}</option>)}
                    </select>
                    <button type="button" className="meet-project-remove" onClick={() => removeProjectBlock(i)}>✕</button>
                  </div>
                  <div className="meet-quick-update-row">
                    {QUICK_UPDATE_OPTIONS.map(q => (
                      <button key={q.value} type="button"
                        className={`meet-quick-btn${blk.quickUpdate === q.value ? " active" : ""}`}
                        onClick={() => updateProjectBlock(i, { quickUpdate: q.value })}>
                        {q.label}
                      </button>
                    ))}
                  </div>
                  {blk.quickUpdate !== "NO_CHANGE" && (
                    <textarea rows={2} placeholder="What was discussed about this project?"
                      value={blk.discussionNotes}
                      onChange={e => updateProjectBlock(i, { discussionNotes: e.target.value })} />
                  )}
                </div>
              ))}
              <button type="button" className="meet-add-project-btn" onClick={addProjectBlock}>+ Add project</button>
            </div>

            <div className="form-group">
              <label htmlFor={"meetings-agenda"}>Agenda</label>
              <textarea rows={2} value={form.agenda}
                onChange={e => set("agenda", e.target.value)}
                placeholder="What was on the agenda?" id={"meetings-agenda"} />
            </div>

            <div className="form-group">
              <label htmlFor={"meetings-notes-transcript"}>Notes / Transcript</label>
              <textarea rows={8} value={form.notes}
                onChange={e => set("notes", e.target.value)}
                placeholder="Paste meeting notes, transcript, or bullet points here…" id={"meetings-notes-transcript"} />
            </div>

            <button
              className={`meet-extract-btn${extracting ? " loading" : ""}`}
              onClick={handleExtract}
              disabled={extracting || !form.notes.trim()}>
              {extracting ? "🤖 Extracting…" : "🤖 Extract with AI"}
            </button>
          </div>

          {/* Right column: AI results */}
          {extracted && (
            <div className="meet-ai-col">
              <div className="meet-ai-label">🤖 AI Extraction Results</div>

              {extracted.summary && (
                <div className="meet-ai-section">
                  <div className="meet-ai-section-title">Summary</div>
                  <p className="meet-ai-summary">{extracted.summary}</p>
                </div>
              )}

              {extracted.decisions?.length > 0 && (
                <div className="meet-ai-section">
                  <div className="meet-ai-section-title">Decisions</div>
                  {extracted.decisions.map((d, i) => (
                    <div key={i} className="meet-ai-decision">⚖️ {d}</div>
                  ))}
                </div>
              )}

              {extracted.actionItems?.length > 0 && (
                <div className="meet-ai-section">
                  <div className="meet-ai-section-title">
                    Action Items ({extracted.actionItems.length})
                  </div>
                  {extracted.actionItems.map((a, i) => (
                    <div key={i} className="meet-ai-action">
                      <span className="meet-ai-action-dot"
                        style={{ background: PRIORITY_COLOR[a.priority] || "var(--warning)" }} />
                      <div className="meet-ai-action-body">
                        <div className="meet-ai-action-title">{a.title}</div>
                        <div className="meet-ai-action-meta">
                          {a.assignee && <span>👤 {a.assignee}</span>}
                          {a.dueDate  && <span>📅 {a.dueDate}</span>}
                          <span className="meet-ai-priority"
                            style={{ color: PRIORITY_COLOR[a.priority] || "var(--warning)" }}>
                            {a.priority}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="form-actions meet-modal-footer">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" disabled={saving || !form.title.trim()} onClick={handleSave}>
            {saving ? "⏳ Saving…" : initial ? "Update Meeting" : "Save Meeting"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Meeting Card ───────────────────────────────────────────────
function MeetingCard({ m, projects, onEdit, onDelete, onTaskCreated, onRefresh }) {
  const [expanded,   setExpanded]   = useState(false);
  const [converting, setConverting] = useState(null);
  const [continuity, setContinuity] = useState(null);
  const [whatsChanged, setWhatsChanged] = useState(null);
  const [loadingContinuity, setLoadingContinuity] = useState(false);
  const [newAction, setNewAction] = useState({}); // { [projectId]: { title, owner, dueDate } }
  const [newBlocker, setNewBlocker] = useState({}); // { [projectId]: { title, owner, impact } }
  const [newDecision, setNewDecision] = useState({}); // { [projectId]: { title } }
  const [activeAddType, setActiveAddType] = useState({}); // { [projectId]: 'blocker' | 'decision' | null }
  const { show: toast } = useToast();

  const loadContinuity = useCallback(async () => {
    setLoadingContinuity(true);
    try {
      const [cr, wr] = await Promise.all([
        getMeetingContinuity(m.id),
        getMeetingWhatsChanged(m.id),
      ]);
      setContinuity(cr.data);
      setWhatsChanged(wr.data);
    } catch { /* continuity is supplementary — card still works without it */ }
    finally { setLoadingContinuity(false); }
  }, [m.id]);

  const handleExpand = () => {
    setExpanded(v => {
      const next = !v;
      if (next && !continuity) loadContinuity();
      return next;
    });
  };

  const handleConvert = async (action) => {
    setConverting(action.id);
    try {
      const r = await createTask({
        title:       action.title,
        priority:    action.priority || "MEDIUM",
        dueDate:     action.dueDate  || null,
        assignees:   action.assignee ? [action.assignee] : [],
        description: `Action item from meeting: ${m.title}`,
      });
      const taskId = r.data?.data?.id || r.data?.id;
      await markActionConverted(m.id, action.id, taskId || "done");
      toast?.("Task created from action item", "success");
      onTaskCreated?.();
    } catch { toast?.("Failed to create task", "error"); }
    finally { setConverting(null); }
  };

  const handleCompleteAction = async (item) => {
    try { await completeMeetingActionItem(item.id, m.id); toast?.("Marked complete", "success"); loadContinuity(); }
    catch { toast?.("Failed to update", "error"); }
  };
  const handleDismissAction = async (item) => {
    try { await dismissMeetingActionItem(item.id, m.id); toast?.("Dismissed", "success"); loadContinuity(); }
    catch { toast?.("Failed to update", "error"); }
  };
  const handleDeferAction = async (item) => {
    try { await deferMeetingActionItem(item.id, null, m.id); toast?.("Deferred to next meeting", "success"); loadContinuity(); }
    catch { toast?.("Failed to update", "error"); }
  };
  const handleCarryAction = async (item, projectId) => {
    try { await carryActionItemIntoMeeting(m.id, projectId || item.projectIds?.[0], item.id); toast?.("Carried into this meeting", "success"); loadContinuity(); onRefresh?.(); }
    catch { toast?.("Failed to carry item forward", "error"); }
  };
  const handleCarryBlocker = async (entry, projectId) => {
    try { await carryBlockerIntoMeeting(m.id, projectId || entry.projectId, entry.id); toast?.("Carried into this meeting", "success"); loadContinuity(); onRefresh?.(); }
    catch { toast?.("Failed to carry item forward", "error"); }
  };
  const handleCarryDecision = async (decision, projectId) => {
    try { await carryDecisionIntoMeeting(m.id, projectId || decision.linkedProjectIds?.[0], decision.id); toast?.("Carried into this meeting", "success"); loadContinuity(); onRefresh?.(); }
    catch { toast?.("Failed to carry item forward", "error"); }
  };

  const handleAddAction = async (projectId) => {
    const draft = newAction[projectId];
    if (!draft?.title?.trim()) return;
    try {
      await addActionItemForProject(m.id, projectId, {
        title: draft.title,
        owner: draft.owner || "",
        dueDate: draft.dueDate ? new Date(draft.dueDate).toISOString() : null,
      });
      setNewAction(n => ({ ...n, [projectId]: {} }));
      toast?.("Action item added", "success");
      loadContinuity();
      onRefresh?.();
    } catch { toast?.("Failed to add action item", "error"); }
  };

  const handleAddBlocker = async (projectId) => {
    const draft = newBlocker[projectId];
    if (!draft?.title?.trim()) return;
    try {
      await addBlockerForProject(m.id, projectId, {
        title: draft.title, owner: draft.owner || "", impact: draft.impact || "MEDIUM",
      });
      setNewBlocker(n => ({ ...n, [projectId]: {} }));
      setActiveAddType(a => ({ ...a, [projectId]: null }));
      toast?.("Blocker added", "success");
      loadContinuity();
      onRefresh?.();
    } catch { toast?.("Failed to add blocker", "error"); }
  };

  const handleAddDecision = async (projectId) => {
    const draft = newDecision[projectId];
    if (!draft?.title?.trim()) return;
    try {
      await addDecisionForProject(m.id, projectId, { title: draft.title });
      setNewDecision(n => ({ ...n, [projectId]: {} }));
      setActiveAddType(a => ({ ...a, [projectId]: null }));
      toast?.("Decision logged", "success");
      loadContinuity();
      onRefresh?.();
    } catch { toast?.("Failed to log decision", "error"); }
  };

  const toggleAddType = (projectId, type) => {
    setActiveAddType(a => ({ ...a, [projectId]: a[projectId] === type ? null : type }));
  };

  const unconverted = m.actionItems?.filter(a => !a.converted) || [];
  const converted   = m.actionItems?.filter(a =>  a.converted) || [];
  const meetingTypeLabel = MEETING_TYPES.find(t => t.value === m.meetingType)?.label;

  return (
    <div className="meet-card">
      <div className="meet-card-header" onClick={handleExpand} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleExpand(); } }}>
        <div className="meet-card-left">
          <span className="meet-card-chevron">{expanded ? "▾" : "▸"}</span>
          <div>
            <div className="meet-card-title">{m.title}{meetingTypeLabel && <span className="meet-type-tag">{meetingTypeLabel}</span>}</div>
            <div className="meet-card-meta">
              {m.meetingDate && <span>📅 {fmtDate(m.meetingDate)} {fmtTime(m.meetingDate)}</span>}
              {m.attendees?.length > 0 && (
                <span>👥 {m.attendees.slice(0,3).join(", ")}{m.attendees.length > 3 ? ` +${m.attendees.length-3}` : ""}</span>
              )}
              {unconverted.length > 0 && (
                <span className="meet-action-badge">{unconverted.length} action{unconverted.length > 1 ? "s" : ""}</span>
              )}
            </div>
          </div>
        </div>
        <div className="meet-card-right" onClick={e => e.stopPropagation()} role="presentation">
          <span className={`meet-status meet-status--${m.status?.toLowerCase()}`}>{m.status}</span>
          <button onClick={() => onEdit(m)} title="Edit">✎</button>
          <button onClick={() => onDelete(m)} title="Delete" className="meet-delete-btn">🗑</button>
        </div>
      </div>

      {expanded && (
        <div className="meet-card-body">
          {/* Since Last Meeting */}
          {whatsChanged?.hasPrevious && (
            <div className="meet-section">
              <div className="meet-section-label">🔄 Since Last Meeting</div>
              <div className="meet-whats-changed">
                {whatsChanged.completedActionItems?.length > 0 && (
                  <div>✅ {whatsChanged.completedActionItems.length} action item{whatsChanged.completedActionItems.length > 1 ? "s" : ""} completed</div>
                )}
                {whatsChanged.newActionItems?.length > 0 && (
                  <div>🆕 {whatsChanged.newActionItems.length} new action item{whatsChanged.newActionItems.length > 1 ? "s" : ""}</div>
                )}
                {whatsChanged.newBlockers?.length > 0 && (
                  <div>🚧 {whatsChanged.newBlockers.length} new blocker{whatsChanged.newBlockers.length > 1 ? "s" : ""}</div>
                )}
                {whatsChanged.resolvedBlockers?.length > 0 && (
                  <div>✔️ {whatsChanged.resolvedBlockers.length} blocker{whatsChanged.resolvedBlockers.length > 1 ? "s" : ""} resolved</div>
                )}
                {whatsChanged.newDecisions?.length > 0 && (
                  <div>⚖️ {whatsChanged.newDecisions.length} new decision{whatsChanged.newDecisions.length > 1 ? "s" : ""}</div>
                )}
                {whatsChanged.projectStatusChanges?.map((c, i) => (
                  <div key={i}>📊 {projectNameFor(projects, c.projectId)}: {c.from?.replace("_"," ")} → {c.to?.replace("_"," ")}</div>
                ))}
                {!whatsChanged.completedActionItems?.length && !whatsChanged.newActionItems?.length
                  && !whatsChanged.newBlockers?.length && !whatsChanged.resolvedBlockers?.length
                  && !whatsChanged.newDecisions?.length && !whatsChanged.projectStatusChanges?.length && (
                  <div className="meet-no-change">No changes since the last meeting.</div>
                )}
              </div>
            </div>
          )}

          {/* Continuity — carry-forward context scoped to this meeting's projects */}
          {loadingContinuity && !continuity && <div className="meet-section meet-loading-inline">Loading continuity…</div>}
          {continuity && (
            <div className="meet-section">
              <MeetingContinuityPanel
                data={continuity} projects={projects} title="Carried forward into this meeting"
                onCompleteActionItem={handleCompleteAction}
                onDeferActionItem={handleDeferAction}
                onDismissActionItem={handleDismissAction}
                onCarryActionItem={(item) => handleCarryAction(item)}
                onCarryBlocker={(entry) => handleCarryBlocker(entry)}
                onCarryDecision={(decision) => handleCarryDecision(decision)}
              />
            </div>
          )}

          {/* Projects Discussed */}
          {m.projectDiscussions?.length > 0 && (
            <div className="meet-section">
              <div className="meet-section-label">📁 Projects Discussed</div>
              {m.projectDiscussions.map(pd => (
                <div key={pd.id || pd.projectId} className="meet-project-discussion">
                  <div className="meet-project-discussion-header">
                    <span className="meet-project-discussion-name">{projectNameFor(projects, pd.projectId)}</span>
                    {pd.statusSnapshot && (
                      <span className="meet-status-badge" style={{ background: (STATUS_BADGE_COLOR[pd.statusSnapshot] || "var(--gray-400)") + "22", color: STATUS_BADGE_COLOR[pd.statusSnapshot] || "var(--gray-500)" }}>
                        {pd.statusSnapshot.replace("_"," ")}
                      </span>
                    )}
                  </div>
                  {pd.discussionNotes && <p className="meet-notes-text">{pd.discussionNotes}</p>}

                  <div className="meet-inline-add">
                    <input placeholder="+ Quick add action item…"
                      value={newAction[pd.projectId]?.title || ""}
                      onChange={e => setNewAction(n => ({ ...n, [pd.projectId]: { ...n[pd.projectId], title: e.target.value } }))}
                      onKeyDown={e => { if (e.key === "Enter") handleAddAction(pd.projectId); }} />
                    <input className="meet-inline-add-narrow" placeholder="Owner"
                      value={newAction[pd.projectId]?.owner || ""}
                      onChange={e => setNewAction(n => ({ ...n, [pd.projectId]: { ...n[pd.projectId], owner: e.target.value } }))}
                      onKeyDown={e => { if (e.key === "Enter") handleAddAction(pd.projectId); }} />
                    <input type="date" className="meet-inline-add-narrow"
                      value={newAction[pd.projectId]?.dueDate || ""}
                      onChange={e => setNewAction(n => ({ ...n, [pd.projectId]: { ...n[pd.projectId], dueDate: e.target.value } }))} />
                    <button className="cont-btn" onClick={() => handleAddAction(pd.projectId)}>Add</button>
                  </div>

                  <div className="meet-add-type-toggles">
                    <button className={`meet-toggle-btn${activeAddType[pd.projectId] === "blocker" ? " active" : ""}`}
                      onClick={() => toggleAddType(pd.projectId, "blocker")}>🚧 + Blocker</button>
                    <button className={`meet-toggle-btn${activeAddType[pd.projectId] === "decision" ? " active" : ""}`}
                      onClick={() => toggleAddType(pd.projectId, "decision")}>⚖️ + Decision</button>
                  </div>

                  {activeAddType[pd.projectId] === "blocker" && (
                    <div className="meet-inline-add">
                      <input placeholder="What's blocking progress?"
                        value={newBlocker[pd.projectId]?.title || ""}
                        onChange={e => setNewBlocker(n => ({ ...n, [pd.projectId]: { ...n[pd.projectId], title: e.target.value } }))}
                        onKeyDown={e => { if (e.key === "Enter") handleAddBlocker(pd.projectId); }} />
                      <input className="meet-inline-add-narrow" placeholder="Owner"
                        value={newBlocker[pd.projectId]?.owner || ""}
                        onChange={e => setNewBlocker(n => ({ ...n, [pd.projectId]: { ...n[pd.projectId], owner: e.target.value } }))}
                        onKeyDown={e => { if (e.key === "Enter") handleAddBlocker(pd.projectId); }} />
                      <button className="cont-btn" onClick={() => handleAddBlocker(pd.projectId)}>Add</button>
                    </div>
                  )}

                  {activeAddType[pd.projectId] === "decision" && (
                    <div className="meet-inline-add">
                      <input placeholder="What was decided (or needs deciding)?"
                        value={newDecision[pd.projectId]?.title || ""}
                        onChange={e => setNewDecision(n => ({ ...n, [pd.projectId]: { ...n[pd.projectId], title: e.target.value } }))}
                        onKeyDown={e => { if (e.key === "Enter") handleAddDecision(pd.projectId); }} />
                      <button className="cont-btn" onClick={() => handleAddDecision(pd.projectId)}>Add</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Summary */}
          {m.summary && (
            <div className="meet-section">
              <div className="meet-section-label">📝 Summary</div>
              <p className="meet-summary-text">{m.summary}</p>
            </div>
          )}

          {/* Notes */}
          {m.notes && !m.summary && (
            <div className="meet-section">
              <div className="meet-section-label">📋 Notes</div>
              <p className="meet-notes-text">{m.notes.slice(0, 400)}{m.notes.length > 400 ? "…" : ""}</p>
            </div>
          )}

          {/* Action items */}
          {m.actionItems?.length > 0 && (
            <div className="meet-section">
              <div className="meet-section-label">
                ✅ Action Items
                <span className="meet-action-progress">
                  {converted.length}/{m.actionItems.length} converted to tasks
                </span>
              </div>
              <div className="meet-actions-list">
                {m.actionItems.map(a => (
                  <div key={a.id} className={`meet-action-row${a.converted ? " converted" : ""}`}>
                    <span className="meet-action-dot"
                      style={{ background: a.converted ? "var(--success)" : (PRIORITY_COLOR[a.priority] || "var(--warning)") }} />
                    <div className="meet-action-body">
                      <span className="meet-action-title">{a.title}</span>
                      <span className="meet-action-meta">
                        {a.assignee && <span>👤 {a.assignee}</span>}
                        {a.dueDate  && <span>📅 {a.dueDate}</span>}
                      </span>
                    </div>
                    {!a.converted ? (
                      <button
                        className="meet-convert-btn"
                        disabled={converting === a.id}
                        onClick={() => handleConvert(a)}>
                        {converting === a.id ? "⏳" : "→ Task"}
                      </button>
                    ) : (
                      <span className="meet-converted-badge">✓ Task created</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────
export default function Meetings() {
  const { activeWorkspace } = useAuth();
  const { show: toast } = useToast();
  const confirm = useConfirm();
  const wsId    = activeWorkspace?.id;
  const [searchParams, setSearchParams] = useSearchParams();

  const [meetings,  setMeetings]  = useState([]);
  const [projects,  setProjects]  = useState([]);
  const [members,   setMembers]   = useState([]);
  const [prepareData, setPrepareData] = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [editing,   setEditing]   = useState(null);
  const [prefill,   setPrefill]   = useState(null);
  const [searchQ,   setSearchQ]   = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterProjectId, setFilterProjectId] = useState(searchParams.get("projectId") || "");

  const load = useCallback(async () => {
    if (!wsId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [mr, pr, tr] = await Promise.all([
        getMeetings(wsId),
        getProjects(),
        getTeamMembers(),
      ]);
      const ml = mr.data?.data ?? mr.data ?? [];
      setMeetings(ml);
      setProjects(Array.isArray(pr.data) ? pr.data : []);
      setMembers(Array.isArray(tr.data) ? tr.data : (tr.data?.data ?? []));
    } catch (e) { if (e?.response?.status !== 404) toast?.("Failed to load meetings", "error"); }
    finally { setLoading(false); }
  }, [wsId, toast]);

  const loadPrepareData = useCallback(async () => {
    if (!wsId) return;
    try {
      const r = await getMeetingsPrepare();
      setPrepareData(r.data);
    } catch { /* prepare panel is supplementary */ }
  }, [wsId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern
    load();
    loadPrepareData();
  }, [load, loadPrepareData]);

  // Deep-link support: arriving here from a Project card's "New meeting
  // for this project" / "View meetings" actions (see Projects.jsx). Opens
  // the create form pre-scoped to that project, or opens an existing
  // meeting directly, then clears the query param so a refresh doesn't
  // re-trigger it.
  useEffect(() => {
    const projectIdParam = searchParams.get("projectId");
    const openParam       = searchParams.get("open");

    if (openParam && meetings.length > 0) {
      const target = meetings.find(m => m.id === openParam);
      if (target) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- deep-link open, mirrors this file's own load-on-mount pattern above
        setEditing(target);
        setShowForm(true);
      }
      setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete("open"); return p; }, { replace: true });
      return;
    }

    if (projectIdParam && !showForm && projects.length > 0) {
      setEditing(null);
      setPrefill({ projectDiscussions: [{ projectId: projectIdParam, statusSnapshot: "IN_PROGRESS" }] });
      setShowForm(true);
      setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete("projectId"); return p; }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings, projects, searchParams]);

  const handleSave = async (payload) => {
    if (editing) await updateMeeting(editing.id, payload);
    else await createMeeting(payload);
    toast?.(editing ? "Meeting updated" : "Meeting saved", "success");
    setShowForm(false);
    setEditing(null);
    setPrefill(null);
    load();
  };

  const handleDelete = async (m) => {
    const ok = await confirm({
      title: "Delete meeting?",
      message: `"${m.title}" and all its action items will be deleted.`,
      danger: true,
    });
    if (!ok) return;
    await deleteMeeting(m.id);
    toast?.("Deleted", "success");
    load();
  };

  const filtered = meetings.filter(m => {
    if (filterStatus && m.status !== filterStatus) return false;
    if (filterProjectId && !m.projectDiscussions?.some(d => d.projectId === filterProjectId)) return false;
    if (searchQ && !m.title.toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  });

  const totalActions    = meetings.reduce((s, m) => s + (m.actionItems?.length || 0), 0);
  const convertedActions= meetings.reduce((s, m) => s + (m.actionItems?.filter(a=>a.converted).length || 0), 0);

  return (
    <div>
      <PageHeader
        title="Meeting Notes"
        description="Record meetings, extract action items with AI, and convert them to tasks."
        icon="📝"
      />

      {/* Stats */}
      <div className="meet-stats">
        <div className="meet-stat">
          <span className="meet-stat-num">{meetings.length}</span>
          <span className="meet-stat-label">Meetings</span>
        </div>
        <div className="meet-stat">
          <span className="meet-stat-num">{totalActions}</span>
          <span className="meet-stat-label">Action items</span>
        </div>
        <div className="meet-stat">
          <span className="meet-stat-num">{convertedActions}</span>
          <span className="meet-stat-label">Converted to tasks</span>
        </div>
        <div className="meet-stat">
          <span className="meet-stat-num">{totalActions - convertedActions}</span>
          <span className="meet-stat-label">Pending actions</span>
        </div>
      </div>

      {/* Meeting Continuity — where do we stand across all projects */}
      {prepareData && (
        <MeetingContinuityPanel data={prepareData} projects={projects} title="Where do we stand?" />
      )}

      {/* Day-to-day trends — collapsed by default */}
      <MeetingTrendsPanel />

      {/* Filter bar */}
      <div className="meet-filter-bar">
        <input className="meet-search" placeholder="Search meetings…"
          value={searchQ} onChange={e => setSearchQ(e.target.value)} />
        <div className="meet-status-filters">
          {["","SCHEDULED","IN_PROGRESS","COMPLETED"].map(s => (
            <button key={s}
              className={`meet-filter-btn${filterStatus === s ? " active" : ""}`}
              onClick={() => setFilterStatus(s)}>
              {s || "All"}
            </button>
          ))}
        </div>
        <select value={filterProjectId} onChange={e => setFilterProjectId(e.target.value)}
          style={{ fontSize: "12px", padding: "4px 8px" }}
          title="Show only meetings that discussed this project">
          <option value="">All projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div style={{flex:1}} />
        <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
          + New Meeting
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="meet-loading">Loading meetings…</div>
      ) : filtered.length === 0 ? (
        <div className="meet-empty">
          <div className="meet-empty-icon">📝</div>
          <h3>No meetings yet</h3>
          <p>Record your next meeting and let AI extract action items automatically.</p>
          <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
            + Record meeting
          </button>
        </div>
      ) : (
        <div className="meet-list">
          {filtered.map(m => (
            <MeetingCard key={m.id} m={m} projects={projects}
              onEdit={m => { setEditing(m); setShowForm(true); }}
              onDelete={handleDelete}
              onTaskCreated={load}
              onRefresh={load}
            />
          ))}
        </div>
      )}

      {showForm && (
        <MeetingFormModal
          initial={editing}
          prefill={prefill}
          projects={projects}
          members={members}
          wsId={wsId}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null); setPrefill(null); }}
        />
      )}
    </div>
  );
}
