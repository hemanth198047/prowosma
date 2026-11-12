import { useState, useEffect, useCallback } from "react";
import PageHeader from "../components/PageHeader";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import { useAuth } from "../hooks/useAuth";
import { fetchChangeRequests, createChangeRequest, updateChangeRequest, deleteChangeRequest } from "../api/changeRequests";
import { fetchProjects } from "../api/projects";
import "../styles/pages/change-requests.css";

const IMPACT_META = {
  HIGH:   { color: "var(--danger)", bg: "rgba(239,68,68,.1)" },
  MEDIUM: { color: "var(--warning)", bg: "rgba(245,158,11,.1)" },
  LOW:    { color: "var(--success)", bg: "rgba(16,185,129,.1)" },
};
const CATEGORIES = ["SCOPE", "BUDGET", "TIMELINE", "RESOURCE", "PROCESS"];
const STATUS_META = {
  DRAFT:       { label: "Draft",       color: "var(--gray-500)", bg: "rgba(107,114,128,.12)" },
  SUBMITTED:   { label: "Submitted",   color: "#3b82f6", bg: "rgba(59,130,246,.12)" },
  APPROVED:    { label: "Approved",    color: "var(--success)", bg: "rgba(16,185,129,.12)" },
  REJECTED:    { label: "Rejected",    color: "var(--danger)", bg: "rgba(239,68,68,.12)" },
  IMPLEMENTED: { label: "Implemented", color: "var(--purple)", bg: "rgba(139,92,246,.12)" },
};

function ChangeRequestForm({ initial, projects, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    title: "", description: "", impact: "MEDIUM", impactDescription: "",
    category: "SCOPE", projectId: "", linkedTaskId: "", approvers: [],
  });
  const [approverInput, setApproverInput] = useState((initial?.approvers || []).join(", "));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = () => {
    const approvers = approverInput.split(",").map((s) => s.trim()).filter(Boolean);
    onSave({ ...form, approvers });
  };

  return (
    <div className="modal-overlay"><div className="modal" style={{ maxWidth: 640 }}>
      <h2>{initial?.id ? "Edit Change Request" : "New Change Request"}</h2>

      <div className="form-group"><label htmlFor={"change-requests-title"}>Title *</label>
        <input value={form.title} onChange={(e) => set("title", e.target.value)}
          placeholder="What change is being requested?" id={"change-requests-title"} /></div>

      <div className="form-group"><label htmlFor={"change-requests-description"}>Description</label>
        <textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)}
          placeholder="What exactly needs to change, and why?" id={"change-requests-description"} /></div>

      <div className="form-row">
        <div className="form-group"><label htmlFor={"change-requests-category"}>Category</label>
          <select value={form.category} onChange={(e) => set("category", e.target.value)} id={"change-requests-category"}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <div className="form-group"><label htmlFor={"change-requests-impact"}>Impact</label>
          <select value={form.impact} onChange={(e) => set("impact", e.target.value)} id={"change-requests-impact"}>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select></div>
        <div className="form-group"><label htmlFor={"change-requests-project"}>Project</label>
          <select value={form.projectId || ""} onChange={(e) => set("projectId", e.target.value)} id={"change-requests-project"}>
            <option value="">— none —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
      </div>

      <div className="form-group"><label htmlFor={"change-requests-impact-description"}>Impact Description</label>
        <textarea rows={2} value={form.impactDescription} onChange={(e) => set("impactDescription", e.target.value)}
          placeholder="What breaks, slips, or costs more if this is approved?" id={"change-requests-impact-description"} /></div>

      <div className="form-row">
        <div className="form-group"><label htmlFor={"change-requests-linked-task-id"}>Linked Task ID</label>
          <input value={form.linkedTaskId || ""} onChange={(e) => set("linkedTaskId", e.target.value)}
            placeholder="Optional — task this change relates to" id={"change-requests-linked-task-id"} /></div>
        <div className="form-group"><label htmlFor={"change-requests-approvers"}>Approvers</label>
          <input value={approverInput} onChange={(e) => setApproverInput(e.target.value)}
            placeholder="comma-separated emails" id={"change-requests-approvers"} /></div>
      </div>

      <div className="form-actions">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" disabled={!form.title} onClick={handleSave}>
          {initial?.id ? "Save Changes" : "Create Request"}
        </button>
      </div>
    </div></div>
  );
}

function RejectDialog({ onConfirm, onCancel }) {
  const [reason, setReason] = useState("");
  return (
    <div className="modal-overlay"><div className="modal" style={{ maxWidth: 480 }}>
      <h2>Reject Change Request</h2>
      <div className="form-group"><label htmlFor={"change-requests-reason"}>Reason *</label>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this being rejected? (visible to the requester)" id={"change-requests-reason"} /></div>
      <div className="form-actions">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" disabled={!reason.trim()}
          onClick={() => onConfirm(reason.trim())}>Reject</button>
      </div>
    </div></div>
  );
}

function ChangeRequestCard({ c, currentEmail, onEdit, onDelete, onStatusChange, onRejectStart }) {
  const [expanded, setExpanded] = useState(false);
  const im = IMPACT_META[c.impact] || IMPACT_META.MEDIUM;
  const sm = STATUS_META[c.status] || STATUS_META.DRAFT;
  const isRequester = c.requestedBy === currentEmail;
  const isApprover = (c.approvers || []).includes(currentEmail);

  return (
    <div className={`cr-card${expanded ? " expanded" : ""}`}>
      <div className="cr-card-header" onClick={() => setExpanded((v) => !v)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setExpanded((v) => !v))?.(e); } }}>
        <div className="cr-card-left">
          <div className="cr-title">{c.title}</div>
          <div className="cr-meta">
            <span className="cr-category">{c.category}</span>
            <span className="cr-impact" style={{ color: im.color, background: im.bg }}>{c.impact} impact</span>
            {c.requestedBy && <span className="cr-by">{c.requestedBy}</span>}
            <span className="cr-date">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ""}</span>
          </div>
        </div>
        <div className="cr-card-right" onClick={(e) => e.stopPropagation()} role="presentation">
          <span className="cr-status" style={{ color: sm.color, background: sm.bg }}>{sm.label}</span>
          {c.status === "DRAFT" && isRequester && (
            <button className="btn-icon" title="Edit" onClick={() => onEdit(c)}>✏️</button>
          )}
          <button className="btn-icon" title="Delete" onClick={() => onDelete(c.id)}>🗑️</button>
          <span className="cr-expand-icon">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div className="cr-body">
          {c.description && (
            <div className="cr-section">
              <div className="cr-section-label">Description</div>
              <div className="cr-section-text">{c.description}</div>
            </div>
          )}
          {c.impactDescription && (
            <div className="cr-section">
              <div className="cr-section-label">Impact if approved</div>
              <div className="cr-section-text">{c.impactDescription}</div>
            </div>
          )}
          {c.linkedTaskId && (
            <div className="cr-section">
              <div className="cr-section-label">Linked task</div>
              <div className="cr-section-text">{c.linkedTaskId}</div>
            </div>
          )}
          {c.approvers?.length > 0 && (
            <div className="cr-section">
              <div className="cr-section-label">Approvers</div>
              <div className="cr-approvers">
                {c.approvers.map((a) => (
                  <span key={a} className={`cr-approver-chip${a === c.currentApprover ? " current" : ""}`}>{a}</span>
                ))}
              </div>
            </div>
          )}
          {c.status === "REJECTED" && c.rejectionReason && (
            <div className="cr-rejection">{c.rejectionReason}</div>
          )}

          {/* Workflow actions — deliberately client-side gated for a sane
              default UX (requester submits their own draft; only a listed
              approver sees Approve/Reject). This is NOT a substitute for
              server-side authorization — the backend's own role checks are
              what actually protect these endpoints; this just avoids
              showing buttons nobody should click. */}
          <div className="cr-actions">
            {c.status === "DRAFT" && isRequester && (
              <button className="btn-primary" onClick={() => onStatusChange(c.id, "SUBMITTED")}>
                Submit for Approval
              </button>
            )}
            {c.status === "SUBMITTED" && isApprover && (
              <>
                <button className="btn-primary" onClick={() => onStatusChange(c.id, "APPROVED")}>
                  Approve
                </button>
                <button className="btn-secondary" onClick={() => onRejectStart(c.id)}>
                  Reject
                </button>
              </>
            )}
            {c.status === "APPROVED" && (isRequester || isApprover) && (
              <button className="btn-primary" onClick={() => onStatusChange(c.id, "IMPLEMENTED")}>
                Mark Implemented
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ChangeRequests() {
  const [items, setItems] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [filter, setFilter] = useState("");
  const { show: toast } = useToast();
  const { user } = useAuth();
  const confirm = useConfirm();

  const load = useCallback(() => {
    setLoading(true);
    fetchChangeRequests()
      .then(setItems)
      .catch(() => toast("Failed to load change requests", "error"))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern
    load();
    fetchProjects().then(setProjects).catch(() => {});
  }, [load]);

  const handleSave = async (form) => {
    try {
      if (editing?.id) await updateChangeRequest(editing.id, form);
      else await createChangeRequest(form);
      setShowForm(false); setEditing(null); load();
      toast(editing ? "Change request updated" : "Change request created", "success");
    } catch {
      toast("Failed to save change request", "error");
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({ title: "Delete this change request?", danger: true });
    if (!ok) return;
    try { await deleteChangeRequest(id); load(); toast("Deleted", "success"); }
    catch { toast("Failed to delete", "error"); }
  };

  const handleStatusChange = async (id, status) => {
    try {
      await updateChangeRequest(id, { status });
      load();
      toast(`Marked ${STATUS_META[status]?.label || status}`, "success");
    } catch {
      toast("Failed to update status", "error");
    }
  };

  const handleReject = async (reason) => {
    try {
      await updateChangeRequest(rejectingId, { status: "REJECTED", rejectionReason: reason });
      setRejectingId(null); load();
      toast("Change request rejected", "success");
    } catch {
      toast("Failed to reject", "error");
    }
  };

  const filtered = filter ? items.filter((c) => c.status === filter || c.category === filter) : items;
  const counts = Object.fromEntries(
    Object.keys(STATUS_META).map((k) => [k, items.filter((c) => c.status === k).length])
  );
  const highImpact = items.filter((c) => c.impact === "HIGH").length;

  return (
    <div>
      <PageHeader icon="🔧" title="Change Requests"
        description="Propose, review, and approve changes to scope, budget, or timeline"
        action={<button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
          + New Change Request
        </button>}
      />

      <div className="kpi-summary-bar" style={{ marginBottom: 16 }}>
        {[
          { label: "Total",     value: items.length,          color: "var(--gray-700)" },
          { label: "Draft",     value: counts.DRAFT || 0,     color: STATUS_META.DRAFT.color },
          { label: "Submitted", value: counts.SUBMITTED || 0, color: STATUS_META.SUBMITTED.color },
          { label: "Approved",  value: counts.APPROVED || 0,  color: STATUS_META.APPROVED.color },
          { label: "Rejected",  value: counts.REJECTED || 0,  color: STATUS_META.REJECTED.color },
          { label: "High Impact", value: highImpact,          color: "var(--danger)" },
        ].map((s) => (
          <div key={s.label} className="kpi-summary-stat">
            <div className="kpi-summary-num" style={{ color: s.color }}>{s.value}</div>
            <div className="kpi-summary-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="intg-filter-bar">
        {["", "DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "IMPLEMENTED", ...CATEGORIES].map((f) => (
          <button key={f || "all"} className={`sprint-filter-btn${filter === f ? " active" : ""}`}
            onClick={() => setFilter(f)}>{f || "All"}</button>
        ))}
      </div>

      {loading ? (
        <div className="cr-empty">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="cr-empty">
          <div className="cr-empty-icon">🔧</div>
          No change requests {filter ? `match "${filter}"` : "yet"}. Create the first one above.
        </div>
      ) : (
        <div>
          {filtered.map((c) => (
            <ChangeRequestCard key={c.id} c={c} currentEmail={user?.email}
              onEdit={(c) => { setEditing(c); setShowForm(true); }}
              onDelete={handleDelete}
              onStatusChange={handleStatusChange}
              onRejectStart={setRejectingId}
            />
          ))}
        </div>
      )}

      {showForm && (
        <ChangeRequestForm initial={editing} projects={projects} onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null); }} />
      )}
      {rejectingId && (
        <RejectDialog onConfirm={handleReject} onCancel={() => setRejectingId(null)} />
      )}
    </div>
  );
}
