import { useState, useEffect } from "react";
import { unwrapList } from "../api/client";
import {
  getKpis, createKpi, updateKpi, deleteKpi,
  recordValue, forecastGoal,
} from "../api/kpis";
import { getGoals } from "../api/goals";
import PageHeader from "../components/PageHeader";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import {
  LineChart, Line,
  Tooltip, ResponsiveContainer,
} from "recharts";

const CATEGORIES = ["REVENUE","GROWTH","QUALITY","PRODUCTIVITY","CUSTOM"];
const PERIODS    = ["DAILY","WEEKLY","MONTHLY","QUARTERLY"];
const STATUS_META = {
  ON_TRACK: { label:"On Track", color:"#10b981", bg:"rgba(5,150,105,0.1)" },
  AT_RISK:  { label:"At Risk",  color:"#f59e0b", bg:"rgba(217,119,6,0.1)" },
  BEHIND:   { label:"Behind",   color:"#ef4444", bg:"rgba(239,68,68,0.1)" },
  ACHIEVED: { label:"Achieved", color:"#6366f1", bg:"rgba(99,102,241,0.1)" },
};
const PREDICT_META = {
  HIGH:    { label:"High likelihood",  color:"#10b981", icon:"🟢" },
  MEDIUM:  { label:"Moderate",         color:"#f59e0b", icon:"🟡" },
  LOW:     { label:"At risk",          color:"#ef4444", icon:"🔴" },
  UNKNOWN: { label:"Not enough data",  color:"#6b7280", icon:"⚪" },
};

// ── KPI Form ──────────────────────────────────────────────────
function KpiForm({ initial, goals, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    name:"", description:"", unit:"%", category:"CUSTOM",
    targetValue:100, baselineValue:0, currentValue:0,
    period:"MONTHLY", owner:"", linkedGoalId:"",
    alertEnabled:true, alertThreshold:50, alertDirection:"BELOW",
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>{initial?.id ? "Edit KPI" : "New KPI Metric"}</h2>
        <div className="form-row">
          <div className="form-group" style={{ flex:2 }}>
            <label htmlFor={"kpi-tracker-name"}>Name *</label>
            <input value={form.name} onChange={e => set("name", e.target.value)}
              placeholder="e.g. Monthly Revenue" id={"kpi-tracker-name"} />
          </div>
          <div className="form-group">
            <label htmlFor={"kpi-tracker-unit"}>Unit</label>
            <input value={form.unit} onChange={e => set("unit", e.target.value)}
              placeholder="$, %, users…" id={"kpi-tracker-unit"} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"kpi-tracker-category"}>Category</label>
            <select value={form.category} onChange={e => set("category", e.target.value)} id={"kpi-tracker-category"}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor={"kpi-tracker-period"}>Period</label>
            <select value={form.period} onChange={e => set("period", e.target.value)} id={"kpi-tracker-period"}>
              {PERIODS.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor={"kpi-tracker-owner"}>Owner</label>
            <input value={form.owner} onChange={e => set("owner", e.target.value)}
              placeholder="Person or team" id={"kpi-tracker-owner"} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"kpi-tracker-baseline"}>Baseline</label>
            <input type="number" value={form.baselineValue}
              onChange={e => set("baselineValue", Number(e.target.value))} id={"kpi-tracker-baseline"} />
          </div>
          <div className="form-group">
            <label htmlFor={"kpi-tracker-target"}>Target</label>
            <input type="number" value={form.targetValue}
              onChange={e => set("targetValue", Number(e.target.value))} id={"kpi-tracker-target"} />
          </div>
          <div className="form-group">
            <label htmlFor={"kpi-tracker-current"}>Current</label>
            <input type="number" value={form.currentValue}
              onChange={e => set("currentValue", Number(e.target.value))} id={"kpi-tracker-current"} />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor={"kpi-tracker-link-to-goal-optional"}>Link to Goal (optional)</label>
          <select value={form.linkedGoalId} onChange={e => set("linkedGoalId", e.target.value)} id={"kpi-tracker-link-to-goal-optional"}>
            <option value="">— No linked goal —</option>
            {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </div>
        <div className="kpi-alert-section">
          <label className="kpi-alert-toggle">
            <input type="checkbox" checked={form.alertEnabled}
              onChange={e => set("alertEnabled", e.target.checked)} />
            Enable threshold alert
          </label>
          {form.alertEnabled && (
            <div className="form-row" style={{ marginTop:8 }}>
              <div className="form-group">
                <label htmlFor={"kpi-tracker-alert-when-value-is"}>Alert when value is</label>
                <select value={form.alertDirection}
                  onChange={e => set("alertDirection", e.target.value)} id={"kpi-tracker-alert-when-value-is"}>
                  <option value="BELOW">Below threshold</option>
                  <option value="ABOVE">Above threshold</option>
                </select>
              </div>
              <div className="form-group">
                <label>Threshold ({form.unit})</label>
                <input type="number" value={form.alertThreshold}
                  onChange={e => set("alertThreshold", Number(e.target.value))} />
              </div>
            </div>
          )}
        </div>
        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}
            disabled={saving || !form.name.trim()}>
            {saving ? "Saving…" : "Save KPI"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────
function KpiCard({ kpi, goals, onEdit, onDelete, onRefresh }) {
  const [showHistory, setShowHistory] = useState(false);
  const [showRecord,  setShowRecord]  = useState(false);
  const [showForecast,setShowForecast]= useState(false);
  const [forecast,    setForecast]    = useState(null);
  const [newVal,      setNewVal]      = useState("");
  const [newNote,     setNewNote]     = useState("");
  const [saving,      setSaving]      = useState(false);
  const [forecasting, setForecasting] = useState(false);

  const sm = STATUS_META[kpi.status] || STATUS_META.ON_TRACK;
  const range   = kpi.targetValue - kpi.baselineValue;
  const pct     = range === 0 ? 0 : Math.min(100, Math.max(0,
    Math.round(((kpi.currentValue - kpi.baselineValue) / range) * 100)));
  const linked  = goals.find(g => g.id === kpi.linkedGoalId);

  const sparkData = (kpi.history || []).slice(0, 10).reverse().map((h, i) => ({
    i, v: h.value,
  }));

  const handleRecord = async () => {
    if (newVal === "") return;
    setSaving(true);
    try {
      await recordValue(kpi.id, { value: Number(newVal), note: newNote });
      setShowRecord(false); setNewVal(""); setNewNote(""); onRefresh();
    } finally { setSaving(false); }
  };

  const handleForecast = async () => {
    if (!kpi.linkedGoalId) return;
    setForecasting(true);
    try {
      const r = await forecastGoal(kpi.linkedGoalId);
      // Was unwrapList(r) — /kpis/forecast/{goalId} returns the forecast
      // object directly; this has likely always shown a blank forecast.
      setForecast(r.data);
      setShowForecast(true);
    } finally { setForecasting(false); }
  };

  return (
    <div className={`kpi-card${kpi.alertTriggered ? " kpi-card-alert" : ""}`}>
      {/* Header */}
      <div className="kpi-card-header">
        <div className="kpi-card-left">
          <div className="kpi-card-name">{kpi.name}</div>
          <div className="kpi-card-meta">
            <span className="kpi-category-chip">{kpi.category}</span>
            <span className="kpi-period-chip">{kpi.period}</span>
            {kpi.owner && <span className="kpi-owner">👤 {kpi.owner}</span>}
            {linked && <span className="kpi-linked-goal">🎯 {linked.title}</span>}
          </div>
        </div>
        <div className="kpi-card-actions">
          <span className="kpi-status-chip" style={{ background:sm.bg, color:sm.color }}>
            {sm.label}
          </span>
          {kpi.alertTriggered && (
            <span className="kpi-alert-badge" title="Alert threshold breached">⚠️</span>
          )}
          <button className="btn-icon" onClick={() => onEdit(kpi)}>✏️</button>
          <button className="btn-icon" onClick={() => onDelete(kpi.id)}>🗑️</button>
        </div>
      </div>

      {/* Value + progress */}
      <div className="kpi-value-row">
        <div className="kpi-current-value">
          <span className="kpi-value-num">{kpi.currentValue}</span>
          <span className="kpi-value-unit">{kpi.unit}</span>
        </div>
        <div className="kpi-target-row">
          <span className="kpi-target-label">of {kpi.targetValue}{kpi.unit} target</span>
          <span className="kpi-pct" style={{ color:sm.color }}>{pct}%</span>
        </div>
      </div>
      <div className="kpi-progress-bar">
        <div className="kpi-progress-fill"
          style={{ width:`${pct}%`, background:sm.color }} />
        {kpi.alertEnabled && (
          <div className="kpi-threshold-marker"
            style={{
              left: `${range === 0 ? 50 : Math.min(100, Math.max(0, ((kpi.alertThreshold - kpi.baselineValue)/range)*100))}%`,
              borderColor: sm.color,
            }}
            title={`Alert at ${kpi.alertThreshold}${kpi.unit}`} />
        )}
      </div>

      {/* Sparkline */}
      {sparkData.length > 1 && (
        <div className="kpi-sparkline">
          <ResponsiveContainer width="100%" height={40}>
            <LineChart data={sparkData}>
              <Line type="monotone" dataKey="v" stroke={sm.color} strokeWidth={1.5}
                dot={false} />
              <Tooltip formatter={v => [`${v}${kpi.unit}`, kpi.name]} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Action row */}
      <div className="kpi-card-footer">
        <button className={`btn-secondary${showRecord?" btn-active":""}`}
          style={{ fontSize:"11px", padding:"4px 10px" }}
          onClick={() => setShowRecord(v => !v)}>
          + Record Value
        </button>
        <button className={`btn-secondary${showHistory?" btn-active":""}`}
          style={{ fontSize:"11px", padding:"4px 10px" }}
          onClick={() => setShowHistory(v => !v)}>
          📈 History ({kpi.history?.length || 0})
        </button>
        {kpi.linkedGoalId && (
          <button className={`btn-secondary${showForecast?" btn-active":""}`}
            style={{ fontSize:"11px", padding:"4px 10px" }}
            disabled={forecasting}
            onClick={handleForecast}>
            {forecasting ? "⏳" : "🔮 Forecast"}
          </button>
        )}
      </div>

      {/* Record value panel */}
      {showRecord && (
        <div className="kpi-record-panel">
          <div className="form-row" style={{ alignItems:"flex-end" }}>
            <div className="form-group" style={{ flex:1 }}>
              <label>New value ({kpi.unit})</label>
              <input type="number" value={newVal}
                onChange={e => setNewVal(e.target.value)}
                placeholder={`e.g. ${kpi.currentValue + 10}`} />
            </div>
            <div className="form-group" style={{ flex:2 }}>
              <label htmlFor={"kpi-tracker-note-optional"}>Note (optional)</label>
              <input value={newNote} onChange={e => setNewNote(e.target.value)}
                placeholder="What drove this change?" id={"kpi-tracker-note-optional"} />
            </div>
            <button className="btn-primary" style={{ marginBottom:"4px", padding:"8px 14px" }}
              disabled={saving || newVal === ""} onClick={handleRecord}>
              {saving ? "…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* History panel */}
      {showHistory && (
        <div className="kpi-history-panel">
          {(kpi.history || []).slice(0, 10).map(h => (
            <div key={h.id} className="kpi-history-row">
              <span className="kpi-history-value">{h.value}{kpi.unit}</span>
              <span className="kpi-history-date">
                {new Date(h.recordedAt).toLocaleDateString([], {month:"short",day:"numeric"})}
              </span>
              {h.note && <span className="kpi-history-note">{h.note}</span>}
            </div>
          ))}
          {(!kpi.history || kpi.history.length === 0) && (
            <div className="kpi-history-empty">No history yet. Record a value to start tracking.</div>
          )}
        </div>
      )}

      {/* Forecast panel */}
      {showForecast && forecast && (() => {
        const pm = PREDICT_META[forecast.prediction] || PREDICT_META.UNKNOWN;
        return (
          <div className="kpi-forecast-panel">
            <div className="kpi-forecast-header">
              <span className="kpi-forecast-icon">{pm.icon}</span>
              <span className="kpi-forecast-label" style={{ color:pm.color }}>
                {pm.label}
              </span>
              <span className="kpi-forecast-score">Score: {forecast.forecastScore}/100</span>
            </div>
            <div className="kpi-forecast-reasoning">{forecast.reasoning}</div>
            <div className="kpi-forecast-stats">
              <div><span>Velocity</span><strong>{forecast.velocity} pts/check-in</strong></div>
              <div><span>Est. weeks</span><strong>{forecast.weeksToCompletion}</strong></div>
              <div><span>Confidence trend</span><strong>{forecast.confidenceTrend}</strong></div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Main KPI Tracker page ─────────────────────────────────────
export default function KpiTracker() {
  const [kpis,       setKpis]       = useState([]);
  const [goals,      setGoals]      = useState([]);
  const [showForm,   setShowForm]   = useState(false);
  const [editing,    setEditing]    = useState(null);
  const [filterCat,  setFilterCat]  = useState("");
  const { show: showToast } = useToast();
  const confirm = useConfirm();

  const load = async () => {
    const [kr, gr] = await Promise.all([getKpis(), getGoals()]);
    setKpis(unwrapList(kr));
    setGoals(unwrapList(gr));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern
    load();
  }, []);

  const handleSave = async (form) => {
    if (editing?.id) await updateKpi(editing.id, form);
    else             await createKpi(form);
    setShowForm(false); setEditing(null);
    load();
    showToast(editing?.id ? "KPI updated" : "KPI created", "success");
  };

  const handleDelete = async (id) => {
    const ok = await confirm({ title:"Delete KPI?", message:"This cannot be undone.", danger:true });
    if (!ok) return;
    await deleteKpi(id);
    load();
    showToast("KPI deleted", "success");
  };

  const filtered = filterCat
    ? kpis.filter(k => k.category === filterCat)
    : kpis;

  const alerts  = kpis.filter(k => k.alertTriggered);
  const onTrack = kpis.filter(k => k.status === "ON_TRACK").length;
  const atRisk  = kpis.filter(k => k.status === "AT_RISK" || k.status === "BEHIND").length;
  const achieved= kpis.filter(k => k.status === "ACHIEVED").length;

  return (
    <div>
      <PageHeader
        icon="📊"
        title="KPI Tracker"
        description="Track key performance indicators with threshold alerts and goal forecasting"
        action={
          <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
            + New KPI
          </button>
        }
      />

      {/* Summary */}
      <div className="kpi-summary-bar">
        <div className="kpi-summary-stat">
          <div className="kpi-summary-num">{kpis.length}</div>
          <div className="kpi-summary-label">Total KPIs</div>
        </div>
        <div className="kpi-summary-stat">
          <div className="kpi-summary-num" style={{ color:"#10b981" }}>{onTrack}</div>
          <div className="kpi-summary-label">On Track</div>
        </div>
        <div className="kpi-summary-stat">
          <div className="kpi-summary-num" style={{ color:"#f59e0b" }}>{atRisk}</div>
          <div className="kpi-summary-label">At Risk</div>
        </div>
        <div className="kpi-summary-stat">
          <div className="kpi-summary-num" style={{ color:"#6366f1" }}>{achieved}</div>
          <div className="kpi-summary-label">Achieved</div>
        </div>
        <div className="kpi-summary-stat">
          <div className="kpi-summary-num" style={{ color:"#ef4444" }}>{alerts.length}</div>
          <div className="kpi-summary-label">⚠ Alerts</div>
        </div>
      </div>

      {/* Alert banner */}
      {alerts.length > 0 && (
        <div className="kpi-alert-banner">
          ⚠️ <strong>{alerts.length} KPI{alerts.length > 1 ? "s" : ""}</strong> {alerts.length > 1 ? "have" : "has"} breached the alert threshold:
          {alerts.map(k => <span key={k.id} className="kpi-alert-name">{k.name}</span>)}
        </div>
      )}

      {/* Category filter */}
      <div className="kpi-filter-row">
        {["", ...CATEGORIES].map(c => (
          <button key={c}
            className={`sprint-filter-btn${filterCat === c ? " active" : ""}`}
            onClick={() => setFilterCat(c)}>
            {c || "All"}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="kpi-grid">
        {filtered.map(kpi => (
          <KpiCard key={kpi.id} kpi={kpi} goals={goals}
            onEdit={k => { setEditing(k); setShowForm(true); }}
            onDelete={handleDelete}
            onRefresh={load} />
        ))}
        {filtered.length === 0 && (
          <div className="empty-state">
            No KPIs yet. Create your first KPI to start tracking performance metrics.
          </div>
        )}
      </div>

      {showForm && (
        <KpiForm initial={editing} goals={goals}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null); }} />
      )}
    </div>
  );
}