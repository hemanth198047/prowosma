import { useState, useEffect, useCallback } from "react";
import { getDecisions, createDecision, updateDecision, deleteDecision } from "../api/decisions";
import { getProjects } from "../api/projects";
import { getTasks }    from "../api/tasks";
import { useAuth }     from "../hooks/useAuth";
import { useToast }    from "../components/ToastContext";
import { useConfirm }  from "../components/ConfirmDialog";
import PageHeader      from "../components/PageHeader";

import "../styles/pages/decisions.css";
// ── Constants ─────────────────────────────────────────────────
const STATUSES = ["PROPOSED","DECIDED","SUPERSEDED","REVERSED"];
const IMPACTS  = ["LOW","MEDIUM","HIGH","CRITICAL"];

const STATUS_META = {
  PROPOSED:   { label:"Proposed",   color:"#818cf8", bg:"rgba(99,102,241,0.12)" },
  DECIDED:    { label:"Decided",    color:"#34d399", bg:"rgba(5,150,105,0.12)" },
  SUPERSEDED: { label:"Superseded", color:"#fbbf24", bg:"rgba(217,119,6,0.12)" },
  REVERSED:   { label:"Reversed",   color:"#f87171", bg:"rgba(239,68,68,0.12)" },
};
const IMPACT_META = {
  LOW:      { color:"#10b981" },
  MEDIUM:   { color:"#f59e0b" },
  HIGH:     { color:"#ef4444" },
  CRITICAL: { color:"#7c3aed" },
};

// ── Helpers ────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { day:"numeric", month:"short", year:"numeric" });
}

// ── Decision Form Modal ────────────────────────────────────────
const EMPTY_FORM = {
  title:"", context:"", decision:"", rationale:"", outcome:"",
  owner:"", status:"PROPOSED", impact:"MEDIUM",
  decidedAt:"", tags:"", linkedTaskIds:[], linkedProjectIds:[], docId:"",
};

function DecisionFormModal({ initial, projects, tasks, wsId, onSave, onCancel }) {
  const [form, setForm] = useState(() => initial
    ? { ...initial, tags: initial.tags?.join(", ") || "", decidedAt: initial.decidedAt?.slice?.(0,10) || "" }
    : { ...EMPTY_FORM }
  );
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        workspaceId: wsId,
        tags: form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
        decidedAt: form.decidedAt ? new Date(form.decidedAt).toISOString() : null,
      };
      await onSave(payload);
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onCancel} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onCancel)?.(e); } }}>
      <div className="modal dec-modal" onClick={e => e.stopPropagation()} role="presentation">
        <h2>{initial ? "Edit Decision" : "New Decision Record"}</h2>

        <div className="form-group">
          <label htmlFor={"decisions-title"}>Title *</label>
          <input value={form.title} onChange={e => set("title", e.target.value)}
            placeholder="What was decided?" id={"decisions-title"} />
        </div>

        <div className="form-group">
          <label htmlFor={"decisions-context"}>Context</label>
          <textarea rows={2} value={form.context} onChange={e => set("context", e.target.value)}
            placeholder="Background — why was this decision needed?" id={"decisions-context"} />
        </div>

        <div className="form-group">
          <label htmlFor={"decisions-decision"}>Decision</label>
          <textarea rows={2} value={form.decision} onChange={e => set("decision", e.target.value)}
            placeholder="The actual decision that was made" id={"decisions-decision"} />
        </div>

        <div className="form-group">
          <label htmlFor={"decisions-rationale"}>Rationale</label>
          <textarea rows={2} value={form.rationale} onChange={e => set("rationale", e.target.value)}
            placeholder="Why this option was chosen over alternatives" id={"decisions-rationale"} />
        </div>

        <div className="form-group">
          <label htmlFor={"decisions-outcome"}>Outcome</label>
          <textarea rows={2} value={form.outcome} onChange={e => set("outcome", e.target.value)}
            placeholder="Result / what happened after (fill in later)" id={"decisions-outcome"} />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"decisions-status"}>Status</label>
            <select value={form.status} onChange={e => set("status", e.target.value)} id={"decisions-status"}>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor={"decisions-impact"}>Impact</label>
            <select value={form.impact} onChange={e => set("impact", e.target.value)} id={"decisions-impact"}>
              {IMPACTS.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"decisions-owner"}>Owner</label>
            <input value={form.owner} onChange={e => set("owner", e.target.value)}
              placeholder="Person accountable" id={"decisions-owner"} />
          </div>
          <div className="form-group">
            <label htmlFor={"decisions-decision-date"}>Decision date</label>
            <input type="date" value={form.decidedAt} onChange={e => set("decidedAt", e.target.value)} id={"decisions-decision-date"} />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor={"decisions-tags-comma-separated"}>Tags (comma separated)</label>
          <input value={form.tags} onChange={e => set("tags", e.target.value)}
            placeholder="e.g. architecture, security, product" id={"decisions-tags-comma-separated"} />
        </div>

        <div className="form-group">
          <label htmlFor={"decisions-link-to-project-optional"}>Link to project (optional)</label>
          <select value={form.linkedProjectIds?.[0] || ""}
            onChange={e => set("linkedProjectIds", e.target.value ? [e.target.value] : [])} id={"decisions-link-to-project-optional"}>
            <option value="">— None —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" disabled={saving || !form.title.trim()} onClick={handleSave}>
            {saving ? "⏳ Saving…" : initial ? "Update" : "Create Decision"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Decision Card ──────────────────────────────────────────────
function DecisionCard({ d, onEdit, onDelete, onStatusChange }) {
  const [expanded, setExpanded] = useState(false);
  const sm = STATUS_META[d.status] || STATUS_META.PROPOSED;
  const im = IMPACT_META[d.impact] || IMPACT_META.MEDIUM;

  return (
    <div className="dec-card">
      <div className="dec-card-header" onClick={() => setExpanded(v => !v)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setExpanded(v => !v))?.(e); } }}>
        <div className="dec-card-title-row">
          <span className="dec-card-chevron">{expanded ? "▾" : "▸"}</span>
          <span className="dec-card-title">{d.title}</span>
        </div>
        <div className="dec-card-meta">
          <span className="dec-status-badge"
            style={{ background: sm.bg, color: sm.color }}>
            {sm.label}
          </span>
          <span className="dec-impact-badge" style={{ color: im.color }}>
            ● {d.impact}
          </span>
          {d.owner && <span className="dec-owner">👤 {d.owner}</span>}
          {d.decidedAt && <span className="dec-date">📅 {fmtDate(d.decidedAt)}</span>}
          <div className="dec-card-actions" onClick={e => e.stopPropagation()} role="presentation">
            <button onClick={() => onEdit(d)} title="Edit">✎</button>
            <button onClick={() => onDelete(d)} title="Delete" className="dec-delete-btn">🗑</button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="dec-card-body">
          {d.context   && <div className="dec-field"><span className="dec-field-label">Context</span><p>{d.context}</p></div>}
          {d.decision  && <div className="dec-field"><span className="dec-field-label">Decision</span><p>{d.decision}</p></div>}
          {d.rationale && <div className="dec-field"><span className="dec-field-label">Rationale</span><p>{d.rationale}</p></div>}
          {d.outcome   && <div className="dec-field dec-field--outcome"><span className="dec-field-label">Outcome</span><p>{d.outcome}</p></div>}

          <div className="dec-card-footer">
            {d.tags?.length > 0 && (
              <div className="dec-tags">
                {d.tags.map(t => <span key={t} className="dec-tag">{t}</span>)}
              </div>
            )}
            <div className="dec-status-changer">
              <span className="dec-field-label">Change status:</span>
              {STATUSES.filter(s => s !== d.status).map(s => (
                <button key={s} className="dec-status-btn"
                  style={{ color: STATUS_META[s].color }}
                  onClick={() => onStatusChange(d.id, s)}>
                  → {STATUS_META[s].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────
export default function Decisions() {
  const { activeWorkspace } = useAuth();
  const toast    = useToast();
  const confirm  = useConfirm();
  const wsId     = activeWorkspace?.id;

  const [decisions, setDecisions] = useState([]);
  const [projects,  setProjects]  = useState([]);
  const [tasks,     setTasks]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [editing,   setEditing]   = useState(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [searchQ,   setSearchQ]   = useState("");

  const load = useCallback(async () => {
    if (!wsId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [dr, pr, tr] = await Promise.all([
        getDecisions(wsId),
        getProjects(),
        getTasks(),
      ]);
      const dl = dr.data?.data ?? dr.data ?? [];
      setDecisions(Array.isArray(dl) ? dl : []);
      setProjects(Array.isArray(pr.data) ? pr.data : []);
      setTasks(Array.isArray(tr.data) ? tr.data : (tr.data?.data ?? []));
    } catch { toast?.show("Failed to load decisions", "error"); }
    finally { setLoading(false); }
  }, [wsId]);

  useEffect(() => { load(); }, [wsId]);

  const handleSave = async (payload) => {
    if (editing) {
      await updateDecision(editing.id, payload);
      toast?.show("Decision updated", "success");
    } else {
      await createDecision(payload);
      toast?.show("Decision recorded", "success");
    }
    setShowForm(false);
    setEditing(null);
    load();
  };

  const handleDelete = async (d) => {
    const ok = await confirm({ title: "Delete decision?",
      message: `"${d.title}" will be permanently deleted.`, danger: true });
    if (!ok) return;
    await deleteDecision(d.id);
    toast?.show("Deleted", "success");
    load();
  };

  const handleStatusChange = async (id, status) => {
    await updateDecision(id, { status });
    load();
  };

  // ── Filtered view ──────────────────────────────────────────
  const filtered = decisions.filter(d => {
    if (filterStatus && d.status !== filterStatus) return false;
    if (searchQ && !d.title.toLowerCase().includes(searchQ.toLowerCase()) &&
        !d.decision?.toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  });

  // ── Stats ─────────────────────────────────────────────────
  const stats = STATUSES.reduce((acc, s) => {
    acc[s] = decisions.filter(d => d.status === s).length;
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        title="Decision Records"
        description="Track every important decision — what was decided, why, and what happened."
        icon="⚖️"
      />

      {/* Stats bar */}
      <div className="dec-stats">
        {STATUSES.map(s => (
          <button key={s}
            className={`dec-stat-pill${filterStatus === s ? " active" : ""}`}
            style={filterStatus === s ? { background: STATUS_META[s].bg, color: STATUS_META[s].color, borderColor: STATUS_META[s].color } : {}}
            onClick={() => setFilterStatus(v => v === s ? "" : s)}>
            <span className="dec-stat-count">{stats[s]}</span>
            <span className="dec-stat-label">{STATUS_META[s].label}</span>
          </button>
        ))}
        <span className="dec-stat-total">{decisions.length} total</span>
      </div>

      {/* Filter bar */}
      <div className="dec-filter-bar">
        <input
          className="dec-search"
          placeholder="Search decisions…"
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
        />
        <div style={{ flex: 1 }} />
        <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
          + New Decision
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="dec-loading">Loading decisions…</div>
      ) : filtered.length === 0 ? (
        <div className="dec-empty">
          <div className="dec-empty-icon">⚖️</div>
          <h3>No decisions yet</h3>
          <p>Record important decisions so your team always knows what was decided and why.</p>
          <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
            + Record first decision
          </button>
        </div>
      ) : (
        <div className="dec-list">
          {filtered.map(d => (
            <DecisionCard key={d.id} d={d}
              onEdit={d => { setEditing(d); setShowForm(true); }}
              onDelete={handleDelete}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}

      {showForm && (
        <DecisionFormModal
          initial={editing}
          projects={projects}
          tasks={tasks}
          wsId={wsId}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
