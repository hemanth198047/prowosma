import { useState, useEffect } from "react";
import { unwrapList } from "../api/client";
import PageHeader from "../components/PageHeader";
import client from "../api/client";
import { getPortfolio }  from "../api/analytics";
import { getKpis }       from "../api/kpis";
import { getGoals }      from "../api/goals";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
} from "recharts";
import "../styles/pages/analytics.css";

const getAISummary = () => client.get("/ai/executive-summary");
const getRisks     = () => client.get("/ai/risks");

// color is literal hex, not var(--token): concatenated with an alpha
// suffix below (`${color}18`), which only works with a real hex string.
function StatCard({ icon, label, value, sub, color="#5B5FEE", trend }) {
  return (
    <div className="exec-stat-card">
      <div className="exec-stat-icon" style={{ background:`${color}18`, color }}>{icon}</div>
      <div className="exec-stat-body">
        <div className="exec-stat-value" style={{ color }}>{value}</div>
        <div className="exec-stat-label">{label}</div>
        {sub  && <div className="exec-stat-sub">{sub}</div>}
        {trend && <div className={`exec-stat-trend ${trend > 0 ? "up" : "down"}`}>
          {trend > 0 ? "▲" : "▼"} {Math.abs(trend)}%
        </div>}
      </div>
    </div>
  );
}

export default function ExecutiveDashboard() {
  const [portfolio, setPortfolio] = useState([]);
  const [kpis,      setKpis]      = useState([]);
  const [goals,     setGoals]     = useState([]);
  const [risks,     setRisks]     = useState([]);
  const [aiSummary, setAiSummary] = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      getPortfolio(), getKpis(), getGoals(), getRisks(),
    ]).then(([pr, kr, gr, rr]) => {
      // getPortfolio returns {projects:[...], ...} not a plain array
      const portfolioData = pr.data;
      setPortfolio(Array.isArray(portfolioData)
        ? portfolioData
        : Array.isArray(portfolioData?.projects)
          ? portfolioData.projects
          : []);
      setKpis(kr.data);
      setGoals(unwrapList(gr));
      setRisks(Array.isArray(rr.data?.risks) ? rr.data.risks : []);
    }).catch(() => {})
    .finally(() => setLoading(false));
  }, []);

  const loadAISummary = async () => {
    setAiLoading(true);
    try {
      const r = await getAISummary();
      // Was unwrapList(r) — /ai/executive-summary returns the summary
      // object directly; the AI summary card has likely always shown
      // nothing until the catch-block fallback text kicked in.
      setAiSummary(r.data);
    } catch { setAiSummary({ summary:"AI summary unavailable. Check AI settings." }); }
    finally { setAiLoading(false); }
  };

  // Computed stats
  const activeProjects  = portfolio.filter(p => p.status === "ACTIVE").length;
  const atRiskProjects  = portfolio.filter(p => (p.health||100) < 60).length;
  const goalOnTrack     = goals.filter(g => g.confidence >= 60 && g.status === "ACTIVE").length;
  const goalAtRisk      = goals.filter(g => g.confidence < 60 && g.status === "ACTIVE").length;
  const kpiAlerts       = kpis.filter(k => k.alertTriggered).length;
  const avgHealth       = portfolio.length > 0
    ? Math.round(portfolio.reduce((s,p) => s + (Number(p.health) || 0), 0) / portfolio.length)
    : null; // null = no data, show "—" instead of NaN%

  // Radar chart data
  const radarData = [
    { subject:"Projects",   A: Math.min(100, activeProjects * 10) },
    { subject:"Goals",      A: goals.length ? Math.round(goalOnTrack/goals.length*100) : 0 },
    { subject:"KPIs",       A: kpis.length  ? Math.round(kpis.filter(k=>k.status==="ON_TRACK").length/kpis.length*100) : 0 },
    { subject:"Capacity",   A: 70 },
    { subject:"Health",     A: avgHealth ?? 0 },
    { subject:"Execution",  A: Math.max(0, 100 - atRiskProjects*15) },
  ];

  if (loading) return <div className="analytics-loading"><div className="analytics-spinner" /></div>;

  return (
    <div>
      <PageHeader icon="🎯" title="Executive Dashboard"
        description="One-screen strategic view: portfolio health, goals, KPIs, risks, and AI narrative"
        action={
          <button className="btn-primary" onClick={loadAISummary} disabled={aiLoading}>
            {aiLoading ? "⏳ Generating…" : "🤖 AI Narrative"}
          </button>
        }
      />

      {/* AI Narrative */}
      {aiSummary && (
        <div className="exec-ai-narrative">
          <div className="exec-ai-header">
            <span className="exec-ai-icon">🤖</span>
            <span className="exec-ai-title">AI Executive Summary</span>
            <button className="btn-icon" onClick={() => setAiSummary(null)}>✕</button>
          </div>
          <div className="exec-ai-text">{aiSummary.summary}</div>
          {aiSummary.keyRisks?.length > 0 && (
            <div className="exec-ai-risks">
              <strong>Key Risks:</strong>
              {aiSummary.keyRisks.map((r,i) => <span key={i} className="exec-risk-chip">{r}</span>)}
            </div>
          )}
          {aiSummary.recommendations?.length > 0 && (
            <div className="exec-ai-recs">
              <strong>Recommendations:</strong>
              <ul>{aiSummary.recommendations.map((r,i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {/* KPI row */}
      <div className="exec-stat-row">
        <StatCard icon="📁" label="Active Projects"  value={activeProjects}  color="#5B5FEE"
          sub={atRiskProjects > 0 ? `${atRiskProjects} at risk` : "All healthy"} />
        <StatCard icon="🎯" label="Goals On Track"   value={goalOnTrack}     color="#1E8E5A"
          sub={goalAtRisk > 0 ? `${goalAtRisk} at risk` : "All on track"} />
        <StatCard icon="📊" label="Portfolio Health"
          value={avgHealth !== null ? `${avgHealth}%` : "—"}
          color={avgHealth === null ? "#64748b" : avgHealth >= 70 ? "#1E8E5A" : avgHealth >= 50 ? "#C17D22" : "#D64545"}
          sub={avgHealth === null ? "No projects yet" : undefined} />
        <StatCard icon="⚠️" label="KPI Alerts"       value={kpiAlerts}       color="#D64545"
          sub={kpiAlerts === 0 ? "All clear" : "Threshold breached"} />
        <StatCard icon="✅" label="Total Goals"       value={goals.length}    color="#7C5CBF"
          sub={`${goals.filter(g=>g.status==="ACHIEVED").length} achieved`} />
      </div>

      <div className="exec-grid">
        {/* Radar chart */}
        <div className="exec-card">
          <div className="exec-card-title">🕸 Organisational Health Radar</div>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize:11 }} />
              <Radar name="Score" dataKey="A" stroke="var(--brand-500)" fill="var(--brand-500)" fillOpacity={0.25} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Top risks */}
        <div className="exec-card">
          <div className="exec-card-title">🚨 Top Risks</div>
          {risks.slice(0,5).map((r,i) => (
            <div key={i} className="exec-risk-row">
              <span className={`exec-risk-sev exec-risk-${r.severity?.toLowerCase()||"medium"}`}>
                {r.severity || "MEDIUM"}
              </span>
              <div className="exec-risk-info">
                <div className="exec-risk-title">{r.risk || r.title}</div>
                {r.project && <div className="exec-risk-meta">📁 {r.project}</div>}
              </div>
            </div>
          ))}
          {risks.length === 0 && (
            <div className="exec-empty">No risks detected. Use AI → Detect Risks to scan.</div>
          )}
        </div>

        {/* KPI status */}
        <div className="exec-card">
          <div className="exec-card-title">📊 KPI Status</div>
          {kpis.slice(0,6).map(k => {
            const range = k.targetValue - k.baselineValue;
            const pct   = range===0 ? 0 : Math.min(100,Math.round(((k.currentValue-k.baselineValue)/range)*100));
            const color = k.status==="ON_TRACK" ? "var(--success)" : k.status==="ACHIEVED" ? "var(--brand-500)" : k.status==="AT_RISK" ? "var(--warning)" : "var(--danger)";
            return (
              <div key={k.id} className="exec-kpi-row">
                <div className="exec-kpi-name">{k.name}</div>
                <div className="exec-kpi-bar">
                  <div className="exec-kpi-fill" style={{ width:`${pct}%`, background:color }} />
                </div>
                <div className="exec-kpi-pct" style={{ color }}>{pct}%</div>
              </div>
            );
          })}
          {kpis.length === 0 && <div className="exec-empty">No KPIs yet. Create them in KPI Tracker.</div>}
        </div>

        {/* Goals confidence */}
        <div className="exec-card">
          <div className="exec-card-title">🎯 Goal Confidence</div>
          {goals.filter(g=>g.status==="ACTIVE").slice(0,6).map(g => {
            const conf = g.confidence || 50;
            const color = conf >= 70 ? "var(--success)" : conf >= 40 ? "var(--warning)" : "var(--danger)";
            return (
              <div key={g.id} className="exec-kpi-row">
                <div className="exec-kpi-name">{g.title}</div>
                <div className="exec-kpi-bar">
                  <div className="exec-kpi-fill" style={{ width:`${conf}%`, background:color }} />
                </div>
                <div className="exec-kpi-pct" style={{ color }}>{conf}%</div>
              </div>
            );
          })}
          {goals.length === 0 && <div className="exec-empty">No active goals found.</div>}
        </div>

        {/* Portfolio table */}
        <div className="exec-card exec-card-wide">
          <div className="exec-card-title">📁 Portfolio Overview</div>
          <table className="exec-table">
            <thead>
              <tr><th>Project</th><th>Status</th><th>Health</th><th>Progress</th></tr>
            </thead>
            <tbody>
              {portfolio.slice(0,8).map(p => {
                const h = p.health || 80;
                const color = h >= 70 ? "var(--success)" : h >= 50 ? "var(--warning)" : "var(--danger)";
                return (
                  <tr key={p.id}>
                    <td className="exec-table-name">{p.name}</td>
                    <td><span className={`portfolio-status-chip portfolio-status-${p.status?.toLowerCase()}`}>{p.status}</span></td>
                    <td><span style={{ color, fontWeight:700 }}>{h}%</span></td>
                    <td>
                      <div className="exec-mini-bar">
                        <div className="exec-mini-fill" style={{ width:`${p.completionRate||0}%`, background:color }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {portfolio.length === 0 && <div className="exec-empty">No projects in portfolio.</div>}
        </div>
      </div>
    </div>
  );
}