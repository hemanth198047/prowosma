import { useState, useEffect, useCallback } from "react";
import { unwrapList } from "../api/client";
import { getProjects } from "../api/projects";
import { getTimeReport, getInvoices, generateInvoice, updateInvoice, deleteInvoice } from "../api/timeTracking";
import PageHeader from "../components/PageHeader";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";

import "../styles/pages/time.css";
import { statusText } from "../utils/statusText";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";
function fmt(minutes) {
  if (!minutes) return "0h";
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function currency(amount, cur = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(amount || 0);
}

const STATUS_COLORS = { DRAFT:"var(--gray-400)", SENT:"var(--brand-500)", PAID:"var(--success)", OVERDUE:"var(--danger)" };

// ── Generate Invoice Modal ────────────────────────────────────
function GenerateModal({ projects, onGenerate, onClose }) {
  const { show: showToast } = useToast();
  const [form, setForm] = useState({
    projectId: "", clientName: "", clientEmail: "",
    hourlyRate: 100, taxRate: 0, currency: "USD",
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try { await onGenerate(form); onClose(); }
    catch (e) { showToast("Failed: " + (e.response?.data?.message || e.message), "error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="dev-form-overlay" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }}>
      <div className="dev-form" onClick={e => e.stopPropagation()} role="presentation">
        <h3 className="dev-form-title">🧾 Generate Invoice</h3>
        <p style={{ fontSize: "13px", color: "var(--gray-500)", marginBottom: "18px" }}>
          Creates an invoice from all billable time logs.
        </p>
        <div className="form-group">
          <label htmlFor={"time-tracking-project-optional-leave-blank-for-all"}>Project (optional — leave blank for all)</label>
          <select value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))} id={"time-tracking-project-optional-leave-blank-for-all"}>
            <option value="">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div className="form-group">
            <label htmlFor={"time-tracking-client-name"}>Client Name</label>
            <input value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))}
              placeholder="Acme Corp" id={"time-tracking-client-name"} />
          </div>
          <div className="form-group">
            <label htmlFor={"time-tracking-client-email"}>Client Email</label>
            <input value={form.clientEmail} onChange={e => setForm(f => ({ ...f, clientEmail: e.target.value }))}
              placeholder="billing@acme.com" type="email" id={"time-tracking-client-email"} />
          </div>
          <div className="form-group">
            <label htmlFor={"time-tracking-hourly-rate"}>Hourly Rate ($)</label>
            <input type="number" min="0" value={form.hourlyRate}
              onChange={e => setForm(f => ({ ...f, hourlyRate: Number(e.target.value) }))} id={"time-tracking-hourly-rate"} />
          </div>
          <div className="form-group">
            <label htmlFor={"time-tracking-tax-rate"}>Tax Rate (%)</label>
            <input type="number" min="0" max="100" value={form.taxRate}
              onChange={e => setForm(f => ({ ...f, taxRate: Number(e.target.value) }))} id={"time-tracking-tax-rate"} />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "⏳ Generating…" : "🧾 Generate Invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Invoice detail modal ──────────────────────────────────────
function InvoiceModal({ invoice, onClose, onStatusChange }) {
  const [status, setStatus] = useState(invoice.status);
  const [saving, setSaving] = useState(false);

  const changeStatus = async (s) => {
    setSaving(true);
    try { await onStatusChange(invoice.id, s); setStatus(s); }
    finally { setSaving(false); }
  };

  return (
    <div className="dev-form-overlay" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }}>
      <div className="dev-form" style={{ maxWidth: "680px" }} onClick={e => e.stopPropagation()} role="presentation">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
          <div>
            <h3 className="dev-form-title" style={{ marginBottom: "4px" }}>{invoice.invoiceNumber}</h3>
            <div style={{ fontSize: "13px", color: "var(--gray-400)" }}>
              {invoice.projectName} · {invoice.clientName || "No client"}
            </div>
          </div>
          <span className="tt-status-badge" style={{
            background: STATUS_COLORS[status] + "22",
            color: STATUS_COLORS[status],
          }}>{statusText(status)}</span>
        </div>

        {/* Line items */}
        <div className="tt-invoice-table">
          <div className="tt-invoice-thead">
            <span>Description</span><span>Hours</span><span>Rate</span><span>Amount</span>
          </div>
          {invoice.lineItems?.map((li, i) => (
            <div key={i} className="tt-invoice-row">
              <span>{li.description}</span>
              <span>{li.hours}h</span>
              <span>{currency(li.hourlyRate)}</span>
              <span style={{ fontWeight: 600 }}>{currency(li.amount)}</span>
            </div>
          ))}
        </div>

        <div className="tt-invoice-totals">
          <div className="tt-total-row"><span>Subtotal</span><span>{currency(invoice.subtotal)}</span></div>
          {invoice.taxRate > 0 && (
            <div className="tt-total-row">
              <span>Tax ({invoice.taxRate}%)</span><span>{currency(invoice.taxAmount)}</span>
            </div>
          )}
          <div className="tt-total-row tt-grand-total">
            <span>Total</span><span>{currency(invoice.total)}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "16px", flexWrap: "wrap" }}>
          {["DRAFT","SENT","PAID","OVERDUE"].map(s => (
            <button key={s} disabled={status === s || saving}
              className={status === s ? "btn-primary" : "btn-secondary"}
              style={{ fontSize: "12px", padding: "6px 12px" }}
              onClick={() => changeStatus(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="form-actions" style={{ marginTop: "12px" }}>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function TimeTracking() {
  const confirm = useConfirm();
  const [tab, setTab]         = useState("report");
  const [report, setReport]   = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterProject, setFilterProject] = useState("");
  const [showGenerate, setShowGenerate]   = useState(false);
  const [viewInvoice, setViewInvoice]     = useState(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterProject) params.projectId = filterProject;
      const [rep, invRes, projRes] = await Promise.all([
        getTimeReport(params), getInvoices(), getProjects(),
      ]);
      setReport(rep.data);
      setInvoices(unwrapList(invRes));
      setProjects(unwrapList(projRes));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filterProject]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount/dep-change pattern
    loadReport();
  }, [loadReport]);

  const handleGenerate = async (form) => {
    await generateInvoice(form);
    await loadReport();
    setTab("invoices");
  };

  const handleStatusChange = async (id, status) => {
    await updateInvoice(id, { status });
    setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, status } : inv));
  };

  const handleDelete = async (id) => {
    if (!(await confirm({ title: "Delete this invoice?", danger: true, confirmText: "Delete" }))) return;
    await deleteInvoice(id);
    setInvoices(prev => prev.filter(inv => inv.id !== id));
  };

  const CHART_COLORS = ["var(--brand-500)","var(--success)","var(--warning)","var(--danger)","var(--purple)","#0ea5e9"];

  return (
    <div>
      <PageHeader
        icon="⏱️"
        title="Time Tracking & Billing"
        description="Workspace-wide time reports and client invoicing"
        action={
          <button className="btn-primary" style={{ fontSize: "13px" }}
            onClick={() => setShowGenerate(true)}>
            🧾 Generate Invoice
          </button>
        }
      />

      {/* Tabs */}
      <div className="tab-bar" style={{ marginBottom: "20px" }}>
        <button className={"tab-btn" + (tab === "report" ? " tab-active" : "")} onClick={() => setTab("report")}>
          📊 Time Report
        </button>
        <button className={"tab-btn" + (tab === "invoices" ? " tab-active" : "")} onClick={() => setTab("invoices")}>
          🧾 Invoices
          {invoices.length > 0 && <span className="dev-tab-count">{invoices.length}</span>}
        </button>
      </div>

      {/* ── Time Report tab ── */}
      {tab === "report" && (
        <div>
          {/* Filter */}
          <div className="filter-bar" style={{ marginBottom: "20px" }}>
            <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
              style={{ fontSize: "13px" }}>
              <option value="">All Projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {loading ? <div className="empty-state">Loading…</div> : !report ? null : (
            <>
              {/* KPI row */}
              <div className="tt-kpi-row">
                <div className="tt-kpi-card">
                  <div className="tt-kpi-icon" style={{ background: "#e0f2fe", color: "#0369a1" }}>⏱️</div>
                  <div>
                    <div className="tt-kpi-value">{fmt(report.totalMinutes)}</div>
                    <div className="tt-kpi-label">Total Time Logged</div>
                  </div>
                </div>
                <div className="tt-kpi-card">
                  <div className="tt-kpi-icon" style={{ background: "rgba(5,150,105,0.12)", color: "#065f46" }}>💰</div>
                  <div>
                    <div className="tt-kpi-value">{fmt(report.billableMinutes)}</div>
                    <div className="tt-kpi-label">Billable Hours</div>
                  </div>
                </div>
                <div className="tt-kpi-card">
                  <div className="tt-kpi-icon" style={{ background: "#ede9fe", color: "#5b21b6" }}>💵</div>
                  <div>
                    <div className="tt-kpi-value">{currency(report.totalAmount)}</div>
                    <div className="tt-kpi-label">Billable Amount</div>
                  </div>
                </div>
                <div className="tt-kpi-card">
                  <div className="tt-kpi-icon" style={{ background: "rgba(217,119,6,0.12)", color: "var(--warning)" }}>📋</div>
                  <div>
                    <div className="tt-kpi-value">{report.entries?.length || 0}</div>
                    <div className="tt-kpi-label">Time Entries</div>
                  </div>
                </div>
              </div>

              {/* Charts row */}
              <div className="analytics-row" style={{ marginBottom: "20px" }}>
                {report.projectBreakdown?.length > 0 && (
                  <div className="analytics-card analytics-card-wide">
                    <div className="analytics-card-title">⏱️ Time by Project</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={report.projectBreakdown} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                        <XAxis type="number" dataKey="hours" tick={{ fontSize: 11 }} unit="h" />
                        <YAxis type="category" dataKey="projectName" tick={{ fontSize: 11 }} width={120} />
                        <Tooltip formatter={(v) => [`${v}h`, "Hours"]} />
                        <Bar dataKey="hours" radius={[0,4,4,0]}>
                          {report.projectBreakdown.map((entry, i) => (
                            <Cell key={i} fill={entry.color || CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {report.memberBreakdown?.length > 0 && (
                  <div className="analytics-card analytics-card-narrow">
                    <div className="analytics-card-title">👥 Time by Member</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={report.memberBreakdown} dataKey="hours" nameKey="name"
                          cx="50%" cy="50%" outerRadius={80} paddingAngle={3}>
                          {report.memberBreakdown.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v, n) => [`${v}h`, n]} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Time entries table */}
              <div className="analytics-card">
                <div className="analytics-card-title" style={{ marginBottom: "12px" }}>
                  📋 Time Entries
                  <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--gray-400)", marginLeft: "8px" }}>
                    {report.entries?.length} entries
                  </span>
                </div>
                {report.entries?.length === 0 ? (
                  <div className="empty-state" style={{ padding: "24px 0" }}>No time logged yet.</div>
                ) : (
                  <div className="tt-entries-table">
                    <div className="tt-entries-header">
                      <span>Task</span><span>Project</span><span>Description</span>
                      <span>Time</span><span>Billable</span><span>Amount</span><span>Logged by</span>
                    </div>
                    {report.entries.map((e, i) => (
                      <div key={i} className="tt-entries-row">
                        <span className="tt-task-name" title={e.taskTitle}>{e.taskTitle}</span>
                        <span className="tt-project-name">{e.projectName || "—"}</span>
                        <span style={{ color: "var(--gray-500)", fontSize: "12px" }}>{e.description || "—"}</span>
                        <span style={{ fontWeight: 600 }}>{fmt(e.minutes)}</span>
                        <span>{e.billable
                          ? <span style={{ color: "var(--success)", fontSize: "11px", fontWeight: 700 }}>✓ Billable</span>
                          : <span style={{ color: "var(--gray-400)", fontSize: "11px" }}>Non-billable</span>}
                        </span>
                        <span style={{ fontWeight: 600, color: e.amount > 0 ? "var(--brand-500)" : "var(--gray-400)" }}>
                          {e.amount > 0 ? currency(e.amount) : "—"}
                        </span>
                        <span style={{ color: "var(--gray-500)", fontSize: "12px" }}>
                          {e.loggedBy ? e.loggedBy.split("@")[0] : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Invoices tab ── */}
      {tab === "invoices" && (
        <div>
          {invoices.length === 0 ? (
            <div className="dev-empty">
              <div style={{ fontSize: "40px", marginBottom: "12px" }}>🧾</div>
              <div style={{ fontWeight: 600, marginBottom: "6px" }}>No invoices yet</div>
              <div style={{ fontSize: "13px", color: "var(--gray-400)", marginBottom: "16px" }}>
                Generate an invoice from your billable time logs.
              </div>
              <button className="btn-primary" onClick={() => setShowGenerate(true)}>
                🧾 Generate First Invoice
              </button>
            </div>
          ) : (
            <div className="tt-invoice-list">
              {invoices.map(inv => (
                <div key={inv.id} className="tt-invoice-card" onClick={() => setViewInvoice(inv)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setViewInvoice(inv))?.(e); } }}>
                  <div className="tt-invoice-card-left">
                    <div className="tt-invoice-number">{inv.invoiceNumber}</div>
                    <div className="tt-invoice-meta">
                      {inv.projectName}
                      {inv.clientName && <> · {inv.clientName}</>}
                      <span style={{ marginLeft: "8px", color: "var(--gray-400)" }}>
                        {new Date(inv.issuedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="tt-invoice-card-right">
                    <span className="tt-status-badge"
                      style={{ background: STATUS_COLORS[inv.status] + "22", color: STATUS_COLORS[inv.status] }}>
                      {statusText(inv.status)}
                    </span>
                    <span className="tt-invoice-total">{currency(inv.total)}</span>
                    <button className="btn-secondary"
                      style={{ fontSize: "11px", padding: "4px 10px", color: "var(--danger)" }}
                      onClick={e => { e.stopPropagation(); handleDelete(inv.id); }}>
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showGenerate && (
        <GenerateModal projects={projects} onGenerate={handleGenerate} onClose={() => setShowGenerate(false)} />
      )}
      {viewInvoice && (
        <InvoiceModal
          invoice={viewInvoice}
          onClose={() => setViewInvoice(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}
