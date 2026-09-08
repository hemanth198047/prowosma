import client from "../api/client";
import React from "react";
import { unwrapList } from "../api/client";
import { useState, useEffect } from "react";
import { getPortfolio, getCriticalPath } from "../api/analytics";
import PageHeader from "../components/PageHeader";
import { useNavigate } from "react-router-dom";
import {
RadialBarChart, RadialBar, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
} from "recharts";
import "../styles/pages/analytics.css";

const HEALTH_META = {
  HEALTHY:  { label:"Healthy",  color:"#10b981", bg:"rgba(5,150,105,0.12)" },
  AT_RISK:  { label:"At Risk",  color:"#f59e0b", bg:"rgba(217,119,6,0.12)" },
  CRITICAL: { label:"Critical", color:"#ef4444", bg:"rgba(239,68,68,0.12)" },
};

function HealthBadge({ health }) {
  const m = HEALTH_META[health] || HEALTH_META.AT_RISK;
  return (
    <span style={{ fontSize:"11px", fontWeight:700, padding:"2px 8px",
      borderRadius:"99px", background:m.bg, color:m.color }}>
      {m.label}
    </span>
  );
}

function ProjectRow({ project, onOpen, onCriticalPath, cpActive }) {
  const m = HEALTH_META[project.health] || HEALTH_META.AT_RISK;
  const pct = project.progress || 0;

  return (
    <div className="portfolio-row" onClick={() => onOpen(project)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => onOpen(project))?.(e); } }}>
      <div className="portfolio-row-color" style={{ background: project.color }} />

      <div className="portfolio-row-name">
        <div className="portfolio-row-title">{project.name}</div>
        {project.subProjects?.length > 0 && (
          <div className="portfolio-row-sub">
            {project.subProjects.length} sub-project{project.subProjects.length > 1 ? "s" : ""}
          </div>
        )}
      </div>

      <div className="portfolio-row-progress">
        <div className="portfolio-progress-bar">
          <div className="portfolio-progress-fill"
            style={{ width:`${pct}%`, background: pct===100?"#10b981":project.color }} />
        </div>
        <span className="portfolio-progress-pct">{pct}%</span>
      </div>

      <div className="portfolio-row-stats">
        <span className="portfolio-stat-chip">✅ {project.doneTasks}/{project.totalTasks}</span>
        {project.overdueTasks > 0 && (
          <span className="portfolio-stat-chip portfolio-stat-danger">⚠ {project.overdueTasks} overdue</span>
        )}
      </div>

      <div className="portfolio-row-health">
        <HealthBadge health={project.health} />
        <div className="portfolio-health-score-bar">
          <div style={{ width:`${project.healthScore}%`, height:"100%",
            background:m.color, borderRadius:"99px" }} />
        </div>
        <span style={{ fontSize:"11px", fontWeight:700, color:m.color, minWidth:"28px" }}>
          {project.healthScore}
        </span>
      </div>

      <span className={`portfolio-status-chip portfolio-status-${project.status?.toLowerCase()}`}>
        {project.status || "ACTIVE"}
      </span>
      <button
        className={`portfolio-cp-btn${cpActive ? " active" : ""}`}
        onClick={e => { e.stopPropagation(); onCriticalPath(project.id); }}
        title="Show critical path">
        🔴
      </button>
    </div>
  );
}

function CriticalPathPanel({ data, loading, onClose }) {
  if (loading) return (
    <div className="cp-panel">
      <div className="cp-header"><span className="cp-title">🔴 Critical Path</span><button className="btn-icon" onClick={onClose}>✕</button></div>
      <div className="analytics-loading"><div className="analytics-spinner"/></div>
    </div>
  );
  if (!data) return null;
  const { criticalPath = [], allTasks = [], totalDuration = 0 } = data;
  return (
    <div className="cp-panel">
      <div className="cp-header">
        <div>
          <span className="cp-title">🔴 Critical Path</span>
          <span className="cp-meta">{criticalPath.length} critical tasks · {totalDuration} days total</span>
        </div>
        <button className="btn-icon" onClick={onClose}>✕</button>
      </div>
      <div className="cp-body">
        {allTasks.map(t => (
          <div key={t.id} className={`cp-task${t.critical ? " cp-task-critical" : ""}`}>
            <div className="cp-task-left">
              {t.critical && <span className="cp-critical-dot" title="Critical"/>}
              <div className="cp-task-info">
                <div className="cp-task-title">{t.title}</div>
                <div className="cp-task-meta">
                  ES:{t.es} → EF:{t.ef} · {t.duration}d
                  {t.float > 0 && <span className="cp-float"> float:{t.float}d</span>}
                </div>
              </div>
            </div>
            <span className={`cp-task-status cp-status-${t.status?.toLowerCase()}`}>{t.status}</span>
          </div>
        ))}
        {allTasks.length === 0 && <div className="empty-state" style={{padding:"20px"}}>No tasks with dependencies found. Add task dependencies to compute critical path.</div>}
      </div>
    </div>
  );
}

function ProjectDetailPanel({ project, onClose }) {
  if (!project) return null;
  const m = HEALTH_META[project.health] || HEALTH_META.AT_RISK;

  const chartData = [
    { name:"Done",      value:project.doneTasks,    fill:"#10b981" },
    { name:"Remaining", value:project.totalTasks - project.doneTasks, fill:"#6366f1" },
    { name:"Overdue",   value:project.overdueTasks, fill:"#ef4444" },
  ];

  return (
    <div className="portfolio-detail-panel">
      <div className="portfolio-detail-header">
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <div style={{ width:"12px", height:"12px", borderRadius:"50%", background:project.color, flexShrink:0 }} />
          <h3 className="portfolio-detail-title">{project.name}</h3>
          <HealthBadge health={project.health} />
        </div>
        <button className="btn-icon" onClick={onClose} style={{ fontSize:"18px" }}>✕</button>
      </div>

      <div className="portfolio-detail-body">
        {/* Stats */}
        <div className="portfolio-detail-stats">
          <div className="portfolio-detail-stat">
            <div className="portfolio-detail-stat-num" style={{ color:"#6366f1" }}>{project.totalTasks}</div>
            <div className="portfolio-detail-stat-label">Total Tasks</div>
          </div>
          <div className="portfolio-detail-stat">
            <div className="portfolio-detail-stat-num" style={{ color:"#10b981" }}>{project.doneTasks}</div>
            <div className="portfolio-detail-stat-label">Completed</div>
          </div>
          <div className="portfolio-detail-stat">
            <div className="portfolio-detail-stat-num" style={{ color:"#ef4444" }}>{project.overdueTasks}</div>
            <div className="portfolio-detail-stat-label">Overdue</div>
          </div>
          <div className="portfolio-detail-stat">
            <div className="portfolio-detail-stat-num" style={{ color:m.color }}>{project.healthScore}</div>
            <div className="portfolio-detail-stat-label">Health Score</div>
          </div>
        </div>

        {/* Progress */}
        <div className="portfolio-detail-section">
          <div className="portfolio-detail-section-label">Progress</div>
          <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
            <div className="portfolio-progress-bar" style={{ flex:1, height:"10px" }}>
              <div className="portfolio-progress-fill"
                style={{ width:`${project.progress}%`, background:project.color, height:"100%" }} />
            </div>
            <span style={{ fontWeight:800, fontSize:"16px", color:project.color }}>{project.progress}%</span>
          </div>
        </div>

        {/* Mini bar chart */}
        <div className="portfolio-detail-section">
          <div className="portfolio-detail-section-label">Task Breakdown</div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={chartData} layout="vertical" margin={{ left:0, right:16 }}>
              <XAxis type="number" tick={{ fontSize:10 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize:11 }} width={70} />
              <Tooltip />
              <Bar dataKey="value" radius={[0,4,4,0]}>
                {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Sub-projects */}
        {project.subProjects?.length > 0 && (
          <div className="portfolio-detail-section">
            <div className="portfolio-detail-section-label">Sub-projects</div>
            <div className="portfolio-subproject-list">
              {project.subProjects.map(sp => (
                <div key={sp} className="portfolio-subproject-chip">📁 {sp}</div>
              ))}
            </div>
          </div>
        )}

        {/* Linked goals */}
        {project.linkedGoals?.length > 0 && (
          <div className="portfolio-detail-section">
            <div className="portfolio-detail-section-label">Linked Goals</div>
            {project.linkedGoals.map(g => (
              <div key={g} className="portfolio-goal-chip">🎯 {g}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


function RiskPlanningPanel({ projects, onClose }) {
  const [risks,   setRisks]   = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [selId,   setSelId]   = React.useState(null);
  const [detail,  setDetail]  = React.useState(null);
  const [analysing, setAnalysing] = React.useState(false);

  React.useEffect(()=>{
    client.get("/risk/portfolio")
      .then(r=>setRisks(unwrapList(r)))
      .catch(()=>{})
      .finally(()=>setLoading(false));
  },[]);

  const runAnalysis = async (projectId) => {
    setAnalysing(true);
    try {
      const r = await client.get(`/risk/project/${projectId}`);
      // Was unwrapList(r) — that helper only ever returns an array, so on
      // this single-object response it silently returned [], and every
      // field read below (detail.projectName, detail.riskScore, ...) was
      // undefined on every "Analyse" click via the dropdown. Clicking a
      // row directly in the list above worked fine, since that path sets
      // detail from an already-correct object — same bug, only one of the
      // two ways to reach this screen was actually broken.
      setDetail(r.data);
      setSelId(projectId);
    } finally { setAnalysing(false); }
  };

  const RISK_COLOR = { LOW:"#10b981", MEDIUM:"#f59e0b", HIGH:"#ef4444", CRITICAL:"#7c3aed" };

  return (
    <div className="cp-overlay" style={{width:560}}>
      <div className="cp-header">
        <div className="cp-title">⚠️ Risk-Adjusted Planning</div>
        <button className="cp-close" onClick={onClose}>✕</button>
      </div>
      <div className="cp-body" style={{maxHeight:"80vh",overflowY:"auto"}}>
        {loading ? <div className="empty-state">Loading portfolio risk analysis…</div> : (
          <>
            {/* Portfolio risk overview */}
            <div style={{marginBottom:"14px"}}>
              {risks.map(r=>(
                <div key={r.projectId} style={{display:"flex",alignItems:"center",gap:"10px",
                  padding:"8px 10px",background:"var(--bg-card)",border:"1px solid var(--border)",
                  borderRadius:"var(--radius-sm)",marginBottom:"6px",cursor:"pointer"}}
                  onClick={()=>setDetail(selId===r.projectId?null:r)||setSelId(selId===r.projectId?null:r.projectId)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (()=>setDetail(selId===r.projectId?null:r)||setSelId(selId===r.projectId?null:r.projectId))?.(e); } }}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:"13px"}}>{r.projectName}</div>
                    {(r.riskFactors||[]).slice(0,2).map((f,i)=>(
                      <div key={i} style={{fontSize:"11px",color:"var(--gray-400)"}}>• {f}</div>
                    ))}
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontWeight:800,fontSize:"18px",color:RISK_COLOR[r.riskLevel]||"#6b7280"}}>
                      {r.riskScore}
                    </div>
                    <div style={{fontSize:"10px",color:RISK_COLOR[r.riskLevel]||"#6b7280",fontWeight:700}}>
                      {r.riskLevel}
                    </div>
                  </div>
                </div>
              ))}
              {risks.length===0 && (
                <div className="empty-state">No risk data yet. Analyse a project below.</div>
              )}
            </div>

            {/* Per-project analysis */}
            <div style={{fontWeight:700,fontSize:"13px",marginBottom:"8px"}}>Analyse specific project</div>
            <div style={{display:"flex",gap:"6px",marginBottom:"14px"}}>
              <select id="risk-proj-sel" style={{flex:1}}>
                <option value="">— pick a project —</option>
                {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="btn-primary" style={{fontSize:"11px"}} disabled={analysing}
                onClick={()=>{
                  const id = document.getElementById("risk-proj-sel")?.value;
                  if (id) runAnalysis(id);
                }}>{analysing?"⏳ Analysing…":"▶ Analyse"}</button>
            </div>

            {detail && (
              <div style={{background:"rgba(99,102,241,.04)",border:"1px solid rgba(99,102,241,.15)",
                borderRadius:"var(--radius-lg)",padding:"14px"}}>
                <div style={{fontWeight:800,fontSize:"14px",marginBottom:"10px"}}>{detail.projectName}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"12px"}}>
                  {[
                    {l:"Risk Score",    v:`${detail.riskScore}/100`,   c:RISK_COLOR[detail.riskLevel]},
                    {l:"Risk Level",    v:detail.riskLevel,             c:RISK_COLOR[detail.riskLevel]},
                    {l:"Velocity",      v:`${detail.avgVelocity} pts/sprint`,c:"var(--gray-700)"},
                    {l:"Velocity Trend",v:`${detail.velocityTrend>0?"+":""}${detail.velocityTrend}%`,
                      c:detail.velocityTrend>=0?"#10b981":"#ef4444"},
                    {l:"Nominal deadline",v:detail.nominalDeadline||"Not set",c:"var(--gray-700)"},
                    {l:"Risk-adjusted deadline",v:detail.riskAdjDeadline,c:"#f59e0b"},
                    {l:"Buffer sprints",v:`+${detail.bufferSprints} sprints`,c:"#f59e0b"},
                    {l:"Remaining pts", v:detail.remainingPoints,       c:"var(--gray-700)"},
                    {l:"P50 (median-case)",v:detail.p50Deadline,       c:"#3b82f6"},
                    {l:"P90 (conservative)",v:detail.p90Deadline,      c:"#ef4444"},
                  ].map(m=>(
                    <div key={m.l} style={{background:"var(--bg-card)",border:"1px solid var(--border)",
                      borderRadius:"var(--radius-sm)",padding:"8px 10px"}}>
                      <div style={{fontSize:"10px",color:"var(--gray-400)",textTransform:"uppercase",letterSpacing:".04em"}}>{m.l}</div>
                      <div style={{fontWeight:800,fontSize:"14px",color:m.c,marginTop:"2px"}}>{m.v}</div>
                    </div>
                  ))}
                </div>
                {(detail.riskFactors||[]).length>0 && (
                  <div style={{marginBottom:"10px"}}>
                    <div style={{fontSize:"11px",fontWeight:700,color:"var(--gray-500)",marginBottom:"5px"}}>RISK FACTORS</div>
                    {detail.riskFactors.map((f,i)=>(
                      <div key={i} style={{fontSize:"12px",color:"var(--gray-600)",padding:"3px 0",
                        borderBottom:"1px solid var(--border)"}}>⚠️ {f}</div>
                    ))}
                  </div>
                )}
                {detail.forecastConfidence && (
                  <div style={{fontSize:"11px",color:"var(--gray-400)",marginBottom:"10px",lineHeight:1.5}}>
                    📊 {detail.forecastConfidence}
                  </div>
                )}
                {detail.aiNarrative && (
                  <div style={{background:"rgba(99,102,241,.06)",borderRadius:"var(--radius-sm)",padding:"10px"}}>
                    <div style={{fontSize:"10px",fontWeight:700,color:"#6366f1",marginBottom:"5px"}}>🤖 AI ASSESSMENT</div>
                    <div style={{fontSize:"12px",color:"var(--gray-600)",lineHeight:1.6}}>{detail.aiNarrative}</div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function Portfolio() {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [showRisk, setShowRisk]   = useState(false);
  const [selected, setSelected]   = useState(null);
  const [sortBy, setSortBy]       = useState("health");
  const [filterHealth, setFilterHealth] = useState("");
  const [criticalData, setCriticalData] = useState(null);
  const [cpLoading,    setCpLoading]    = useState(false);
  const [cpProjectId,  setCpProjectId]  = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Was unwrapList(r) — /analytics/portfolio returns the dashboard
    // summary object directly ({totalProjects, healthyCount, projects,
    // ...}), not a list. Every KPI on this page reads from that object, so
    // this page has likely always shown its "no projects" empty state
    // regardless of how much real data existed — [].projects is
    // undefined, and the empty-state check below treats that as "nothing
    // to show."
    getPortfolio()
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const loadCriticalPath = async (projectId) => {
    if (cpProjectId === projectId) { setCriticalData(null); setCpProjectId(null); return; }
    setCpLoading(true);
    setCpProjectId(projectId);
    try {
      const r = await getCriticalPath(projectId);
      // Was unwrapList(r) — /analytics/critical-path/{id} returns a
      // {criticalPath, totalDuration} object, not a list; this view has
      // likely always rendered empty.
      setCriticalData(r.data);
    } catch { setCriticalData(null); }
    finally { setCpLoading(false); }
  };

  if (loading) return (
    <div>
      <PageHeader icon="📦" title="Portfolio" description="Loading…" />
      <div className="analytics-loading"><div className="analytics-spinner" /><p>Loading portfolio…</p></div>
    </div>
  );

  if (!data || !data.projects?.length) return (
    <div>
      <PageHeader icon="📦" title="Portfolio" description="Cross-project portfolio view" />
      <div className="empty-state">No projects yet. Create projects to see the portfolio view.</div>
    </div>
  );

  const sorted = [...data.projects]
    .filter(p => !filterHealth || p.health === filterHealth)
    .sort((a, b) => {
      if (sortBy === "health")    return a.healthScore - b.healthScore;
      if (sortBy === "progress")  return b.progress - a.progress;
      if (sortBy === "tasks")     return b.totalTasks - a.totalTasks;
      if (sortBy === "overdue")   return b.overdueTasks - a.overdueTasks;
      return a.name.localeCompare(b.name);
    });

  const healthDist = [
    { name:"Healthy",  value:data.healthyCount,  fill:"#10b981" },
    { name:"At Risk",  value:data.atRiskCount,   fill:"#f59e0b" },
    { name:"Critical", value:data.criticalCount, fill:"#ef4444" },
  ].filter(d => d.value > 0);

  return (
    <div>
      <PageHeader
        icon="📦"
        title="Portfolio"
        description="Cross-project health, progress, and resource view"
        action={
          <div style={{display:"flex",gap:"6px"}}>
            <button className="btn-secondary" style={{ fontSize:"12px" }}
              onClick={() => setShowRisk(v=>!v)}>
              ⚠️ Risk Planning
            </button>
            <button className="btn-secondary" style={{ fontSize:"12px" }}
              onClick={() => navigate("/projects")}>
              ← Back to Projects
            </button>
          </div>
        }
      />

      {/* Summary KPIs */}
      <div className="portfolio-kpi-row">
        <div className="portfolio-kpi">
          <div className="portfolio-kpi-num">{data.totalProjects}</div>
          <div className="portfolio-kpi-label">Projects</div>
        </div>
        <div className="portfolio-kpi">
          <div className="portfolio-kpi-num" style={{ color:"#10b981" }}>{data.healthyCount}</div>
          <div className="portfolio-kpi-label">Healthy</div>
        </div>
        <div className="portfolio-kpi">
          <div className="portfolio-kpi-num" style={{ color:"#f59e0b" }}>{data.atRiskCount}</div>
          <div className="portfolio-kpi-label">At Risk</div>
        </div>
        <div className="portfolio-kpi">
          <div className="portfolio-kpi-num" style={{ color:"#ef4444" }}>{data.criticalCount}</div>
          <div className="portfolio-kpi-label">Critical</div>
        </div>
        <div className="portfolio-kpi">
          <div className="portfolio-kpi-num" style={{ color:"#6366f1" }}>{data.avgProgress}%</div>
          <div className="portfolio-kpi-label">Avg Progress</div>
        </div>
        <div className="portfolio-kpi">
          <div className="portfolio-kpi-num">{data.totalTasks}</div>
          <div className="portfolio-kpi-label">Total Tasks</div>
        </div>
      </div>

      <div className="portfolio-layout">
        {/* Left: table */}
        <div className="portfolio-main">
          {/* Toolbar */}
          <div className="portfolio-toolbar">
            <div style={{ display:"flex", gap:"6px" }}>
              {["", "HEALTHY", "AT_RISK", "CRITICAL"].map(h => (
                <button key={h}
                  className={`sprint-filter-btn${filterHealth===h?" active":""}`}
                  onClick={() => setFilterHealth(h)}>
                  {h ? HEALTH_META[h]?.label : "All"}
                </button>
              ))}
            </div>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              style={{ fontSize:"12px", padding:"5px 10px", border:"1px solid var(--border)",
                borderRadius:"var(--radius-sm)", background:"var(--bg-card)", color:"var(--gray-700)" }}>
              <option value="health">Sort by Health</option>
              <option value="progress">Sort by Progress</option>
              <option value="tasks">Sort by Task Count</option>
              <option value="overdue">Sort by Overdue</option>
              <option value="name">Sort by Name</option>
            </select>
          </div>

          {/* Header row */}
          <div className="portfolio-table-header">
            <div style={{ width:"12px" }} />
            <div style={{ flex:2 }}>Project</div>
            <div style={{ flex:2 }}>Progress</div>
            <div style={{ flex:1.5 }}>Tasks</div>
            <div style={{ flex:2 }}>Health Score</div>
            <div style={{ flex:1 }}>Status</div>
          </div>

          {/* Project rows */}
          <div className="portfolio-table-body">
            {sorted.map(p => (
              <ProjectRow key={p.id} project={p}
                onOpen={() => setSelected(s => s?.id === p.id ? null : p)}
                onCriticalPath={loadCriticalPath}
                cpActive={cpProjectId === p.id} />
            ))}
            {sorted.length === 0 && (
              <div className="empty-state" style={{ padding:"24px" }}>
                No projects match the current filter.
              </div>
            )}
          </div>
        </div>

        {/* Right: detail panel + health chart */}
        <div className="portfolio-sidebar">
          {selected ? (
            <ProjectDetailPanel project={selected} onClose={() => setSelected(null)} />
          ) : (
            <div className="portfolio-health-chart-card">
              <div className="portfolio-detail-section-label" style={{ marginBottom:"10px" }}>
                Health Distribution
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <RadialBarChart innerRadius={30} outerRadius={80} data={healthDist}
                  startAngle={180} endAngle={0}>
                  <RadialBar dataKey="value" cornerRadius={4} label={{ position:"insideStart", fill:"#fff", fontSize:11 }}>
                    {healthDist.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </RadialBar>
                  <Tooltip formatter={(v, n) => [v + " projects", n]} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
                {healthDist.map(d => (
                  <div key={d.name} style={{ display:"flex", alignItems:"center", gap:"8px", fontSize:"12px" }}>
                    <div style={{ width:"10px", height:"10px", borderRadius:"50%", background:d.fill }} />
                    <span style={{ flex:1, color:"var(--gray-600)" }}>{d.name}</span>
                    <span style={{ fontWeight:700, color:d.fill }}>{d.value}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:"12px", fontSize:"12px", color:"var(--gray-400)", textAlign:"center" }}>
                Click a project row to see details
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Critical path panel — shown below main content when active */}
      {(criticalData !== null || cpLoading) && (
        <div style={{ marginTop:"16px" }}>
          {showRisk && (
            <RiskPlanningPanel projects={data.projects||[]} onClose={() => setShowRisk(false)} />
          )}
          <CriticalPathPanel
            data={criticalData}
            loading={cpLoading}
            onClose={() => { setCriticalData(null); setCpProjectId(null); }}
          />
        </div>
      )}
    </div>
  );
}