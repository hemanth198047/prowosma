import { useState, useEffect } from "react";
import { unwrapList } from "../api/client";
import client from "../api/client";
import { getAnalytics, getWorkload } from "../api/analytics";
import PageHeader from "../components/PageHeader";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import "../styles/pages/analytics.css";

// ── KPI Card ──────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, color, suffix = "" }) {
  return (
    <div className="analytics-kpi-card">
      <div className="analytics-kpi-icon" style={{ background: color + "18", color }}>
        {icon}
      </div>
      <div className="analytics-kpi-body">
        <div className="analytics-kpi-value" style={{ color }} title={typeof value === "string" || typeof value === "number" ? String(value) : undefined}>
          {value}{suffix}
        </div>
        <div className="analytics-kpi-label">{label}</div>
        {sub && <div className="analytics-kpi-sub">{sub}</div>}
      </div>
    </div>
  );
}

// ── Health badge ──────────────────────────────────────────────
function HealthBadge({ health }) {
  const map = {
    HEALTHY:  { label: "Healthy",  color:"#1E8E5A", bg: "rgba(5,150,105,0.12)" },
    AT_RISK:  { label: "At Risk",  color:"#C17D22", bg: "rgba(217,119,6,0.12)" },
    CRITICAL: { label: "Critical", color:"#D64545", bg: "rgba(239,68,68,0.12)" },
  };
  const s = map[health] || map.AT_RISK;
  return (
    <span className="analytics-health-badge" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

// ── Custom tooltip ────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="analytics-tooltip">
      <div className="analytics-tooltip-label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontSize: "12px" }}>
          {p.name}: <strong>{p.value}</strong>
        </div>
      ))}
    </div>
  );
};

// ── D-2: Per-member workload view ─────────────────────────────
function WorkloadView() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getWorkload()
      .then(r => setMembers(unwrapList(r)))
      .finally(() => setLoading(false));
  }, []);

  const LOAD_META = {
    HIGH:   { label: "High Load",   color:"#D64545", bg: "rgba(239,68,68,0.12)" },
    MEDIUM: { label: "Medium Load", color:"#C17D22", bg: "rgba(217,119,6,0.12)" },
    LOW:    { label: "Available",   color:"#1E8E5A", bg: "rgba(5,150,105,0.12)" },
  };

  if (loading) return <div className="analytics-loading"><div className="analytics-spinner" /></div>;

  if (!members.length) return (
    <div className="empty-state">
      No team members with assigned tasks. Assign tasks to team members to see workload data.
    </div>
  );

  return (
    <div className="workload-wrap">
      <div className="workload-summary-row">
        {["HIGH", "MEDIUM", "LOW"].map(level => {
          const count = members.filter(m => m.loadLevel === level).length;
          const m = LOAD_META[level];
          return (
            <div key={level} className="workload-summary-chip"
              style={{ background: m.bg, border: `1px solid ${m.color}33` }}>
              <span style={{ fontSize: "20px", fontWeight: 800, color: m.color }}>{count}</span>
              <span style={{ fontSize: "11px", color: m.color, fontWeight: 600 }}>{m.label}</span>
            </div>
          );
        })}
      </div>

      <div className="workload-grid">
        {members.map(m => {
          const lm = LOAD_META[m.loadLevel] || LOAD_META.LOW;
          return (
            <div key={m.email} className="workload-card">
              <div className="workload-card-header">
                <div className="workload-avatar">{m.avatar}</div>
                <div className="workload-member-info">
                  <div className="workload-member-name">{m.name}</div>
                  <div className="workload-member-role">{m.role || "Member"}</div>
                </div>
                <span className="workload-load-badge" style={{ background: lm.bg, color: lm.color }}>
                  {lm.label}
                </span>
              </div>

              <div className="workload-stats">
                {[
                  { num: m.total,  label: "Total",  color:"#5B5FEE" },
                  { num: m.active, label: "Active",  color:"#C17D22" },
                  { num: m.done,   label: "Done",    color:"#1E8E5A" },
                  { num: m.overdue,label: "Overdue", color:"#D64545" },
                ].map(s => (
                  <div key={s.label} className="workload-stat">
                    <span className="workload-stat-num" style={{ color: s.color }}>{s.num}</span>
                    <span className="workload-stat-label">{s.label}</span>
                  </div>
                ))}
              </div>

              <div className="workload-completion">
                <div style={{ display: "flex", justifyContent: "space-between",
                  fontSize: "11px", color:"#94a3b8", marginBottom: "4px" }}>
                  <span>Completion rate</span>
                  <span style={{ fontWeight: 700, color:"#475569" }}>{m.completionRate}%</span>
                </div>
                <div className="workload-completion-bar">
                  <div style={{
                    width: `${m.completionRate}%`, height: "100%", borderRadius: "99px", transition: "width .4s",
                    background: m.completionRate >= 70 ? "var(--success)" : m.completionRate >= 40 ? "var(--warning)" : "var(--danger)",
                  }} />
                </div>
              </div>

              {m.weekly?.length > 0 && (
                <div className="workload-sparkline">
                  <div style={{ fontSize: "10px", color:"#94a3b8", marginBottom: "4px" }}>
                    Weekly completions (last 6 weeks)
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: "3px", height: "32px" }}>
                    {m.weekly.map((w, i) => {
                      const maxVal = Math.max(...m.weekly.map(x => x.completed), 1);
                      const h = Math.max(4, Math.round((w.completed / maxVal) * 28));
                      return (
                        <div key={i} title={`${w.week}: ${w.completed} completed`}
                          style={{
                            flex: 1, height: `${h}px`, borderRadius: "2px 2px 0 0",
                            background: w.completed > 0 ? "var(--brand-500)" : "var(--gray-200)",
                            transition: "height .3s", alignSelf: "flex-end",
                          }} />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Analytics page ───────────────────────────────────────

// C-12: Resource Forecasting
function ResourceForecast() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      client.get("/analytics/workload"),
      client.get("/analytics/portfolio"),
    ]).then(([wr, pr]) => {
      const members  = wr.data || [];
      const projects = pr.data || [];
      // Forecast: extrapolate current workload 4 weeks out
      // workload endpoint returns: active (in-progress), total, done, overdue
      // We use active tasks as current load, total as proxy for capacity
      const forecast = members.map(m => {
        const current  = m.active  || 0;
        const capacity = 8; // standard capacity: 8 active tasks at once
        const utilPct  = Math.min(100, Math.round((current / capacity) * 100));
        const f4w      = Math.min(100, Math.round(utilPct * 1.1));
        const risk     = current > capacity ? "OVERLOADED"
                       : current > capacity * 0.75 ? "HIGH" : "NORMAL";
        return {
          name:        m.name || m.email,
          current,
          capacity,
          utilization: utilPct,
          forecast4w:  f4w,
          risk,
        };
      });
      setData({ members: forecast, projects });
    }).catch(() => setData({ members:[], projects:[] }))
    .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="analytics-loading"><div className="analytics-spinner" /></div>;

  return (
    <div>
      <div className="analytics-section-title">📅 Resource Forecast — Next 4 Weeks</div>
      <div className="resource-forecast-grid">
        {(data?.members || []).map((m, i) => {
          const color = m.risk === "OVERLOADED" ? "var(--danger)" : m.risk === "HIGH" ? "var(--warning)" : "var(--success)";
          return (
            <div key={i} className="resource-forecast-card">
              <div className="resource-forecast-header">
                <div className="resource-forecast-avatar">
                  {(m.name||"?").slice(0,2).toUpperCase()}
                </div>
                <div className="resource-forecast-info">
                  <div className="resource-forecast-name">{m.name}</div>
                  <span className={`resource-risk-badge resource-risk-${m.risk.toLowerCase()}`}>
                    {m.risk}
                  </span>
                </div>
              </div>
              <div className="resource-forecast-bars">
                <div className="resource-bar-row">
                  <span className="resource-bar-label">Now</span>
                  <div className="resource-bar-track">
                    <div className="resource-bar-fill" style={{ width:`${m.utilization}%`, background:color }} />
                  </div>
                  <span className="resource-bar-pct" style={{ color }}>{m.utilization}%</span>
                </div>
                <div className="resource-bar-row">
                  <span className="resource-bar-label">+4w</span>
                  <div className="resource-bar-track">
                    <div className="resource-bar-fill" style={{ width:`${m.forecast4w}%`, background:`${color}88` }} />
                  </div>
                  <span className="resource-bar-pct" style={{ color:`${color}aa` }}>{m.forecast4w}%</span>
                </div>
              </div>
            </div>
          );
        })}
        {(data?.members || []).length === 0 && (
          <div className="empty-state">No team members found. Add team members to see resource forecasting.</div>
        )}
      </div>
    </div>
  );
}

export default function Analytics() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // D-3: View tabs
  const [activeView, setActiveView] = useState("overview");
  // C-12: Resource forecast tab added

  // D-3: Widget visibility (persisted in localStorage)
  const [widgets, setWidgets] = useState(() => {
    try {
      const saved = localStorage.getItem("analytics_widgets");
      return saved ? JSON.parse(saved) : {
        velocity: true, burndown: true, status: true,
        priority: true, trend: true, capacity: true, health: true,
      };
    } catch {
      return { velocity: true, burndown: true, status: true,
               priority: true, trend: true, capacity: true, health: true };
    }
  });
  const [showWidgetConfig, setShowWidgetConfig] = useState(false);

  const toggleWidget = (key) => {
    setWidgets(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem("analytics_widgets", JSON.stringify(next));
      return next;
    });
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAnalytics();
      setData(res.data);
    } catch {
      setError("Failed to load analytics");
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern
  useEffect(() => { load(); }, []);

  if (loading) return (
    <div>
      <PageHeader icon="📊" title="Analytics" description="Loading…" />
      <div className="analytics-loading">
        <div className="analytics-spinner" />
        <p>Crunching the numbers…</p>
      </div>
    </div>
  );

  if (error) return (
    <div>
      <PageHeader icon="📊" title="Analytics" description="Business intelligence dashboard" />
      <div className="empty-state">{error}</div>
    </div>
  );

  const { kpis, velocity, burndown, capacity, projectHealth,
          tasksByStatus, tasksByPriority, completionTrend } = data;

  return (
    <div>
      <PageHeader
        icon="📊"
        title="Analytics"
        description="Operational intelligence — velocity, health scores, capacity planning"
        action={
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {/* View switcher */}
            <div style={{ display: "flex", gap: "4px", background: "var(--gray-100)",
              borderRadius: "var(--radius-sm)", padding: "3px" }}>
              {[
                { key: "overview", label: "📊 Overview" },
                { key: "workload", label: "👥 Workload" },
                { key: "forecast", label: "📅 Forecast" },
              ].map(v => (
                <button key={v.key} onClick={() => setActiveView(v.key)}
                  style={{
                    padding: "5px 12px", border: "none", borderRadius: "5px",
                    fontSize: "12px", fontWeight: 600, cursor: "pointer",
                    background: activeView === v.key ? "var(--bg-card)" : "transparent",
                    color: activeView === v.key ? "var(--brand-600)" : "var(--gray-500)",
                  }}>
                  {v.label}
                </button>
              ))}
            </div>
            <button className="btn-secondary" style={{ fontSize: "12px" }}
              onClick={() => setShowWidgetConfig(v => !v)}>
              ⚙ Widgets
            </button>
            <button className="btn-secondary" style={{ fontSize: "12px" }} onClick={load}>
              ↺ Refresh
            </button>
          </div>
        }
      />

      {/* D-3: Widget configurator */}
      {showWidgetConfig && (
        <div className="analytics-widget-config">
          <div className="analytics-widget-config-title">⚙ Configure Widgets</div>
          <div className="analytics-widget-config-grid">
            {[
              ["velocity", "⚡ Velocity"],
              ["burndown", "📉 Burndown"],
              ["status",   "🍩 By Status"],
              ["priority", "🔥 By Priority"],
              ["trend",    "📈 30-Day Trend"],
              ["capacity", "👥 Capacity"],
              ["health",   "🏥 Project Health"],
            ].map(([key, label]) => (
              <label key={key} className="analytics-widget-toggle">
                <input type="checkbox" checked={!!widgets[key]} onChange={() => toggleWidget(key)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ── D-2: Workload view ── */}
      {activeView === "workload"  && <WorkloadView />}
      {activeView === "forecast" && <ResourceForecast />}

      {/* ── Overview view ── */}
      {activeView === "overview" && (
        <div>
          {/* KPI Row */}
          <div className="analytics-kpi-row">
            <KpiCard icon="✅" label="Completion Rate"   value={kpis.completionRate}  suffix="%" color="var(--success)"
              sub={`${kpis.completedTasks} of ${kpis.totalTasks} tasks done`} />
            <KpiCard icon="⚡" label="In Progress"       value={kpis.inProgress}      color="var(--warning)"
              sub="tasks active right now" />
            <KpiCard icon="⚠️" label="Overdue Tasks"     value={kpis.overdueTasks}    color="var(--danger)"
              sub={`${kpis.overdueRate}% of all tasks`} />
            <KpiCard icon="⏱️" label="Avg Task Age"      value={kpis.avgTaskAgeDays}  suffix=" days" color="var(--brand-500)"
              sub="for open tasks" />
            <KpiCard icon="🎯" label="Goal Success Rate" value={kpis.goalSuccessRate} suffix="%" color="var(--purple)"
              sub={`${kpis.achievedGoals} of ${kpis.totalGoals} goals achieved`} />
            <KpiCard icon="🏆" label="Most Productive"   value={kpis.topUser}         color="#0ea5e9"
              sub="this month" />
          </div>

          {/* Row 1: Velocity + Status */}
          {(widgets.velocity || widgets.status) && (
            <div className="analytics-row">
              {widgets.velocity && (
                <div className="analytics-card analytics-card-wide">
                  <div className="analytics-card-title">⚡ Weekly Velocity</div>
                  <div className="analytics-card-sub">Tasks created vs completed per week</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={velocity} barGap={4}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="created"   name="Created"   fill="var(--brand-500)" radius={[3,3,0,0]} />
                      <Bar dataKey="completed" name="Completed" fill="var(--success)" radius={[3,3,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {widgets.status && (
                <div className="analytics-card analytics-card-narrow">
                  <div className="analytics-card-title">🍩 Tasks by Status</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={tasksByStatus} dataKey="value" nameKey="name"
                        cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3}>
                        {tasksByStatus.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip formatter={(v, n) => [v, n]} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Row 2: Burndown + Priority */}
          {(widgets.burndown || widgets.priority) && (
            <div className="analytics-row">
              {widgets.burndown && (
                <div className="analytics-card analytics-card-wide">
                  <div className="analytics-card-title">📉 Burndown</div>
                  <div className="analytics-card-sub">Remaining tasks vs ideal completion line</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={burndown}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={3} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="remaining" name="Remaining"
                        stroke="var(--brand-500)" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="ideal" name="Ideal"
                        stroke="var(--gray-400)" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              {widgets.priority && (
                <div className="analytics-card analytics-card-narrow">
                  <div className="analytics-card-title">🔥 Tasks by Priority</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={tasksByPriority} dataKey="value" nameKey="name"
                        cx="50%" cy="50%" outerRadius={85} paddingAngle={3}>
                        {tasksByPriority.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip formatter={(v, n) => [v, n]} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Row 3: 30-Day Trend */}
          {widgets.trend && (
            <div className="analytics-row">
              <div className="analytics-card" style={{ flex: 1 }}>
                <div className="analytics-card-title">📈 30-Day Completion Trend</div>
                <div className="analytics-card-sub">Daily task completions over the last month</div>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={completionTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="completions" name="Completions"
                      stroke="var(--success)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Row 4: Capacity + Project Health */}
          {(widgets.capacity || widgets.health) && (
            <div className="analytics-row analytics-row-bottom">
              {widgets.capacity && (
                <div className="analytics-card analytics-card-medium">
                  <div className="analytics-card-title">👥 Team Capacity</div>
                  <div className="analytics-card-sub">Active tasks per team member</div>
                  {capacity.length === 0 ? (
                    <p className="empty-state" style={{ padding: "20px 0", fontSize: "13px" }}>
                      No team members with assigned tasks
                    </p>
                  ) : (
                    <div className="analytics-capacity-list">
                      {capacity.map((m, i) => {
                        const pct  = m.total === 0 ? 0 : Math.round(m.completed * 100 / m.total);
                        const load = m.active > 8 ? "high" : m.active > 4 ? "medium" : "low";
                        return (
                          <div key={i} className="analytics-capacity-row">
                            <div className="analytics-capacity-avatar">
                              {m.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="analytics-capacity-info">
                              <div className="analytics-capacity-name">
                                {m.name}
                                <span className={`analytics-load-badge analytics-load-${load}`}>
                                  {m.active} active
                                </span>
                              </div>
                              <div className="analytics-capacity-bar-wrap">
                                <div className="analytics-capacity-bar">
                                  <div className="analytics-capacity-bar-fill"
                                    style={{ width: `${pct}%` }} />
                                </div>
                                <span className="analytics-capacity-pct">{pct}%</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {widgets.health && (
                <div className="analytics-card analytics-card-medium">
                  <div className="analytics-card-title">🏥 Project Health Scores</div>
                  <div className="analytics-card-sub">0–100 score based on completion & overdue rate</div>
                  {projectHealth.length === 0 ? (
                    <p className="empty-state" style={{ padding: "20px 0", fontSize: "13px" }}>
                      No projects yet
                    </p>
                  ) : (
                    <div className="analytics-health-list">
                      {projectHealth.map((p, i) => (
                        <div key={i} className="analytics-health-row">
                          <div className="analytics-health-dot"
                            style={{ background: p.color || "var(--brand-500)" }} />
                          <div className="analytics-health-info">
                            <div className="analytics-health-name">
                              {p.name}
                              <HealthBadge health={p.health} />
                            </div>
                            <div className="analytics-health-bar-wrap">
                              <div className="analytics-health-bar">
                                <div className="analytics-health-bar-fill"
                                  style={{
                                    width: `${p.score}%`,
                                    background: p.health === "HEALTHY" ? "var(--success)"
                                              : p.health === "AT_RISK"  ? "var(--warning)"
                                              : "var(--danger)",
                                  }} />
                              </div>
                              <span className="analytics-health-score">{p.score}</span>
                            </div>
                            <div className="analytics-health-meta">
                              {p.done}/{p.totalTasks} tasks · {p.overdue} overdue
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}