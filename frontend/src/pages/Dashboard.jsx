import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAccess } from "../hooks/useAccess";
import {
  getDashboardSummary,
} from "../api/dashboard";
import { useAuth } from "../hooks/useAuth";
import {
  PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import client from "../api/client";
import {
  Folder, CheckSquare, Target, LayoutGrid, Zap, Timer, BarChart3,
  Calendar, Rocket, Network, LineChart, PieChart as PieChartIcon,
  DollarSign, Map, Package, Building2, Crown, GitBranch, ClipboardList,
  Clock, FileText, Users, Scale, BookOpen, Workflow, Plug, Download,
  MessageSquare, Bot, Brain, Sparkles, Tag, Settings, ShieldCheck,
  Terminal, AlertTriangle, CheckCircle2, Mail, Compass, X,
} from "lucide-react";

import MeetingPulseCard from "../components/MeetingPulseCard";

import "../styles/pages/dashboard.css";
import { statusText, statusClass } from "../utils/statusText";
import { useToast } from "../components/ToastContext";

/* ── icon map — one consistent line-icon language instead of emoji ── */
const ICONS = {
  projects: Folder, tasks: CheckSquare, goals: Target, kanban: LayoutGrid,
  epics: Zap, sprints: Timer, gantt: BarChart3, calendar: Calendar,
  deploy: Rocket, graph: Network, analytics: LineChart, kpis: PieChartIcon,
  roi: DollarSign, roadmap: Map, portfolio: Package, portfolioPlus: Building2,
  executive: Crown, scenarios: GitBranch, reports: ClipboardList, time: Clock,
  docs: FileText, meetings: Users, decisions: Scale, sops: BookOpen,
  bpm: Workflow, automations: Zap, integrations: Plug, import: Download,
  channels: MessageSquare, team: Users, activity: ClipboardList,
  assistant: Bot, intelligence: Brain, aiSettings: Sparkles,
  categories: Tag, customFields: Settings, workspace: Building2,
  admin: ShieldCheck, developer: Terminal,
};
/* ── helpers ──────────────────────────────────────────────────── */
function greeting() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 21) return "Good evening";
  return "Good night";
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-US",{
    weekday:"long", year:"numeric", month:"long", day:"numeric"
  });
}

/* ── Contextual workspace status strip ─────────────────────────
   Replaces the random quote bar with real workspace intelligence.
   Reads from the dashboard summary already loaded in Phase 1.     */
/* ── Status Strip — Tailwind version ─────────────────────────────
   First component migrated to Tailwind as a migration reference.   */
function StatusStrip({ summary }) {
  const [idx, setIdx] = useState(0);

  const alerts = [];
  if (summary) {
    const overdue = summary.overdueCount || 0;
    const active  = summary.activeProjects || 0;
    const done    = summary.doneTasks || 0;
    const total   = summary.totalTasks || 0;
    const goals   = summary.activeGoals || 0;
    const inProg  = summary.inProgressTasks || 0;
    const pct     = total > 0 ? Math.round(done / total * 100) : 0;

    if (overdue > 0) alerts.push({
      Icon: AlertTriangle, text:`${overdue} task${overdue>1?"s are":" is"} overdue`,
      cta:"Review", href:"/tasks?filter=overdue",
      cls:"bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700",
      ctaCls:"text-amber-700 bg-amber-100 hover:bg-amber-200 dark:text-amber-300",
    });
    if (inProg > 0) alerts.push({
      // No CTA here — Kanban/Jira Board are already one click away in
      // WORK HUB just below, so a duplicate link here was pure repetition.
      Icon: Zap, text:`${inProg} task${inProg>1?"s":""} in progress across ${active} project${active!==1?"s":""}`,
      cta:null, href:null,
      cls:"bg-brand-50 border-brand-200 dark:bg-brand-900/20 dark:border-brand-700",
      ctaCls:"text-brand-700 bg-brand-100 hover:bg-brand-200 dark:text-brand-300",
    });
    if (goals > 0 && pct > 0) alerts.push({
      Icon: Target, text:`${goals} active goal${goals>1?"s":""} · ${pct}% of tasks complete`,
      cta:"Goals", href:"/goals",
      cls:"bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-700",
      ctaCls:"text-green-700 bg-green-100 hover:bg-green-200 dark:text-green-300",
    });
    if (alerts.length === 0) alerts.push({
      Icon: CheckCircle2, text:"All projects on track · No overdue items",
      cta:null, href:null,
      cls:"bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-700",
      ctaCls:"",
    });
  } else {
    alerts.push({
      Icon: BarChart3, text:"Loading workspace status…", cta:null, href:null,
      cls:"bg-brand-50 border-brand-200 dark:bg-brand-900/20 dark:border-brand-700",
      ctaCls:"",
    });
  }

  useEffect(() => {
    if (alerts.length < 2) return;
    const t = setInterval(() => setIdx(i => (i + 1) % alerts.length), 6000);
    return () => clearInterval(t);
  }, [alerts.length]);

  const alert = alerts[Math.min(idx, alerts.length - 1)];

  const linkStyle = {
    display:"inline-flex", alignItems:"center", gap:"3px",
    fontSize:"var(--text-xs)", fontWeight:700, padding:"3px 9px",
    borderRadius:"6px", textDecoration:"none", marginLeft:"6px",
    border:"1px solid currentColor", opacity:0.85,
    transition:"opacity 0.15s",
  };

  return (
    <div style={{
      display:"flex", alignItems:"center", gap:"9px",
      padding:"8px 14px", borderRadius:"10px",
      border:"1px solid rgba(99,102,241,0.2)",
      background:"rgba(99,102,241,0.04)",
      position:"relative", overflow:"hidden",
      borderLeft:"3px solid var(--brand-500)", flexShrink:0,
    }}>
      <alert.Icon size={15} style={{ flexShrink:0, color:"#5B5FEE" }} />
      <span style={{ fontWeight:600, fontSize:"var(--text-sm)", color:"#1e293b", whiteSpace:"nowrap" }}>
        {alert.text}
      </span>
      {alert.cta && (
        <a href={alert.href} style={{ ...linkStyle, color:"#5B5FEE", borderColor:"var(--brand-200)", background:"var(--brand-50)" }}
           onMouseEnter={e=>e.currentTarget.style.opacity=1}
           onMouseLeave={e=>e.currentTarget.style.opacity=0.85}>
          {alert.cta} →
        </a>
      )}
      {alerts.length > 1 && (
        <div style={{ display:"flex", gap:"4px", alignItems:"center", marginLeft:"4px", flexShrink:0 }}>
          {alerts.map((_, i) => (
            <button key={i} onClick={() => setIdx(i)} style={{
              width: i===idx ? "16px":"6px", height:"6px",
              borderRadius:"3px", border:"none", cursor:"pointer", padding:0,
              background: i===idx ? "var(--brand-500)" : "var(--gray-400)",
              transition:"all 0.2s",
            }}/>
          ))}
        </div>
      )}
    </div>
  );
}


/* ── Small stat chip ──────────────────────────────────────────── */
function Chip({ Icon, value, label, color, bg, border, onClick }) {
  return (
    <div className="cc3-chip" onClick={onClick}
      style={{ background:bg, borderColor:border, cursor:onClick?"pointer":"default" }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClick)?.(e); } }}>
      <span className="cc3-chip-icon" style={{ color }}><Icon size={12} /></span>
      <span className="cc3-chip-value" style={{ color }}>{value}</span>
      <span className="cc3-chip-label" style={{ color }}>{label}</span>
    </div>
  );
}

/* ── Hub tile ─────────────────────────────────────────────────── */
function HubTile({ Icon, label, sub, subColor, tint, color, to, navigate }) {
  return (
    <div className="cc3-hub-tile" onClick={() => navigate(to)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate(to))?.(e); } }}>
      <span className="cc3-hub-icon-badge" style={{ "--tile-tint": tint, "--tile-color": color }}>
        <Icon size={16} />
      </span>
      <span className="cc3-hub-label">{label}</span>
      {sub && <span className="cc3-hub-sub" style={{ color: subColor||"var(--gray-400)" }}>{sub}</span>}
    </div>
  );
}

/* ── Project card (compact) ───────────────────────────────────── */
function ProjCard({ p, navigate, depth = 0 }) {
  const color = depth === 0 ? (p.color || "#6366f1") : "#8b5cf6";
  const pct   = p.progress || 0;
  return (
    <div
      className="cc3-item-card"
      onClick={() => navigate(`/tasks?projectId=${p.id}`)}
      style={{
        borderLeft: `3px solid ${color}`,
        marginBottom: 4,
        background: depth > 0 ? "rgba(139,92,246,0.03)" : "var(--bg-card)",
      }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate(`/tasks?projectId=${p.id}`))?.(e); } }}
    >
      <div className="cc3-item-card-top">
        {depth > 0 && (
          <span style={{ color:"rgba(139,92,246,0.5)", fontSize:10, flexShrink:0 }}>↳</span>
        )}
        <span className="cc3-item-dot" style={{ background:color, flexShrink:0 }} />
        <span className="cc3-item-name">{p.name}</span>
        <span style={{
          flexShrink:0, fontSize:"9px", fontWeight:700, padding:"1px 7px",
          borderRadius:"99px", background:"rgba(16,185,129,0.12)", color:"#10b981",
          border:"1px solid rgba(16,185,129,0.25)", whiteSpace:"nowrap",
        }}>{p.status || "ACTIVE"}</span>
      </div>
      <div className="cc3-item-bar">
        <div className="cc3-item-fill" style={{ width:`${pct}%`, background:color }} />
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span className="cc3-item-pct" style={{ color }}>{pct}%</span>
        {pct > 0 && <span style={{ fontSize:9, color:"#94a3b8" }}>complete</span>}
      </div>
    </div>
  );
}

function ProjectTree({ projects, navigate }) {
  // Build id set and child map
  const idSet = new Set(projects.map(p => p.id));
  const childMap = {};
  projects.forEach(p => {
    if (p.parentProjectId && idSet.has(p.parentProjectId)) {
      if (!childMap[p.parentProjectId]) childMap[p.parentProjectId] = [];
      childMap[p.parentProjectId].push(p);
    }
  });

  // Roots = no parent, OR parent not in current list
  const roots = projects.filter(p => !p.parentProjectId || !idSet.has(p.parentProjectId));

  function renderProject(p, depth = 0) {
    const kids = childMap[p.id] || [];
    return (
      <div key={p.id}>
        <ProjCard p={p} navigate={navigate} depth={depth} />
        {kids.length > 0 && (
          <div style={{ paddingLeft:16, marginTop:3, borderLeft:"2px solid rgba(99,102,241,0.15)", marginLeft:8 }}>
            {kids.map(child => renderProject(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      {roots.map(p => renderProject(p, 0))}
    </div>
  );
}

/* ── Goal card (compact) ──────────────────────────────────────── */
function GoalCard({ g, navigate }) {
  const pct = g.progress || 0;
  const color = pct >= 70 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#8b5cf6";
  return (
    <div className="cc3-item-card" onClick={() => navigate("/goals")} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate("/goals"))?.(e); } }}>
      <div className="cc3-item-card-top">
        <span className="cc3-item-dot" style={{ background: "#8b5cf6" }} />
        <span className="cc3-item-name">{g.title}</span>
        <span className={`badge badge-${statusClass(g.status)}`} style={{ fontSize:9, padding:"1px 6px" }}>{statusText(g.status)}</span>
      </div>
      <div className="cc3-item-bar">
        <div className="cc3-item-fill" style={{ width:`${pct}%`, background: color }} />
      </div>
      <span className="cc3-item-pct" style={{ color }}>{pct}%</span>
    </div>
  );
}

/* ── Charts panel ─────────────────────────────────────────────── */
function ChartsPanel({ summary, navigate }) {
  const [tab, setTab] = useState("tasks");
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const axisColor = isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.15)";
  const tickColor = isDark ? "rgba(255,255,255,0.5)" : "#94a3b8";

  /* One fixed category → color mapping (base.css --viz-*), used by every
     chart/tab/stat on this page — previously each section (donut, mini
     stats, task tabs, AI panel) picked its own hex for "in progress" or
     "done", so the same category wasn't reliably the same color twice. */
  const vizColor = getComputedStyle(document.documentElement);
  const VIZ = {
    todo:     vizColor.getPropertyValue("--viz-todo").trim()     || "#5B5FEE",
    progress: vizColor.getPropertyValue("--viz-progress").trim() || "#C17D22",
    done:     vizColor.getPropertyValue("--viz-done").trim()     || "#1E8E5A",
    overdue:  vizColor.getPropertyValue("--viz-overdue").trim()  || "#D64545",
    goal:     vizColor.getPropertyValue("--viz-goal").trim()     || "#7C5CBF",
  };

  const taskData = [
    { name:"Todo",        value: summary.todoTasks||0,       color:VIZ.todo },
    { name:"In Progress", value: summary.inProgressTasks||0, color:VIZ.progress },
    { name:"Done",        value: summary.doneTasks||0,        color:VIZ.done },
  ].filter(d => d.value > 0);

  const projData = (summary.projectsWithProgress || summary.activeProjectList || []).map(p => ({
    name: p.name.length>14 ? p.name.slice(0,14)+"…" : p.name,
    progress: p.progress, color: p.color||VIZ.todo, id: p.id,
  }));

  const goalData = (summary.activeGoalList||[]).map(g => ({
    name: g.title.length>14 ? g.title.slice(0,14)+"…" : g.title,
    progress: g.progress||0, id: g.id,
  }));

  const completionRate = summary.totalTasks > 0
    ? Math.round((summary.doneTasks/summary.totalTasks)*100) : 0;

  return (
    <div className="cc3-chart-panel">
      <div className="cc3-chart-tabs">
        {["tasks","projects","goals"].map(k => (
          <button key={k} className={"cc3-chart-tab"+(tab===k?" active":"")}
            onClick={() => setTab(k)}>
            {k.charAt(0).toUpperCase()+k.slice(1)}
          </button>
        ))}
      </div>

      {tab === "tasks" && (
        <>
          <div className="cc3-chart-title">Task status</div>
          {taskData.length > 0 ? (
            <>
              <div className="cc3-donut-wrap">
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart style={{outline:"none"}}>
                    {/* Background track — without this, a single non-zero
                        status (e.g. only "In Progress" populated) renders
                        as one unexplained solid-color ring instead of a
                        clearly partial one. */}
                    <Pie data={[{ value: 1 }]} cx="50%" cy="50%"
                      innerRadius={46} outerRadius={68}
                      dataKey="value" isAnimationActive={false} stroke="none">
                      <Cell fill={isDark ? "rgba(255,255,255,0.06)" : "#f1f5f9"} />
                    </Pie>
                    <Pie data={taskData} cx="50%" cy="50%"
                      innerRadius={46} outerRadius={68}
                      paddingAngle={taskData.length>1?3:0} dataKey="value"
                      isAnimationActive={false} stroke="none"
                      style={{outline:"none"}}>
                      {taskData.map((e,i) => <Cell key={i} fill={e.color} stroke="none" strokeWidth={0} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{ fontSize:11, background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:8 }}
                      formatter={(v,n) => [`${v} tasks`, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="cc3-donut-center">
                  <span className="cc3-donut-total">{summary.totalTasks||0}</span>
                  <span className="cc3-donut-label">total</span>
                </div>
              </div>
              <div className="cc3-stat-grid">
                {[
                  { l:"Todo",       v:summary.todoTasks,              c:VIZ.todo,     p:"/tasks?status=TODO" },
                  { l:"Progress",   v:summary.inProgressTasks,        c:VIZ.progress, p:"/tasks?status=IN_PROGRESS" },
                  { l:"Done",       v:summary.doneTasks,               c:VIZ.done,     p:"/tasks?status=DONE" },
                  { l:"Rate",       v:`${completionRate}%`,            c:VIZ.goal,     p:null },
                  { l:"Overdue",    v:summary.overdueTasks?.length||0, c:VIZ.overdue,  p:"/tasks?filter=overdue" },
                  { l:"Today",      v:summary.todayTasks?.length||0,   c:VIZ.progress, p:"/tasks?filter=today" },
                ].map((s,i) => (
                  <div key={i} className="cc3-mini-stat"
                    style={{ borderLeft:`2px solid ${s.c}`, cursor:s.p?"pointer":"default" }}
                    onClick={() => s.p && navigate(s.p)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => s.p && navigate(s.p))?.(e); } }}>
                    <div className="cc3-mini-val" style={{ color:s.c }}>{s.v}</div>
                    <div className="cc3-mini-lbl">{s.l}{s.p?" ↗":""}</div>
                  </div>
                ))}
              </div>
            </>
          ) : <div className="cc3-chart-empty">No tasks yet</div>}
        </>
      )}

      {tab === "projects" && (
        <>
          <div className="cc3-chart-title">Project progress</div>
          {projData.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(140, projData.length*36)}>
              <BarChart data={projData} layout="vertical" margin={{ left:4, right:28, top:4, bottom:4 }}>
                <XAxis type="number" domain={[0,100]} tickFormatter={v=>`${v}%`}
                  tick={{ fontSize:10, fill:tickColor }} axisLine={{ stroke:axisColor }}
                  tickLine={{ stroke:axisColor }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize:10, fill:tickColor }}
                  axisLine={{ stroke:axisColor }} tickLine={false} width={90} />
                <Tooltip contentStyle={{ fontSize:11, background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:8 }}
                  formatter={v => [`${v}%`,"Progress"]} />
                <Bar dataKey="progress" radius={[0,3,3,0]} cursor="pointer"
                  onClick={e => navigate(`/tasks?projectId=${e.id}`)}>
                  {projData.map((e,i) => <Cell key={i} fill={e.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="cc3-chart-empty">No projects yet</div>}
        </>
      )}

      {tab === "goals" && (
        <>
          <div className="cc3-chart-title">Goal progress</div>
          {goalData.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(140, goalData.length*36)}>
              <BarChart data={goalData} layout="vertical" margin={{ left:4, right:28, top:4, bottom:4 }}>
                <XAxis type="number" domain={[0,100]} tickFormatter={v=>`${v}%`}
                  tick={{ fontSize:10, fill:tickColor }} axisLine={{ stroke:axisColor }}
                  tickLine={{ stroke:axisColor }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize:10, fill:tickColor }}
                  axisLine={{ stroke:axisColor }} tickLine={false} width={90} />
                <Tooltip contentStyle={{ fontSize:11, background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:8 }}
                  formatter={v => [`${v}%`,"Progress"]} />
                <Bar dataKey="progress" fill="#8b5cf6" radius={[0,3,3,0]} cursor="pointer"
                  onClick={() => navigate("/goals")}>
                  {goalData.map((_,i) => <Cell key={i} fill="#8b5cf6" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="cc3-chart-empty">No goals yet</div>}
        </>
      )}
    </div>
  );
}

/* ── Overdue modal ────────────────────────────────────────────── */
function OverdueModal({ summary, onClose, navigate }) {
  const goTo = p => { navigate(p); onClose(); };
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <h2 style={{ color:"#ef4444", fontSize:16, display:"flex", alignItems:"center", gap:8 }}><AlertTriangle size={18} /> Overdue Items</h2>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        {[
          { title:"Tasks",    color:"#ef4444", bg:"#fff5f5", badgeBg:"#fecaca", items:summary.overdueTasks||[],    path:t=>`/tasks?highlight=${t.id}`,    key:"title" },
          { title:"Projects", color:"#f59e0b", bg:"#fff7ed", badgeBg:"#fed7aa", items:summary.overdueProjects||[], path:p=>`/projects?highlight=${p.id}`, key:"name"  },
          { title:"Goals",    color:"#8b5cf6", bg:"#faf5ff", badgeBg:"#e9d5ff", items:summary.overdueGoals||[],    path:g=>`/goals?highlight=${g.id}`,    key:"title" },
        ].map(s => (
          <div key={s.title} className="overdue-section">
            <div className="overdue-section-header" style={{ background:s.bg, color:s.color }}>
              {s.title}
              <span className="task-status-badge" style={{ background:s.badgeBg, color:s.color }}>{s.items.length}</span>
            </div>
            {s.items.length > 0
              ? <div className="overdue-section-body">
                  {s.items.map(item => (
                    <div key={item.id} className="overdue-item overdue-item-clickable" onClick={() => goTo(s.path(item))} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => goTo(s.path(item)))?.(e); } }}>
                      <div className="task-status-dot" style={{ background:s.color }} />
                      <div className="task-info"><div className="task-title">{item[s.key]}</div></div>
                      <span className="overdue-arrow">→</span>
                    </div>
                  ))}
                </div>
              : <p className="overdue-empty">None</p>}
          </div>
        ))}
        <div className="form-actions">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   DASHBOARD — Concept 3 v2
   ════════════════════════════════════════════════════════════════ */

// ── Dashboard Task Row ─────────────────────────────────────────────────────
function TaskRow({ task, navigate }) {
  const statusColor = {
    "TODO": "#6366f1", "IN_PROGRESS": "#f59e0b", "DONE": "#10b981"
  }[task.status] || "#94a3b8";

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "DONE";
  const isToday   = task.dueDate && (() => {
    const d = new Date(task.dueDate); const now = new Date();
    return d.toDateString() === now.toDateString();
  })();

  return (
    <div
      onClick={() => navigate("/tasks?highlight=" + task.id)}
      style={{
        display: "flex", alignItems: "center", gap: "10px",
        padding: "8px 12px", borderRadius: "8px", cursor: "pointer",
        background: "#f8fafc", marginBottom: "4px",
        borderLeft: "3px solid " + statusColor,
        transition: "background 0.15s",
      }}
      onMouseEnter={e => e.currentTarget.style.background = "#f1f5f9"}
      onMouseLeave={e => e.currentTarget.style.background = "#f8fafc"} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate("/tasks?highlight=" + task.id))?.(e); } }}
    >
      <span style={{ fontSize: "var(--text-sm)", flex: 1, color: "#0f172a",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {task.title}
      </span>
      {task.dueDate && (
        <span style={{
          fontSize: "var(--text-xs)", fontWeight: 600, flexShrink: 0,
          display: "flex", alignItems: "center", gap: 4,
          color: isOverdue ? "#ef4444" : isToday ? "#d97706" : "#94a3b8",
        }}>
          {isOverdue ? <AlertTriangle size={11} /> : isToday ? <Calendar size={11} /> : null}
          {new Date(task.dueDate).toLocaleDateString("en-GB", { day:"2-digit", month:"short" })}
        </span>
      )}
      <span style={{
        fontSize: "10px", padding: "2px 7px", borderRadius: "999px",
        fontWeight: 700, flexShrink: 0,
        background: statusColor + "22", color: statusColor,
      }}>
        {statusText(task.status)}
      </span>
    </div>
  );
}

export default function Dashboard() {
  const { user, activeWorkspace } = useAuth();
  const { show: showToast } = useToast();
  const navigate  = useNavigate();
  const { can }   = useAccess();
  const [summary,     setSummary]     = useState(null);
  const [dashTasks,   setDashTasks]   = useState({ active: [], overdue: [], today: [] });
  const [dashTaskTab, setDashTaskTab] = useState("active");
  const [loading,     setLoading]     = useState(true);   // only Phase 1
  const [showOverdue, setShowOverdue] = useState(false);

  useEffect(() => {
    // Reset state so stale data from previous workspace doesn't show
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets on workspace switch, then loads fresh data below
    setSummary(null);
    setLoading(true);

    // ── Phase 1: critical KPIs — show shell immediately ─────
    // (also carries projects/goals/activity data used throughout this
    // page — a separate Phase 2/3 fetch for those was firing here too,
    // but everything below reads from `summary`, so those extra calls
    // just discarded their results unused on every load/workspace switch.)
    getDashboardSummary()
      .then(r => { setSummary(r.data); setLoading(false); })
      .catch(() => setLoading(false));

    // ── Phase 2: dashboard tasks panel ─────────────────────
    import("../api/tasks").then(m => m.getTasks({ limit: 100 })).then(tr => {
      const all = Array.isArray(tr.data) ? tr.data
                : Array.isArray(tr.data?.data) ? tr.data.data : [];
      const now = new Date(); now.setHours(0,0,0,0);
      const eod = new Date(); eod.setHours(23,59,59,999);
      setDashTasks({
        active:  all.filter(t => t.status === "IN_PROGRESS"),
        overdue: all.filter(t => t.dueDate && new Date(t.dueDate) < now && t.status !== "DONE"),
        today:   all.filter(t => {
          if (!t.dueDate) return false;
          const d = new Date(t.dueDate);
          return d >= now && d <= eod && t.status !== "DONE";
        }),
      });
    }).catch(() => {});
  }, [activeWorkspace?.id]);

  const handleSendReminder = async () => {
    try   { await client.post("/reminders/send-now"); showToast("Reminder sent!", "success"); }
    catch { showToast("Failed to send reminder. Check email configuration.", "error"); }
  };

  if (loading) return (
    <div className="cc3-loading">
      <div className="cc3-loading-spinner" />
      <span>Loading your command center…</span>
    </div>
  );
  if (!summary) return (
    <div className="cc3-error-card">
      <div className="cc3-error-icon"><AlertTriangle size={28} /></div>
      <div className="cc3-error-title">Cannot connect to backend</div>
      <div className="cc3-error-sub">Make sure Spring Boot is running on port 9090.</div>
    </div>
  );

  /* computed */
  const completionRate = summary.totalTasks > 0
    ? Math.round((summary.doneTasks/summary.totalTasks)*100) : 0;
  const totalOverdue = (summary.overdueTasks?.length||0)
    + (summary.overdueProjects?.length||0)
    + (summary.overdueGoals?.length||0);
  const goalHealth = summary.totalGoals > 0
    ? Math.round(((summary.achievedGoals||0)/summary.totalGoals)*100) : 0;
  const userName = user?.name?.split(" ")[0] || "there";
  const todayStr = fmtDate(new Date());

  /* hub definitions */
  const workTiles = [
    { Icon:ICONS.projects, tint:"rgba(99,102,241,.1)",  color:"#6366f1", label:"Projects",  sub:`${summary.totalProjects||0} active`,  to:"/projects" },
    { Icon:ICONS.tasks,    tint:totalOverdue>0?"rgba(239,68,68,.12)":"rgba(16,185,129,.1)", color:totalOverdue>0?"#ef4444":"#10b981", label:"Tasks", sub:totalOverdue>0?`${totalOverdue} overdue`:`${summary.totalTasks||0} total`, subColor:totalOverdue>0?"#ef4444":undefined, to:"/tasks" },
    { Icon:ICONS.goals,    tint:"rgba(139,92,246,.1)",  color:"#8b5cf6", label:"Goals",     sub:`${goalHealth}% health`,               to:"/goals" },
    { Icon:ICONS.kanban,   tint:"rgba(14,165,233,.1)",  color:"#0ea5e9", label:"Kanban",    sub:`${summary.inProgressTasks||0} active`, to:"/kanban" },
    { Icon:ICONS.epics,    tint:"rgba(245,158,11,.1)",  color:"#f59e0b", label:"Epics",     sub:"View all",                             to:"/epics" },
    { Icon:ICONS.sprints,  tint:"rgba(236,72,153,.1)",  color:"#ec4899", label:"Sprints",   sub:"Current sprint",                       to:"/sprints" },
    { Icon:ICONS.gantt,    tint:"rgba(99,102,241,.1)",  color:"#6366f1", label:"Gantt",     sub:"Timeline",                             to:"/gantt" },
    { Icon:ICONS.calendar, tint:"rgba(13,148,136,.1)",  color:"#0d9488", label:"Calendar",  sub:`${summary.todayTasks?.length||0} today`, to:"/calendar" },
    { Icon:ICONS.deploy,   tint:"rgba(217,70,239,.1)",  color:"#d946ef", label:"Deploy",    sub:"DORA",                                 to:"/deployments" },
    { Icon:ICONS.graph,    tint:"rgba(100,116,139,.1)", color:"#64748b", label:"Graph",     sub:"Knowledge",                            to:"/knowledge-graph" },
  ];
  const insightsTiles = [
    { Icon:ICONS.analytics,     tint:"rgba(99,102,241,.1)",  color:"#6366f1", label:"Analytics",  sub:"Real-time",     to:"/analytics" },
    { Icon:ICONS.kpis,          tint:"rgba(14,165,233,.1)",  color:"#0ea5e9", label:"KPIs",       sub:"Metric health", to:"/kpis" },
    { Icon:ICONS.roi,           tint:"rgba(13,148,136,.1)",  color:"#0d9488", label:"ROI Engine", sub:"Financials",    to:"/roi" },
    { Icon:ICONS.roadmap,       tint:"rgba(139,92,246,.1)",  color:"#8b5cf6", label:"Roadmap",    sub:"RAID log",      to:"/roadmap" },
    { Icon:ICONS.portfolio,     tint:"rgba(245,158,11,.1)",  color:"#f59e0b", label:"Portfolio",  sub:"Initiatives",   to:"/portfolio" },
    { Icon:ICONS.portfolioPlus, tint:"rgba(217,70,239,.1)",  color:"#d946ef", label:"Portfolio+", sub:"Advanced",      to:"/portfolio-plus" },
    { Icon:ICONS.executive,     tint:"rgba(234,179,8,.12)",  color:"#ca8a04", label:"Executive",  sub:"C-suite",       to:"/executive" },
    { Icon:ICONS.scenarios,     tint:"rgba(236,72,153,.1)",  color:"#ec4899", label:"Scenarios",  sub:"What-if",       to:"/scenarios" },
    { Icon:ICONS.reports,       tint:"rgba(100,116,139,.1)", color:"#64748b", label:"Reports",    sub:"Export",        to:"/reports" },
    { Icon:ICONS.time,          tint:"rgba(16,185,129,.1)",  color:"#10b981", label:"Time",       sub:"Billing",       to:"/time-tracking" },
  ];
  const knowledgeTiles = [
    { Icon:ICONS.docs,      tint:"rgba(99,102,241,.1)", color:"#6366f1", label:"Docs",      sub:"Documents", to:"/docs" },
    { Icon:ICONS.meetings,  tint:"rgba(14,165,233,.1)", color:"#0ea5e9", label:"Meetings",  sub:"Schedule",  to:"/meetings" },
    { Icon:ICONS.decisions, tint:"rgba(139,92,246,.1)", color:"#8b5cf6", label:"Decisions", sub:"Log",       to:"/decisions" },
    { Icon:ICONS.sops,      tint:"rgba(16,185,129,.1)", color:"#10b981", label:"SOPs",      sub:"Procedures",to:"/sops" },
  ];
  const automateTiles = [
    { Icon:ICONS.bpm,          tint:"rgba(99,102,241,.1)", color:"#6366f1", label:"BPM Studio",  sub:"Design",    to:"/bpm" },
    { Icon:ICONS.automations,  tint:"rgba(245,158,11,.1)", color:"#f59e0b", label:"Automations", sub:"Rules",     to:"/automations" },
    { Icon:ICONS.integrations, tint:"rgba(14,165,233,.1)", color:"#0ea5e9", label:"Integrations",sub:"Connect",   to:"/integrations" },
    { Icon:ICONS.import,       tint:"rgba(16,185,129,.1)", color:"#10b981", label:"Import",      sub:"Bulk data", to:"/import" },
  ];
  const teamTiles = [
    { Icon:ICONS.channels, label:"Channels", sub:"Chat",    to:"/channels" },
    { Icon:ICONS.team,     label:"Team",     sub:"Members", to:"/team" },
    { Icon:ICONS.activity, label:"Activity", sub:"Audit",   to:"/activity" },
  ];
  const aiTiles = [
    { Icon:ICONS.assistant,    label:"Assistant",    sub:"Chat",     to:"/ai" },
    { Icon:ICONS.intelligence, label:"Intelligence", sub:"Insights", to:"/ai-intelligence" },
    { Icon:ICONS.aiSettings,   label:"AI Settings",  sub:"Config",   to:"/ai-settings" },
  ];
  const configureTiles = [
    { Icon:ICONS.categories,   label:"Categories",    sub:"Organise",  to:"/categories" },
    { Icon:ICONS.customFields, label:"Custom Fields", sub:"Schemas",   to:"/custom-fields" },
    { Icon:ICONS.workspace,    label:"Workspace",     sub:"Settings",  to:"/workspace-settings" },
    { Icon:ICONS.admin,        label:"Admin",         sub:"Users",     to:"/admin" },
    { Icon:ICONS.developer,    label:"Developer",     sub:"API",       to:"/developer" },
  ];

  return (
    <div className="db-root">

      {/* STATUS BAR */}
      <StatusStrip summary={summary} />

      {/* HERO */}
      <div className="db-hero">
        <div className="db-hero-bar" />
        <div className="db-hero-body">
          <div className="db-hero-left">
            <div className="db-hero-greeting">{greeting()}, {userName} 👋</div>
            <div className="db-hero-date">Your command center · {todayStr}</div>
            <div className="db-chips-row">
              {totalOverdue > 0 && <Chip Icon={AlertTriangle} value={totalOverdue} label="overdue" color="#ef4444" bg="rgba(239,68,68,0.08)" border="rgba(239,68,68,0.25)" onClick={() => setShowOverdue(true)} />}
              <Chip Icon={CheckSquare} value={summary.inProgressTasks||0} label="in progress" color="#6366f1" bg="rgba(99,102,241,0.08)" border="rgba(99,102,241,0.2)" onClick={() => navigate("/tasks?status=IN_PROGRESS")} />
              <Chip Icon={Target} value={`${goalHealth}%`} label="goal health" color={goalHealth>=70?"#10b981":"#f59e0b"} bg={goalHealth>=70?"rgba(16,185,129,0.08)":"rgba(245,158,11,0.08)"} border={goalHealth>=70?"rgba(16,185,129,0.25)":"rgba(245,158,11,0.25)"} onClick={() => navigate("/goals")} />
              <Chip Icon={LineChart} value={`${completionRate}%`} label="completion" color="#8b5cf6" bg="rgba(139,92,246,0.08)" border="rgba(139,92,246,0.2)" onClick={() => navigate("/analytics")} />
              <Chip Icon={ShieldCheck} value={summary.raidRisks||0} label="RAID risks" color="#dc2626" bg="rgba(220,38,38,0.07)" border="rgba(220,38,38,0.2)" onClick={() => navigate("/roadmap")} />
              <Chip Icon={DollarSign} value={summary.roiForecast||"–"} label="ROI forecast" color="#0d9488" bg="rgba(13,148,136,0.07)" border="rgba(13,148,136,0.2)" onClick={() => navigate("/roi")} />
              <Chip Icon={Users} value={summary.onlineCount||0} label="online" color="#10b981" bg="rgba(16,185,129,0.07)" border="rgba(16,185,129,0.2)" onClick={() => navigate("/team")} />
            </div>
          </div>
          <div className="db-hero-actions">
            <div className="db-live-pill"><span className="db-live-dot" /><span>Live</span></div>
            <button className="db-btn db-btn-primary" onClick={() => navigate("/projects?new=true")}>+ New Project</button>
            <button className="db-btn db-btn-green" onClick={() => navigate("/goals?new=true")}>+ New Goal</button>
            <button className="db-btn db-btn-secondary" onClick={handleSendReminder}><Mail size={13} /> Reminder</button>
            <button className="db-btn db-btn-indigo" onClick={() => navigate("/workflow-guide")}><Compass size={13} /> Guide</button>
          </div>
        </div>
      </div>

      {/* WORK HUB */}
      <div className="db-card">
        <div className="db-card-header">
          <span className="db-card-title"><Zap size={13} /> WORK HUB</span>
          <button className="db-link" onClick={() => navigate("/projects")}>All projects →</button>
        </div>
        <div className="db-hub-grid">
          {workTiles.map(t => <HubTile key={t.to} {...t} navigate={navigate} />)}
        </div>
      </div>

      {/* MEETING ASSISTANT — a visible way in for people who do not know it exists */}
      {can("USE_MEETING_ASSISTANT") && (
        <div className="db-card">
          <div className="db-card-header">
            <span className="db-card-title">🤖 MEETING ASSISTANT</span>
            <button className="db-link" onClick={() => navigate("/meeting-assistant")}>Open →</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "var(--gray-500)" }}>
              Turn a meeting into a summary, minutes and tasks — paste a transcript, upload a recording, or send a notetaker.
            </span>
            <button className="btn-primary" onClick={() => navigate("/meeting-assistant")}>Start with a meeting</button>
          </div>
        </div>
      )}

      {/* DAILY MEETING PULSE — self-contained, non-blocking, renders nothing until its own fetch resolves */}
      <MeetingPulseCard />

      {/* ACTIVE PROJECTS + GOALS + TASKS (left) | CHARTS + AI (right) */}
      <div className="db-pg-row">

        {/* LEFT: projects, goals, tasks stacked */}
        <div style={{ display:"flex", flexDirection:"column", gap:"8px", minWidth:0, height:"100%" }}>

          {/* Projects + Goals side by side */}
          <div className="db-two-col-row" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px", flex:1 }}>
            <div className="db-card">
              <div className="db-card-header">
                <span className="db-card-title"><Folder size={13} /> ACTIVE PROJECTS</span>
                <button className="db-link" onClick={() => navigate("/projects")}>View all →</button>
              </div>
              {(() => {
                const projs = summary.projectsWithProgress?.length > 0 ? summary.projectsWithProgress : summary.activeProjectList?.length > 0 ? summary.activeProjectList : null;
                return projs ? <ProjectTree projects={projs.slice(0,6)} navigate={navigate} /> : <div className="db-empty">No projects — <button className="db-link" onClick={() => navigate("/projects?new=true")}>create one</button></div>;
              })()}
            </div>
            <div className="db-card">
              <div className="db-card-header">
                <span className="db-card-title"><Target size={13} /> ACTIVE GOALS</span>
                <button className="db-link" onClick={() => navigate("/goals")}>View all →</button>
              </div>
              {summary.activeGoalList?.length > 0
                ? <div className="db-item-list">{summary.activeGoalList.slice(0,5).map(g => <GoalCard key={g.id} g={g} navigate={navigate} />)}</div>
                : <div className="db-empty">No goals — <button className="db-link" onClick={() => navigate("/goals?new=true")}>set one</button></div>}
            </div>
          </div>

          {/* Tasks below projects+goals */}
          <div className="db-card" style={{ flex:1, display:"flex", flexDirection:"column" }}>
            <div className="db-card-header">
              <span className="db-card-title"><ClipboardList size={13} /> TASKS</span>
              <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                <div style={{ display:"flex", gap:"4px" }}>
                  {[{key:"active",label:"Active",color:"var(--viz-progress)",count:dashTasks.active.length},{key:"overdue",label:"Overdue",color:"var(--viz-overdue)",count:dashTasks.overdue.length},{key:"today",label:"Today",color:"var(--viz-progress)",count:dashTasks.today.length}].map(tab=>(
                    <button key={tab.key} onClick={() => setDashTaskTab(tab.key)} style={{ padding:"2px 9px", borderRadius:"999px", border:"none", cursor:"pointer", fontSize:"11px", fontWeight:700, background:dashTaskTab===tab.key?tab.color:"#f1f5f9", color:dashTaskTab===tab.key?"#fff":"#64748b", display:"flex", alignItems:"center", gap:"3px" }}>
                      {tab.label}<span style={{ background:dashTaskTab===tab.key?"rgba(255,255,255,0.3)":tab.color+"22", color:dashTaskTab===tab.key?"#fff":tab.color, borderRadius:"999px", padding:"0 5px", fontSize:"10px", fontWeight:800 }}>{tab.count}</span>
                    </button>
                  ))}
                </div>
                <button className="db-link" onClick={() => navigate("/tasks")}>View all →</button>
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:"5px", flex:1, overflowY:"auto" }}>
              {(dashTaskTab==="active"?dashTasks.active:dashTaskTab==="overdue"?dashTasks.overdue:dashTasks.today).length===0
                ? <div className="db-empty">{dashTaskTab==="overdue"?"🎉 No overdue!":"No tasks here"}</div>
                : (dashTaskTab==="active"?dashTasks.active:dashTaskTab==="overdue"?dashTasks.overdue:dashTasks.today).slice(0,8).map(t=><TaskRow key={t.id} task={t} navigate={navigate} />)
              }
            </div>
          </div>

        </div>

        {/* RIGHT: Charts + AI Insight */}
        <div className="db-charts-col">
          <ChartsPanel summary={summary} navigate={navigate} />
          <div className="db-ai-card" style={{ marginTop:"8px" }}>
            <div className="db-ai-card-top"><span className="db-ai-badge"><Sparkles size={11} style={{marginRight:4, verticalAlign:"-2px"}} />AI Insight</span></div>
            <div className="db-ai-text">
              {summary.inProgressTasks||0} tasks across {summary.activeProjects||summary.totalProjects||0} projects.
              {totalOverdue > 0 && <span className="db-ai-warn"> ⚠️ {totalOverdue} overdue.</span>}
              {completionRate >= 70 && <span className="db-ai-good"> 🎉 On track!</span>}
            </div>
            <div className="db-ai-stats">
              {[{l:"Todo",v:summary.todoTasks||0,c:"var(--viz-todo)"},{l:"Progress",v:summary.inProgressTasks||0,c:"var(--viz-progress)"},{l:"Done",v:summary.doneTasks||0,c:"var(--viz-done)"}].map(s=>(
                <div key={s.l} className="db-ai-stat" onClick={() => navigate("/tasks")} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate("/tasks"))?.(e); } }}>
                  <div className="db-ai-stat-val" style={{color:s.c}}>{s.v}</div>
                  <div className="db-ai-stat-lbl">{s.l}</div>
                </div>
              ))}
            </div>
            <button className="db-ai-btn" onClick={() => navigate("/ai")}>Open AI →</button>
          </div>
        </div>
      </div>

      {/* INSIGHTS + KNOWLEDGE + AUTOMATE | AI INSIGHT */}
      <div className="db-insights-row">
        <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
          <div className="db-card">
            <div className="db-card-header">
              <span className="db-card-title"><LineChart size={13} /> INSIGHTS HUB</span>
              <button className="db-link" onClick={() => navigate("/analytics")}>Analytics →</button>
            </div>
            <div className="db-hub-grid db-hub-grid-5">
              {insightsTiles.map(t => <HubTile key={t.to} {...t} navigate={navigate} />)}
            </div>
          </div>
          <div className="db-two-col-row" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px", flex:1 }}>
            <div className="db-card" style={{ display:"flex", flexDirection:"column" }}>
              <div className="db-card-header"><span className="db-card-title"><BookOpen size={13} /> KNOWLEDGE</span><button className="db-link" onClick={() => navigate("/docs")}>Docs →</button></div>
              <div className="db-hub-grid db-hub-grid-2">{knowledgeTiles.map(t=><HubTile key={t.to} {...t} navigate={navigate} />)}</div>
            </div>
            <div className="db-card" style={{ display:"flex", flexDirection:"column" }}>
              <div className="db-card-header"><span className="db-card-title"><Workflow size={13} /> AUTOMATE</span><button className="db-link" onClick={() => navigate("/bpm")}>BPM →</button></div>
              <div className="db-hub-grid db-hub-grid-2">{automateTiles.map(t=><HubTile key={t.to} {...t} navigate={navigate} />)}</div>
            </div>
          </div>
        </div>
        <div className="db-ai-card" style={{ justifyContent:"space-between" }}>
          <div>
          <div className="db-ai-card-top"><span className="db-ai-badge"><Bot size={11} style={{marginRight:4, verticalAlign:"-2px"}} />AI Hub</span></div>
          <div className="db-ai-text" style={{ marginBottom:"8px" }}>Your AI command centre. Run intelligence, get insights, automate decisions.</div>
          <div className="db-compact-list" style={{ marginBottom:"10px" }}>
            {aiTiles.map(t=>(
              <div key={t.to} className="db-compact-item" onClick={() => navigate(t.to)} style={{ color:"rgba(255,255,255,0.8)" }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate(t.to))?.(e); } }}>
                <span className="db-compact-icon" style={{ color:"rgba(255,255,255,0.85)" }}><t.Icon size={15} /></span>
                <span style={{ fontSize:"var(--text-sm)", fontWeight:600, color:"rgba(255,255,255,0.85)", flex:1 }}>{t.label}</span>
                <span style={{ fontSize:"var(--text-2xs)", color:"rgba(255,255,255,0.4)" }}>{t.sub}</span>
              </div>
            ))}
          </div>
          </div>
          <button className="db-ai-btn" onClick={() => navigate("/ai")}>Open AI Assistant →</button>
        </div>
      </div>

      {/* TEAM + AI HUB + CONFIGURE */}
      <div className="db-bottom-row">
        <div className="db-card">
          <div className="db-card-header"><span className="db-card-title"><Users size={13} /> TEAM</span></div>
          <div className="db-compact-list">
            {teamTiles.map(t=><div key={t.to} className="db-compact-item" onClick={() => navigate(t.to)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate(t.to))?.(e); } }}><span className="db-compact-icon"><t.Icon size={15} /></span><span className="db-compact-name">{t.label}</span><span className="db-compact-sub">{t.sub}</span></div>)}
          </div>
          <div className="db-online-row"><span className="db-live-dot" /><span style={{fontSize:"var(--text-xs)",color:"#1E8E5A",fontWeight:600}}>Team active</span><button className="db-link" style={{marginLeft:"auto"}} onClick={() => navigate("/team")}>See all →</button></div>
        </div>
        <div className="db-card">
          <div className="db-card-header"><span className="db-card-title"><Settings size={13} /> CONFIGURE</span></div>
          <div className="db-compact-list">
            {configureTiles.map(t=><div key={t.to} className="db-compact-item" onClick={() => navigate(t.to)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate(t.to))?.(e); } }}><span className="db-compact-icon"><t.Icon size={15} /></span><span className="db-compact-name">{t.label}</span><span className="db-compact-sub">{t.sub}</span></div>)}
          </div>
        </div>
        <div className="db-card">
          <div className="db-card-header"><span className="db-card-title"><Zap size={13} /> QUICK ACTIONS</span></div>
          <div className="db-compact-list">
            {[
              { Icon:ICONS.tasks,     label:"New Task", sub:"Add task", to:"/tasks?new=true" },
              { Icon:ICONS.projects,  label:"New Project", sub:"Start project", to:"/projects?new=true" },
              { Icon:ICONS.goals,     label:"New Goal", sub:"Set goal", to:"/goals?new=true" },
              { Icon:ICONS.calendar,  label:"Schedule Meeting", sub:"Book time", to:"/meetings" },
              { Icon:ICONS.reports,   label:"View Reports", sub:"Analytics", to:"/reports" },
            ].map(t=><div key={t.to} className="db-compact-item" onClick={() => navigate(t.to)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate(t.to))?.(e); } }}><span className="db-compact-icon"><t.Icon size={15} /></span><span className="db-compact-name">{t.label}</span><span className="db-compact-sub">{t.sub}</span></div>)}
          </div>
        </div>
      </div>

      {showOverdue && <OverdueModal summary={summary} onClose={() => setShowOverdue(false)} navigate={navigate} />}
    </div>
  );
}
