import { useState, useEffect, useCallback } from "react";
import {
  getSops, createSop, updateSop, deleteSop,
  publishSop, archiveSop, acknowledgeSop, revokeAckSop,
} from "../api/sops";
import { getTeamMembers } from "../api/team";
import { useAuth }        from "../hooks/useAuth";
import { useToast }       from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import PageHeader         from "../components/PageHeader";

import "../styles/pages/sops.css";
// ─── Constants ────────────────────────────────────────────────
const STATUSES = ["DRAFT", "REVIEW", "PUBLISHED", "ARCHIVED"];
const STATUS_META = {
  DRAFT:     { label:"Draft",     color:"var(--brand-500)", bg:"rgba(99,102,241,0.12)", icon:"✏️"  },
  REVIEW:    { label:"In Review", color:"var(--warning)", bg:"rgba(217,119,6,0.12)", icon:"🔍"  },
  PUBLISHED: { label:"Published", color:"var(--success)", bg:"rgba(5,150,105,0.12)", icon:"✅"  },
  ARCHIVED:  { label:"Archived",  color:"var(--gray-400)", bg:"var(--gray-100)", icon:"📦"  },
};

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { day:"numeric", month:"short", year:"numeric" });
}

// ─── SOP Form Modal ────────────────────────────────────────────
const EMPTY_FORM = {
  title:"", description:"", category:"", owner:"",
  content:"", status:"DRAFT", requiredAcknowledgers:"",
};

function SopFormModal({ initial, members, wsId, onSave, onCancel }) {
  const [form, setForm] = useState(() => initial
    ? { ...initial, requiredAcknowledgers: initial.requiredAcknowledgers?.join(", ") || "" }
    : { ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await onSave({
        ...form,
        workspaceId: wsId,
        requiredAcknowledgers: form.requiredAcknowledgers
          ? form.requiredAcknowledgers.split(",").map(e => e.trim()).filter(Boolean)
          : [],
      });
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onCancel} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onCancel)?.(e); } }}>
      <div className="modal sop-modal" onClick={e => e.stopPropagation()} role="presentation">
        <div className="sop-modal-header">
          <h2>{initial ? "Edit SOP" : "New Standard Operating Procedure"}</h2>
          <button onClick={onCancel}>✕</button>
        </div>

        <div className="form-group">
          <label htmlFor={"sops-title"}>Title *</label>
          <input value={form.title}
            onChange={e => set("title", e.target.value)}
            placeholder="e.g. Incident Response Procedure" id={"sops-title"} />
        </div>

        <div className="form-group">
          <label htmlFor={"sops-description"}>Description</label>
          <textarea rows={2} value={form.description}
            onChange={e => set("description", e.target.value)}
            placeholder="Brief purpose of this SOP" id={"sops-description"} />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"sops-category"}>Category</label>
            <input value={form.category}
              onChange={e => set("category", e.target.value)}
              placeholder="e.g. Engineering, HR, Security" id={"sops-category"} />
          </div>
          <div className="form-group">
            <label htmlFor={"sops-owner"}>Owner</label>
            <select value={form.owner} onChange={e => set("owner", e.target.value)} id={"sops-owner"}>
              <option value="">— None —</option>
              {members.map(m => (
                <option key={m.id} value={m.email}>{m.name || m.email}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor={"sops-content"}>Content</label>
          <textarea rows={6} value={form.content}
            onChange={e => set("content", e.target.value)}
            placeholder="Write the SOP content here… (full block editor coming soon)" id={"sops-content"} />
        </div>

        <div className="form-group">
          <label htmlFor={"sops-required-acknowledgers-comma-separated-e"}>Required Acknowledgers (comma-separated emails)</label>
          <input value={form.requiredAcknowledgers}
            onChange={e => set("requiredAcknowledgers", e.target.value)}
            placeholder="alice@co.com, bob@co.com" id={"sops-required-acknowledgers-comma-separated-e"} />
        </div>

        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary"
            disabled={saving || !form.title.trim()} onClick={handleSave}>
            {saving ? "⏳ Saving…" : initial ? "Update SOP" : "Create SOP"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Publish modal (with change note) ─────────────────────────
function PublishModal({ sop, onConfirm, onCancel }) {
  const [note, setNote]       = useState("");
  const [saving, setSaving]   = useState(false);
  return (
    <div className="modal-overlay" onClick={onCancel} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onCancel)?.(e); } }}>
      <div className="modal" style={{maxWidth:480}} onClick={e => e.stopPropagation()} role="presentation">
        <h2 style={{marginBottom:16}}>Publish SOP</h2>
        <p style={{fontSize:13,color:"var(--gray-500)",marginBottom:16}}>
          Publishing <b>{sop.title}</b> will bump the version to <b>v{sop.version + 1}</b> and
          reset all acknowledgements — every required member must re-acknowledge.
        </p>
        <div className="form-group">
          <label htmlFor={"sops-change-note-optional"}>Change note (optional)</label>
          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder="What changed in this version?" id={"sops-change-note-optional"} />
        </div>
        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try { await onConfirm(note); }
              finally { setSaving(false); }
            }}>
            {saving ? "⏳ Publishing…" : "✅ Publish v" + (sop.version + 1)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SOP Card ─────────────────────────────────────────────────
function SopCard({ sop, currentUser, onEdit, onDelete, onPublish, onArchive, onAcknowledge, onRevokeAck }) {
  const [expanded, setExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const sm = STATUS_META[sop.status] || STATUS_META.DRAFT;

  const myAck = sop.acknowledgements?.find(a => a.userEmail === currentUser?.email);
  const ackCount = sop.acknowledgements?.length || 0;
  const required = sop.requiredAcknowledgers?.length || 0;
  const ackPct   = required > 0 ? Math.round((ackCount / required) * 100) : null;

  const isPublished = sop.status === "PUBLISHED";
  const canPublish  = ["DRAFT","REVIEW"].includes(sop.status);
  const canArchive  = sop.status === "PUBLISHED";

  return (
    <div className="sop-card">
      {/* Header */}
      <div className="sop-card-header" onClick={() => setExpanded(v => !v)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setExpanded(v => !v))?.(e); } }}>
        <div className="sop-card-left">
          <span className="sop-chevron">{expanded ? "▾" : "▸"}</span>
          <span className="sop-status-icon">{sm.icon}</span>
          <div className="sop-card-info">
            <div className="sop-card-title">{sop.title}</div>
            <div className="sop-card-meta">
              {sop.category && <span className="sop-cat-badge">{sop.category}</span>}
              <span>v{sop.version}</span>
              {sop.owner && <span>👤 {sop.owner.split("@")[0]}</span>}
              {sop.publishedAt && <span>📅 {fmtDate(sop.publishedAt)}</span>}
            </div>
          </div>
        </div>
        <div className="sop-card-right" onClick={e => e.stopPropagation()} role="presentation">
          <span className="sop-status-badge"
            style={{ background: sm.bg, color: sm.color }}>
            {sm.label}
          </span>
          {/* Ack progress pill */}
          {isPublished && required > 0 && (
            <span className={`sop-ack-pill${ackPct === 100 ? " complete" : ""}`}>
              {ackCount}/{required} acked
            </span>
          )}
          {/* Actions */}
          {canPublish  && <button className="sop-action-btn sop-publish-btn" onClick={() => onPublish(sop)}>Publish</button>}
          {canArchive  && <button className="sop-action-btn sop-archive-btn" onClick={() => onArchive(sop)}>Archive</button>}
          <button className="sop-icon-btn" onClick={() => onEdit(sop)} title="Edit">✎</button>
          <button className="sop-icon-btn sop-delete-btn" onClick={() => onDelete(sop)} title="Delete">🗑</button>
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="sop-card-body">
          {sop.description && (
            <div className="sop-section">
              <div className="sop-section-label">Purpose</div>
              <p className="sop-desc">{sop.description}</p>
            </div>
          )}

          {sop.content && (
            <div className="sop-section">
              <div className="sop-section-label">Content</div>
              <div className="sop-content-preview">
                {sop.content.slice(0, 600)}{sop.content.length > 600 ? "…" : ""}
              </div>
            </div>
          )}

          {/* Acknowledgement section */}
          {isPublished && (
            <div className="sop-section sop-ack-section">
              <div className="sop-section-label">
                Acknowledgements
                {ackPct !== null && (
                  <span className="sop-ack-progress-label">{ackPct}% complete</span>
                )}
              </div>

              {/* Progress bar */}
              {required > 0 && (
                <div className="sop-ack-bar">
                  <div className="sop-ack-bar-fill"
                    style={{ width: `${ackPct}%`, background: ackPct === 100 ? "var(--success)" : "var(--brand-500)" }} />
                </div>
              )}

              {/* My acknowledgement */}
              <div className="sop-my-ack">
                {myAck ? (
                  <div className="sop-acked">
                    <span>✅ You acknowledged v{myAck.sopVersion} on {fmtDate(myAck.ackedAt)}</span>
                    <button className="sop-revoke-btn" onClick={() => onRevokeAck(sop)}>
                      Revoke
                    </button>
                  </div>
                ) : (
                  <button className="sop-ack-btn" onClick={() => onAcknowledge(sop)}>
                    ☐ I acknowledge this SOP (v{sop.version})
                  </button>
                )}
              </div>

              {/* Who has / hasn't acked */}
              {required > 0 && (
                <div className="sop-ack-list">
                  {sop.requiredAcknowledgers.map(email => {
                    const ack = sop.acknowledgements?.find(a => a.userEmail === email);
                    return (
                      <div key={email} className={`sop-ack-item${ack ? " acked" : ""}`}>
                        <span className="sop-ack-dot">{ack ? "✅" : "⬜"}</span>
                        <span className="sop-ack-email">{email.split("@")[0]}</span>
                        {ack && <span className="sop-ack-date">{fmtDate(ack.ackedAt)}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Version history */}
          {sop.versionHistory?.length > 0 && (
            <div className="sop-section">
              <button className="sop-history-toggle"
                onClick={() => setShowHistory(v => !v)}>
                🕐 Version history ({sop.versionHistory.length})
                {showHistory ? " ▾" : " ▸"}
              </button>
              {showHistory && (
                <div className="sop-history-list">
                  {[...sop.versionHistory].reverse().map((v, i) => (
                    <div key={i} className="sop-history-item">
                      <span className="sop-history-v">v{v.version}</span>
                      <span className="sop-history-note">{v.changeNote || "—"}</span>
                      <span className="sop-history-by">{v.changedBy?.split("@")[0]}</span>
                      <span className="sop-history-date">{fmtDate(v.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────
export default function Sops() {
  const { activeWorkspace, user } = useAuth();
  const { show: toast } = useToast();
  const confirm = useConfirm();
  const wsId    = activeWorkspace?.id;

  const [sops,        setSops]        = useState([]);
  const [members,     setMembers]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [editing,     setEditing]     = useState(null);
  const [publishing,  setPublishing]  = useState(null);
  const [searchQ,     setSearchQ]     = useState("");
  const [filterStatus,setFilterStatus]= useState("");
  const [filterCat,   setFilterCat]   = useState("");

  const load = useCallback(async () => {
    if (!wsId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [sr, mr] = await Promise.all([getSops(wsId), getTeamMembers()]);
      const sl = sr.data?.data ?? sr.data ?? [];
      setSops(Array.isArray(sl) ? sl : []);
      setMembers(Array.isArray(mr.data) ? mr.data : (mr.data?.data ?? []));
    } catch { toast?.("Failed to load SOPs", "error"); }
    finally { setLoading(false); }
  }, [wsId, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern
    load();
  }, [load]);

  const handleSave = async (payload) => {
    if (editing) await updateSop(editing.id, payload);
    else         await createSop(payload);
    toast?.(editing ? "SOP updated" : "SOP created", "success");
    setShowForm(false); setEditing(null); load();
  };

  const handleDelete = async (sop) => {
    const ok = await confirm({ title:"Delete SOP?",
      message:`"${sop.title}" will be permanently deleted.`, danger:true });
    if (!ok) return;
    await deleteSop(sop.id);
    toast?.("Deleted", "success"); load();
  };

  const handlePublish = async (sop, changeNote) => {
    await publishSop(sop.id, changeNote);
    toast?.(`SOP published as v${sop.version + 1}`, "success");
    setPublishing(null); load();
  };

  const handleArchive = async (sop) => {
    const ok = await confirm({ title:"Archive SOP?",
      message:"This will mark the SOP as archived. It will no longer appear in the active list." });
    if (!ok) return;
    await archiveSop(sop.id);
    toast?.("SOP archived", "success"); load();
  };

  const handleAcknowledge = async (sop) => {
    await acknowledgeSop(sop.id, { userEmail: user?.email, userName: user?.name || user?.email });
    toast?.("SOP acknowledged ✅", "success"); load();
  };

  const handleRevokeAck = async (sop) => {
    await revokeAckSop(sop.id);
    toast?.("Acknowledgement revoked", "success"); load();
  };

  // ── Derived data ─────────────────────────────────────────────
  const categories = [...new Set(sops.map(s => s.category).filter(Boolean))];

  const filtered = sops.filter(s => {
    if (filterStatus && s.status !== filterStatus) return false;
    if (filterCat    && s.category !== filterCat)  return false;
    if (searchQ && !s.title.toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  });

  const stats = STATUSES.reduce((acc, s) => {
    acc[s] = sops.filter(x => x.status === s).length;
    return acc;
  }, {});

  const pendingMyAck = sops.filter(s =>
    s.status === "PUBLISHED" &&
    s.requiredAcknowledgers?.includes(user?.email) &&
    !s.acknowledgements?.find(a => a.userEmail === user?.email)
  ).length;

  return (
    <div>
      <PageHeader
        title="SOPs"
        description="Standard operating procedures — manage lifecycle, version control, and team acknowledgements."
        icon="📖"
      />

      {/* My pending acks banner */}
      {pendingMyAck > 0 && (
        <div className="sop-pending-banner">
          ⚠️ You have <b>{pendingMyAck}</b> SOP{pendingMyAck > 1 ? "s" : ""} requiring your acknowledgement.
          <button onClick={() => setFilterStatus("PUBLISHED")}>View →</button>
        </div>
      )}

      {/* Stats */}
      <div className="sop-stats">
        {STATUSES.map(s => {
          const sm = STATUS_META[s];
          return (
            <button key={s}
              className={`sop-stat-pill${filterStatus === s ? " active" : ""}`}
              style={filterStatus === s ? { background:sm.bg, color:sm.color, borderColor:sm.color } : {}}
              onClick={() => setFilterStatus(v => v === s ? "" : s)}>
              <span className="sop-stat-icon">{sm.icon}</span>
              <span className="sop-stat-count">{stats[s]}</span>
              <span className="sop-stat-label">{sm.label}</span>
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="sop-filter-bar">
        <input className="sop-search" placeholder="Search SOPs…"
          value={searchQ} onChange={e => setSearchQ(e.target.value)} />
        {categories.length > 0 && (
          <select className="sop-cat-filter" value={filterCat}
            onChange={e => setFilterCat(e.target.value)}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <div style={{flex:1}} />
        <button className="btn-primary"
          onClick={() => { setEditing(null); setShowForm(true); }}>
          + New SOP
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="sop-loading">Loading SOPs…</div>
      ) : filtered.length === 0 ? (
        <div className="sop-empty">
          <div className="sop-empty-icon">📖</div>
          <h3>No SOPs yet</h3>
          <p>Document your standard operating procedures, publish them, and track who has read and acknowledged each one.</p>
          <button className="btn-primary"
            onClick={() => { setEditing(null); setShowForm(true); }}>
            + Create first SOP
          </button>
        </div>
      ) : (
        <div className="sop-list">
          {filtered.map(sop => (
            <SopCard key={sop.id}
              sop={sop}
              currentUser={user}
              members={members}
              onEdit={s => { setEditing(s); setShowForm(true); }}
              onDelete={handleDelete}
              onPublish={s => setPublishing(s)}
              onArchive={handleArchive}
              onAcknowledge={handleAcknowledge}
              onRevokeAck={handleRevokeAck}
            />
          ))}
        </div>
      )}

      {showForm && (
        <SopFormModal
          initial={editing}
          members={members}
          wsId={wsId}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {publishing && (
        <PublishModal
          sop={publishing}
          onConfirm={note => handlePublish(publishing, note)}
          onCancel={() => setPublishing(null)}
        />
      )}
    </div>
  );
}
