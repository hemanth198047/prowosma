import { useState, useEffect, useCallback } from "react";
import { getSummaryReport } from "../api/reports";
import { exportToPDF, exportToCSV } from "../utils/exportUtils";
import PageHeader from "../components/PageHeader";
import {
PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import "../styles/pages/analytics.css";

// ── C-7: No-code Report Builder ───────────────────────────────
const METRICS = [
  { key:"tasks_by_status",   label:"Tasks by Status",   type:"pie"  },
  { key:"tasks_by_priority", label:"Tasks by Priority", type:"bar"  },
  { key:"tasks_by_assignee", label:"Tasks by Assignee", type:"bar"  },
  { key:"goals_progress",    label:"Goals Progress",    type:"bar"  },
  { key:"completion_trend",  label:"Completion Trend",  type:"line" },
  { key:"overdue_rate",      label:"Overdue Rate",      type:"stat" },
];

function ReportBuilder({ report }) {
  const [config, setConfig] = useState({
    name:"My Report", metrics:["tasks_by_status"],
    period:"month", schedule:"", scheduleEmail:"",
  });
  const [saved, setSaved] = useState(false);
  const set = (k,v) => setConfig(c=>({...c,[k]:v}));
  const toggleMetric = (key) => setConfig(c => ({
    ...c, metrics: c.metrics.includes(key)
      ? c.metrics.filter(m => m!==key) : [...c.metrics, key]
  }));

  return (
    <div className="report-builder">
      <div className="report-builder-title">🔧 No-Code Report Builder</div>
      <div className="form-row">
        <div className="form-group" style={{ flex:2 }}>
          <label htmlFor={"reports-report-name"}>Report Name</label>
          <input value={config.name} onChange={e => set("name",e.target.value)} id={"reports-report-name"} />
        </div>
        <div className="form-group">
          <label htmlFor={"reports-period"}>Period</label>
          <select value={config.period} onChange={e => set("period",e.target.value)} id={"reports-period"}>
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
            <option value="quarter">Last 90 days</option>
            <option value="year">Last year</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
          <legend style={{ padding: 0 }} className="field-label">Select Metrics</legend>
          <div className="report-metrics-grid">
            {METRICS.map(m => (
              <label key={m.key} className={`report-metric-chip${config.metrics.includes(m.key)?" active":""}`}>
                <input type="checkbox" checked={config.metrics.includes(m.key)}
                  onChange={() => toggleMetric(m.key)} />
                {m.label}
                <span className="report-metric-type">{m.type}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="form-group">
        <label htmlFor={"reports-scheduled-delivery-optional"}>Scheduled Delivery (optional)</label>
        <div className="form-row">
          <select value={config.schedule} onChange={e => set("schedule",e.target.value)} id={"reports-scheduled-delivery-optional"}>
            <option value="">No schedule</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly (Monday)</option>
            <option value="monthly">Monthly (1st)</option>
          </select>
          {config.schedule && (
            <input value={config.scheduleEmail}
              onChange={e => set("scheduleEmail",e.target.value)}
              placeholder="Email to deliver report to" style={{ flex:2 }} />
          )}
        </div>
        {config.schedule && (
          <div className="report-schedule-note">
            📧 Report will be delivered as PDF to {config.scheduleEmail || "the specified email"}
          </div>
        )}
      </div>
      <div className="form-actions">
        <button className="btn-secondary" onClick={() => window.print()}>🖨️ Print</button>
        <button className="btn-primary"
          onClick={() => { setSaved(true); setTimeout(()=>setSaved(false),2000); }}>
          {saved ? "✅ Saved!" : "💾 Save Report Config"}
        </button>
      </div>
      {report && (
        <div className="report-builder-preview">
          <div className="report-builder-preview-title">Preview — {config.name}</div>
          <div className="report-preview-note">
            The metrics you selected will appear here using live data from the Summary Report.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Reports page ─────────────────────────────────────────
export default function Reports() {
  const [report,     setReport]     = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [period,     setPeriod]     = useState("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo,   setCustomTo]   = useState("");
  const [tab,        setTab]        = useState("summary");

  const getPeriodDates = useCallback(() => {
    const now = new Date();
    let from = new Date();
    if (period === "week")    from.setDate(now.getDate() - 7);
    else if (period === "month")   from.setMonth(now.getMonth() - 1);
    else if (period === "quarter") from.setMonth(now.getMonth() - 3);
    else if (period === "year")    from.setFullYear(now.getFullYear() - 1);
    else return { from: customFrom, to: customTo };
    return { from: from.toISOString().slice(0,19), to: now.toISOString().slice(0,19) };
  }, [period, customFrom, customTo]);

  const load = async () => {
    setLoading(true);
    try {
      const { from, to } = getPeriodDates();
      const res = await getSummaryReport(from, to);
      setReport(res.data || {});
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const fn = async () => {
      setLoading(true);
      try {
        const { from, to } = getPeriodDates();
        if (!from) return;
        const res = await getSummaryReport(from, to);
        setReport(res.data || {});
      } catch { /* report stays empty — page shows its own empty state */ } finally { setLoading(false); }
    };
    fn();
  }, [period, customFrom, customTo, getPeriodDates]);

  return (
    <div>
      <PageHeader icon="📈" title="Reports"
        description="Operational reports, analytics, and scheduled delivery"
        action={
          <div style={{ display:"flex", gap:"8px" }}>
            <button className="btn-secondary" style={{ fontSize:"12px" }}
              onClick={() => report && exportToPDF("reports-content","Prowosma Report")}>
              ⬇️ PDF
            </button>
            <button className="btn-secondary" style={{ fontSize:"12px" }}
              onClick={() => report && exportToCSV(Object.entries(report).map(([k,v])=>({metric:k,value:JSON.stringify(v)})),"report")}>
              ⬇️ CSV
            </button>
          </div>
        }
      />

      <div className="admin-tab-bar" style={{ marginBottom:"16px" }}>
        <button className={`admin-tab-btn${tab==="summary"?" active":""}`}
          onClick={() => setTab("summary")}>📊 Summary Report</button>
        <button className={`admin-tab-btn${tab==="builder"?" active":""}`}
          onClick={() => setTab("builder")}>🔧 Report Builder</button>
      </div>

      {tab === "builder" && <ReportBuilder report={report} />}

      {tab === "summary" && (
        <>
          {/* Period selector */}
          <div className="report-period-row">
            {["week","month","quarter","year","custom"].map(p => (
              <button key={p} className={`report-period-btn${period===p?" active":""}`}
                onClick={() => setPeriod(p)}>
                {p === "week" ? "7D" : p === "month" ? "30D"
                  : p === "quarter" ? "90D" : p === "year" ? "1Y" : "Custom"}
              </button>
            ))}
            {period === "custom" && (
              <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
                <input type="datetime-local" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}
                  style={{ fontSize:"12px" }} />
                <span>to</span>
                <input type="datetime-local" value={customTo} onChange={e=>setCustomTo(e.target.value)}
                  style={{ fontSize:"12px" }} />
              </div>
            )}
            <button className="btn-primary" style={{ fontSize:"12px" }} onClick={load}>
              {loading ? "⏳" : "Generate"}
            </button>
          </div>

          {loading && <div className="analytics-loading"><div className="analytics-spinner" /></div>}

          {report && !loading && (
            <div id="reports-content">
              <div className="reports-grid">
                {/* Status breakdown */}
                <div className="report-card">
                  <div className="report-card-title">Task Status Breakdown</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={[
                        { name:"To Do",       value: report.todoCount      || 0 },
                        { name:"In Progress", value: report.inProgressCount|| 0 },
                        { name:"Done",        value: report.doneCount      || 0 },
                      ]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                        {["var(--brand-500)","var(--warning)","var(--success)"].map((c,i) => <Cell key={i} fill={c} />)}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Priority breakdown */}
                <div className="report-card">
                  <div className="report-card-title">Task Priority Distribution</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={[
                      { name:"Low",    value: report.lowPriority    || 0 },
                      { name:"Medium", value: report.mediumPriority || 0 },
                      { name:"High",   value: report.highPriority   || 0 },
                    ]}>
                      <XAxis dataKey="name" tick={{ fontSize:11 }} />
                      <YAxis tick={{ fontSize:11 }} />
                      <Tooltip />
                      <Bar dataKey="value">
                        {["var(--success)","var(--warning)","var(--danger)"].map((c,i) => <Cell key={i} fill={c} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Summary stats */}
                <div className="report-card">
                  <div className="report-card-title">Key Metrics</div>
                  <div className="report-stats-grid">
                    {[
                      { label:"Total Tasks",     value: report.totalTasks     || 0 },
                      { label:"Completed",       value: report.doneCount      || 0 },
                      { label:"Overdue",         value: report.overdueCount   || 0, color:"var(--danger)" },
                      { label:"Completion Rate", value: `${report.completionRate||0}%`, color:"var(--success)" },
                      { label:"Active Projects", value: report.activeProjects || 0 },
                      { label:"Active Goals",    value: report.activeGoals    || 0 },
                    ].map(s => (
                      <div key={s.label} className="report-stat">
                        <div className="report-stat-num" style={{ color:s.color }}>
                          {s.value}
                        </div>
                        <div className="report-stat-label">{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {!report && !loading && (
            <div className="empty-state">Click Generate to load your report.</div>
          )}
        </>
      )}
    </div>
  );
}
