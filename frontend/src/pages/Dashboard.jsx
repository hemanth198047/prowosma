import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  getDashboardSummary,
} from "../api/dashboard";
import { useAuth } from "../hooks/useAuth";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from "recharts";
import client from "../api/client";
import {
  Folder, CheckSquare, Target, LayoutGrid, Zap, Timer, BarChart3,
  Calendar, Rocket, Network, LineChart, PieChart as PieChartIcon,
  DollarSign, Map, Package, Building2, Crown, GitBranch, ClipboardList,
  Clock, FileText, Users, Scale, BookOpen, Workflow, Plug, Download,
  MessageSquare, Bot, Brain, Sparkles, Tag, Settings, ShieldCheck,
  Terminal, AlertTriangle, CheckCircle2, Mail, Compass, X,
  Maximize2, Plus, FolderPlus, CalendarPlus, ArrowRight,
} from "lucide-react";

import MeetingPulseCard from "../components/MeetingPulseCard";

import "../styles/pages/dashboard.css";
import "../styles/pages/dashboard-v3.css";
import { statusText } from "../utils/statusText";
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
function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-US",{
    weekday:"long", year:"numeric", month:"long", day:"numeric"
  });
}

/* ── Small stat: one neutral style; only a problem (overdue, risks) is shown in red ── */
function Chip({ Icon, value, label, alert, onClick }) {
  return (
    <button type="button" className={"dz-chip" + (alert ? " dz-chip--alert" : "")} onClick={onClick}>
      {alert && <Icon size={14} strokeWidth={1.5} aria-hidden="true" />}
      <span className="dz-chip-v">{value}</span>
      <span className="dz-chip-l">{label}</span>
    </button>
  );
}

/* ── Overdue modal ────────────────────────────────────────────── */
function OverdueModal({ summary, onClose, navigate }) {
  const goTo = p => { navigate(p); onClose(); };
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <h2 style={{ color:"#ef4444", fontSize:16, display:"flex", alignItems:"center", gap:8 }}><AlertTriangle size={18} /> Overdue items</h2>
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

/* ════════════════════════════════════════════════════════════════
   New pieces: compact overview cards with a detail panel, icon rails
   for the hubs, a minimal charts panel and a minimal AI hub.
   ════════════════════════════════════════════════════════════════ */

const pct = (v) => Math.max(0, Math.min(100, Math.round(v || 0)));
const shortDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null);

/** A small tooltip that sits above (or below) its target, outside any scrolling row so it is never cut off. */
function Tip({ text, children }) {
  const [box, setBox] = useState(null);
  const show = (e) => { const r = e.currentTarget.getBoundingClientRect(); setBox({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom }); };
  const hide = () => setBox(null);
  const below = box && box.top < 48;
  return (
    <span className="dz-tip-host" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {box && createPortal(
        <span role="tooltip" className={"dz-tip" + (below ? " dz-tip--below" : "")}
          style={{ left: box.x, top: below ? box.bottom + 8 : box.top - 8 }}>{text}</span>,
        document.body)}
    </span>
  );
}

/** A row of icon shortcuts, each with a tooltip naming it (one line; wraps on phones). */
function IconRail({ label, tiles, navigate }) {
  return (
    <div className="dz-rail">
      <span className="dz-rail-label">{label}</span>
      <div className="dz-rail-icons" role="group" aria-label={label}>
        {tiles.map((t) => (
          <Tip key={t.to + t.label} text={t.sub ? `${t.label} · ${t.sub}` : t.label}>
            <button type="button" className={"dz-icon" + (t.badge ? " dz-icon--alert" : "")} onClick={() => navigate(t.to)}
              aria-label={t.sub ? `${t.label} - ${t.sub}` : t.label}>
              <t.Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              {t.badge ? <span className="dz-icon-badge">{t.badge}</span> : null}
            </button>
          </Tip>
        ))}
      </div>
    </div>
  );
}

/** Thin progress bar. */
function Bar({ value, color }) {
  return <span className="dz-bar" aria-hidden="true"><span style={{ width: `${pct(value)}%`, background: color || "var(--brand-500)" }} /></span>;
}

/** Projects, goals and tasks in one card, one tab each: a few one-line items, and "Show all" for the full details. */
function WorkOverview({ projects, goals, dashTasks, navigate, onExpand }) {
  const [tab, setTab] = useState("projects");
  const firstTaskTab = dashTasks.overdue.length ? "overdue" : dashTasks.active.length ? "active" : "today";
  const [taskTab, setTaskTab] = useState(null);
  const tt = taskTab || firstTaskTab;
  const openTasks = dashTasks.active.length + dashTasks.overdue.length + dashTasks.today.length;
  const TABS = [["projects", "Projects", projects.length], ["goals", "Goals", goals.length], ["tasks", "Tasks", openTasks]];
  // As many rows as fit in the space the card has (the dashboard doesn't scroll); the rest are behind "Show all".
  const panelRef = useRef(null);
  const [fit, setFit] = useState(6);
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => {
      const h = el.clientHeight;
      if (!h) return;
      const reserved = 34 + (tab === "tasks" ? 38 : 0);          // the "Show all" line, and the task filter
      setFit(Math.max(2, Math.floor((h - reserved) / 40)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab]);
  const LIMIT = fit;
  const more = (n, what) => n > LIMIT && <li><button type="button" className="dz-more" onClick={() => onExpand(what, tt)}>Show all {n}</button></li>;
  return (
    <section className="dz-card dz-work" aria-label="Work overview">
      <header className="dz-card-head">
        <div className="dz-tabs" role="tablist" aria-label="Work overview">
          {TABS.map(([k, l, n]) => (
            <button key={k} type="button" role="tab" id={`dz-tab-${k}`} aria-selected={tab === k} aria-controls="dz-work-panel"
              className={"dz-tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>
              {l}<span className="dz-tab-n">{n}</span>
            </button>
          ))}
        </div>
        <Tip text="Show full details">
          <button type="button" className="dz-expand" onClick={() => onExpand(tab, tt)} aria-label={`Show all ${tab} in detail`}>
            <Maximize2 size={14} aria-hidden="true" />
          </button>
        </Tip>
      </header>

      <div id="dz-work-panel" ref={panelRef} className="dz-work-panel" role="tabpanel" aria-labelledby={`dz-tab-${tab}`}>
        {tab === "projects" && (projects.length ? (
          <ul className="dz-ov-list">
            {projects.slice(0, LIMIT).map(p => (
              <li key={p.id}><button type="button" className="dz-ov-row" onClick={() => navigate(`/tasks?projectId=${p.id}`)}>
                <span className="dz-dot" style={{ background: p.color || "var(--brand-500)" }} aria-hidden="true" />
                <span className="dz-ov-name">{p.name}</span><Bar value={p.progress} color={p.color} /><span className="dz-num">{pct(p.progress)}%</span>
              </button></li>
            ))}
            {more(projects.length, "projects")}
          </ul>
        ) : <p className="dz-muted">No projects yet. <button type="button" className="dz-link" onClick={() => navigate("/projects?new=true")}>Create one</button></p>)}

        {tab === "goals" && (goals.length ? (
          <ul className="dz-ov-list">
            {goals.slice(0, LIMIT).map(g => (
              <li key={g.id}><button type="button" className="dz-ov-row" onClick={() => navigate("/goals")}>
                <span className="dz-dot" style={{ background: "var(--viz-goal, #7C5CBF)" }} aria-hidden="true" />
                <span className="dz-ov-name">{g.title}</span><Bar value={g.progress} color="var(--viz-goal, #7C5CBF)" /><span className="dz-num">{pct(g.progress)}%</span>
              </button></li>
            ))}
            {more(goals.length, "goals")}
          </ul>
        ) : <p className="dz-muted">No goals yet. <button type="button" className="dz-link" onClick={() => navigate("/goals?new=true")}>Set one</button></p>)}

        {tab === "tasks" && (
          <>
            <div className="dz-seg dz-seg-sm dz-subtabs" role="group" aria-label="Which tasks">
              {TASK_TABS.map(([k, l]) => (
                <button key={k} type="button" aria-pressed={tt === k} className={tt === k ? "on" : ""} onClick={() => setTaskTab(k)}>
                  {l} <span className="dz-num">{dashTasks[k].length}</span>
                </button>
              ))}
            </div>
            {dashTasks[tt].length ? (
              <ul className="dz-ov-list">
                {dashTasks[tt].slice(0, LIMIT).map(t => <li key={t.id}><TaskLine task={t} navigate={navigate} /></li>)}
                {more(dashTasks[tt].length, "tasks")}
              </ul>
            ) : <p className="dz-muted">{tt === "overdue" ? "Nothing overdue." : tt === "today" ? "Nothing due today." : "Nothing in progress."}</p>}
          </>
        )}
      </div>
    </section>
  );
}

/** The side panel with full details for projects, goals or tasks. */
function DetailPanel({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <div className="dz-sheet-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="dz-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="dz-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="dz-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="dz-sheet-body">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

function ProjectsDetail({ projects, navigate }) {
  const byParent = {};
  const ids = new Set(projects.map((p) => p.id));
  projects.forEach((p) => { if (p.parentProjectId && ids.has(p.parentProjectId)) (byParent[p.parentProjectId] ||= []).push(p); });
  const roots = projects.filter((p) => !p.parentProjectId || !ids.has(p.parentProjectId));
  const row = (p, depth) => (
    <li key={p.id}>
      <button type="button" className="dz-drow" style={{ paddingLeft: 12 + depth * 18 }} onClick={() => navigate(`/tasks?projectId=${p.id}`)}>
        <span className="dz-dot" style={{ background: p.color || "var(--brand-500)" }} aria-hidden="true" />
        <span className="dz-drow-main">
          <span className="dz-drow-name">{depth > 0 && <span className="dz-sub">↳ </span>}{p.name}</span>
          <span className="dz-drow-meta">
            <span className={"dz-pill dz-pill-" + String(p.status || "ACTIVE").toLowerCase().replace(/\s+/g, "_")}>{statusText(p.status || "ACTIVE")}</span>
            {p.dueDate && <span>Due {shortDate(p.dueDate)}</span>}
            {p.taskCount != null && <span>{p.taskCount} tasks</span>}
            {(p.memberEmails || []).length > 0 && <span>{p.memberEmails.length} people</span>}
          </span>
          {p.description && <span className="dz-drow-desc">{p.description}</span>}
        </span>
        <span className="dz-drow-end"><Bar value={p.progress} color={p.color} /><span className="dz-num">{pct(p.progress)}%</span></span>
      </button>
      {(byParent[p.id] || []).length > 0 && <ul className="dz-dlist">{byParent[p.id].map((c) => row(c, depth + 1))}</ul>}
    </li>
  );
  return projects.length ? <ul className="dz-dlist">{roots.map((p) => row(p, 0))}</ul> : <p className="dz-muted">No active projects.</p>;
}

function GoalsDetail({ goals, navigate }) {
  return goals.length ? (
    <ul className="dz-dlist">
      {goals.map((g) => (
        <li key={g.id}>
          <button type="button" className="dz-drow" onClick={() => navigate("/goals")}>
            <span className="dz-dot" style={{ background: "var(--viz-goal, #7C5CBF)" }} aria-hidden="true" />
            <span className="dz-drow-main">
              <span className="dz-drow-name">{g.title}</span>
              <span className="dz-drow-meta">
                <span className={"dz-pill dz-pill-" + String(g.status || "ACTIVE").toLowerCase()}>{statusText(g.status || "ACTIVE")}</span>
                {g.dueDate && <span>Due {shortDate(g.dueDate)}</span>}
                {g.owner && <span>{g.owner}</span>}
              </span>
              {g.description && <span className="dz-drow-desc">{g.description}</span>}
            </span>
            <span className="dz-drow-end"><Bar value={g.progress} color="var(--viz-goal, #7C5CBF)" /><span className="dz-num">{pct(g.progress)}%</span></span>
          </button>
        </li>
      ))}
    </ul>
  ) : <p className="dz-muted">No active goals.</p>;
}

const TASK_TABS = [["active", "In progress"], ["overdue", "Overdue"], ["today", "Due today"]];

function TaskLine({ task, navigate, projectName, full }) {
  const due = task.dueDate ? new Date(task.dueDate) : null;
  const late = due && due < new Date(new Date().setHours(0, 0, 0, 0)) && task.status !== "DONE";
  return (
    <button type="button" className={full ? "dz-drow" : "dz-ov-row"} onClick={() => navigate(`/tasks?highlight=${task.id}`)}>
      <span className={"dz-status dz-status-" + String(task.status || "TODO").toLowerCase()} aria-hidden="true" />
      {full ? (
        <span className="dz-drow-main">
          <span className="dz-drow-name">{task.title}</span>
          <span className="dz-drow-meta">
            <span className={"dz-pill dz-pill-" + String(task.status || "TODO").toLowerCase()}>{statusText(task.status || "TODO")}</span>
            {task.priority && <span>{statusText(task.priority)} priority</span>}
            {projectName && <span>{projectName}</span>}
            {(task.assigneeIds || []).length > 0 && <span>{task.assigneeIds.length} assigned</span>}
          </span>
        </span>
      ) : <span className="dz-ov-name">{task.title}</span>}
      {due && <span className={"dz-due" + (late ? " dz-late" : "")}>{late && <span className="sr-only">Overdue: </span>}{shortDate(due)}</span>}
    </button>
  );
}

function TasksDetail({ dashTasks, navigate, projectName, initialTab }) {
  const [tab, setTab] = useState(initialTab || "active");
  const list = dashTasks[tab] || [];
  return (
    <>
      <div className="dz-seg" role="tablist" aria-label="Which tasks">
        {TASK_TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {l} <span className="dz-num">{(dashTasks[k] || []).length}</span>
          </button>
        ))}
      </div>
      {list.length ? (
        <ul className="dz-dlist">{list.map((t) => <li key={t.id}><TaskLine task={t} navigate={navigate} projectName={projectName(t.projectId)} full /></li>)}</ul>
      ) : <p className="dz-muted">{tab === "overdue" ? "Nothing overdue." : tab === "today" ? "Nothing due today." : "Nothing in progress."}</p>}
      <button type="button" className="dz-link dz-sheet-more" onClick={() => navigate("/tasks")}>Open all tasks →</button>
    </>
  );
}

/** Tasks / Projects / Goals charts: the same content as before, quieter. */
function ChartsPanel({ summary, navigate }) {
  const [tab, setTab] = useState("tasks");
  const css = getComputedStyle(document.documentElement);
  const VIZ = {
    todo: css.getPropertyValue("--viz-todo").trim() || "#5B5FEE",
    progress: css.getPropertyValue("--viz-progress").trim() || "#C17D22",
    done: css.getPropertyValue("--viz-done").trim() || "#1E8E5A",
    overdue: css.getPropertyValue("--viz-overdue").trim() || "#D64545",
    goal: css.getPropertyValue("--viz-goal").trim() || "#7C5CBF",
  };
  const track = css.getPropertyValue("--gray-100").trim() || "#f1f5f9";
  const taskData = [
    { name: "To do", value: summary.todoTasks || 0, color: VIZ.todo, p: "/tasks?status=TODO" },
    { name: "In progress", value: summary.inProgressTasks || 0, color: VIZ.progress, p: "/tasks?status=IN_PROGRESS" },
    { name: "Done", value: summary.doneTasks || 0, color: VIZ.done, p: "/tasks?status=DONE" },
  ];
  const nonZero = taskData.filter((d) => d.value > 0);
  const completionRate = summary.totalTasks > 0 ? Math.round((summary.doneTasks / summary.totalTasks) * 100) : 0;
  const projects = summary.projectsWithProgress || summary.activeProjectList || [];
  const goals = summary.activeGoalList || [];

  return (
    <section className="dz-card dz-charts" aria-label="Charts">
      <header className="dz-card-head">
        <span className="dz-card-title"><PieChartIcon size={15} aria-hidden="true" /> Overview</span>
        <div className="dz-seg dz-seg-sm" role="tablist" aria-label="Chart">
          {[["tasks", "Tasks"], ["projects", "Projects"], ["goals", "Goals"]].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </header>

      {tab === "tasks" && (summary.totalTasks > 0 ? (
        <div className="dz-taskchart">
          <div className="dz-donut">
            <ResponsiveContainer width="100%" height={124}>
              <PieChart>
                <Pie data={[{ value: 1 }]} cx="50%" cy="50%" innerRadius={44} outerRadius={55} dataKey="value" isAnimationActive={false} stroke="none"><Cell fill={track} /></Pie>
                <Pie data={nonZero} cx="50%" cy="50%" innerRadius={44} outerRadius={55} paddingAngle={nonZero.length > 1 ? 2 : 0} dataKey="value" isAnimationActive={false} stroke="none">
                  {nonZero.map((e) => <Cell key={e.name} fill={e.color} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8 }} formatter={(v, n) => [`${v} tasks`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="dz-donut-center"><strong>{completionRate}%</strong><span>complete</span></div>
          </div>
          <div className="dz-legend">
            {taskData.map((d) => (
              <button key={d.name} type="button" className="dz-legend-row" onClick={() => navigate(d.p)}>
                <span className="dz-dot" style={{ background: d.color }} aria-hidden="true" /><span>{d.name}</span><span className="dz-num">{d.value}</span>
              </button>
            ))}
            <div className="dz-legend-sep" />
            <button type="button" className="dz-legend-row" onClick={() => navigate("/tasks?filter=overdue")}>
              <span className="dz-dot" style={{ background: VIZ.overdue }} aria-hidden="true" /><span>Overdue</span><span className="dz-num">{summary.overdueTasks?.length || 0}</span>
            </button>
            <button type="button" className="dz-legend-row" onClick={() => navigate("/tasks?filter=today")}>
              <span className="dz-dot dz-dot-ring" aria-hidden="true" /><span>Due today</span><span className="dz-num">{summary.todayTasks?.length || 0}</span>
            </button>
            <div className="dz-legend-total"><span>Total</span><span className="dz-num">{summary.totalTasks || 0}</span></div>
          </div>
        </div>
      ) : <p className="dz-muted">No tasks yet.</p>)}

      {tab === "projects" && (projects.length ? (
        <ul className="dz-barlist">
          {projects.map((p) => (
            <li key={p.id}><button type="button" onClick={() => navigate(`/tasks?projectId=${p.id}`)}>
              <span className="dz-barlist-name">{p.name}</span><Bar value={p.progress} color={p.color || VIZ.todo} /><span className="dz-num">{pct(p.progress)}%</span>
            </button></li>
          ))}
        </ul>
      ) : <p className="dz-muted">No projects yet.</p>)}

      {tab === "goals" && (goals.length ? (
        <ul className="dz-barlist">
          {goals.map((g) => (
            <li key={g.id}><button type="button" onClick={() => navigate("/goals")}>
              <span className="dz-barlist-name">{g.title}</span><Bar value={g.progress} color={VIZ.goal} /><span className="dz-num">{pct(g.progress)}%</span>
            </button></li>
          ))}
        </ul>
      ) : <p className="dz-muted">No goals yet.</p>)}
    </section>
  );
}

/** AI hub: one insight line, three shortcuts, one button. */
function AiHub({ summary, totalOverdue, completionRate, navigate, tiles }) {
  return (
    <section className="dz-card dz-ai" aria-label="AI hub">
      <header className="dz-card-head"><span className="dz-card-title"><Sparkles size={15} aria-hidden="true" /> AI hub</span></header>
      <p className="dz-ai-text">
        {summary.inProgressTasks || 0} tasks in progress across {summary.activeProjects || summary.totalProjects || 0} projects.
        {totalOverdue > 0 && <span className="dz-late"> {totalOverdue} overdue.</span>}
        {completionRate >= 70 && <span className="dz-good"> On track.</span>}
      </p>
      <div className="dz-ai-links">
        {tiles.map((t) => (
          <button key={t.to} type="button" className="dz-ai-link" onClick={() => navigate(t.to)}>
            <t.Icon size={15} aria-hidden="true" /><span>{t.label}</span>
          </button>
        ))}
      </div>
      <button type="button" className="dz-ai-btn" onClick={() => navigate("/ai")}>Ask the AI assistant <ArrowRight size={14} aria-hidden="true" /></button>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   DASHBOARD
   ════════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const { activeWorkspace } = useAuth();
  const { show: showToast } = useToast();
  const navigate  = useNavigate();
  const [summary,     setSummary]     = useState(null);
  const [dashTasks,   setDashTasks]   = useState({ active: [], overdue: [], today: [] });
  const [loading,     setLoading]     = useState(true);
  const [showOverdue, setShowOverdue] = useState(false);
  const [detail,      setDetail]      = useState(null);   // "projects" | "goals" | "tasks"
  const [taskTab,     setTaskTab]     = useState("active");

  useEffect(() => {
    if (!activeWorkspace?.id) return;                       // wait until the workspace is chosen
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets on workspace switch, then loads fresh data below
    setSummary(null);
    setLoading(true);
    getDashboardSummary()
      .then(r => { setSummary(r.data); setLoading(false); })
      .catch(() => setLoading(false));
    import("../api/tasks").then(m => m.getTasks({ limit: 100 })).then(tr => {
      const all = Array.isArray(tr.data) ? tr.data : Array.isArray(tr.data?.data) ? tr.data.data : [];
      const now = new Date(); now.setHours(0,0,0,0);
      const eod = new Date(); eod.setHours(23,59,59,999);
      setDashTasks({
        active:  all.filter(t => t.status === "IN_PROGRESS"),
        overdue: all.filter(t => t.dueDate && new Date(t.dueDate) < now && t.status !== "DONE"),
        today:   all.filter(t => { if (!t.dueDate) return false; const d = new Date(t.dueDate); return d >= now && d <= eod && t.status !== "DONE"; }),
      });
    }).catch(() => {});
  }, [activeWorkspace?.id]);

  const handleSendReminder = async () => {
    try   { await client.post("/reminders/send-now"); showToast("Reminder sent", "success"); }
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
  const completionRate = summary.totalTasks > 0 ? Math.round((summary.doneTasks/summary.totalTasks)*100) : 0;
  const totalOverdue = (summary.overdueTasks?.length||0) + (summary.overdueProjects?.length||0) + (summary.overdueGoals?.length||0);
  const goalHealth = summary.totalGoals > 0 ? Math.round(((summary.achievedGoals||0)/summary.totalGoals)*100) : 0;
  const todayStr = fmtDate(new Date());
  const projects = summary.projectsWithProgress?.length > 0 ? summary.projectsWithProgress : (summary.activeProjectList || []);
  const goals = summary.activeGoalList || [];
  const projectName = (id) => projects.find(p => p.id === id)?.name;

  /* hub definitions (icons only on the page; names show as tooltips) */
  const workTiles = [
    { Icon:ICONS.projects, tint:"rgba(99,102,241,.1)",  color:"#6366f1", label:"Projects",  sub:`${summary.totalProjects||0} active`,  to:"/projects" },
    { Icon:ICONS.tasks,    tint:totalOverdue>0?"rgba(239,68,68,.12)":"rgba(16,185,129,.1)", color:totalOverdue>0?"#ef4444":"#10b981", label:"Tasks", sub:totalOverdue>0?`${totalOverdue} overdue`:`${summary.totalTasks||0} total`, badge: totalOverdue || null, to:"/tasks" },
    { Icon:ICONS.goals,    tint:"rgba(139,92,246,.1)",  color:"#8b5cf6", label:"Goals",     sub:`${goalHealth}% health`,               to:"/goals" },
    { Icon:ICONS.kanban,   tint:"rgba(14,165,233,.1)",  color:"#0ea5e9", label:"Kanban",    sub:`${summary.inProgressTasks||0} active`, to:"/kanban" },
    { Icon:ICONS.epics,    tint:"rgba(245,158,11,.1)",  color:"#f59e0b", label:"Epics",     to:"/epics" },
    { Icon:ICONS.sprints,  tint:"rgba(236,72,153,.1)",  color:"#ec4899", label:"Sprints",   to:"/sprints" },
    { Icon:ICONS.gantt,    tint:"rgba(99,102,241,.1)",  color:"#6366f1", label:"Gantt",     to:"/gantt" },
    { Icon:ICONS.calendar, tint:"rgba(13,148,136,.1)",  color:"#0d9488", label:"Calendar",  sub:`${summary.todayTasks?.length||0} today`, to:"/calendar" },
    { Icon:ICONS.deploy,   tint:"rgba(217,70,239,.1)",  color:"#d946ef", label:"Deployments", to:"/deployments" },
    { Icon:ICONS.graph,    tint:"rgba(100,116,139,.1)", color:"#64748b", label:"Knowledge graph", to:"/knowledge-graph" },
  ];
  const insightsTiles = [
    { Icon:ICONS.analytics,     tint:"rgba(99,102,241,.1)",  color:"#6366f1", label:"Analytics",  to:"/analytics" },
    { Icon:ICONS.kpis,          tint:"rgba(14,165,233,.1)",  color:"#0ea5e9", label:"KPIs",       to:"/kpis" },
    { Icon:ICONS.roi,           tint:"rgba(13,148,136,.1)",  color:"#0d9488", label:"ROI engine", to:"/roi" },
    { Icon:ICONS.roadmap,       tint:"rgba(139,92,246,.1)",  color:"#8b5cf6", label:"Roadmap & RAID", to:"/roadmap" },
    { Icon:ICONS.portfolio,     tint:"rgba(245,158,11,.1)",  color:"#f59e0b", label:"Portfolio",  to:"/portfolio" },
    { Icon:ICONS.portfolioPlus, tint:"rgba(217,70,239,.1)",  color:"#d946ef", label:"Portfolio+", to:"/portfolio-plus" },
    { Icon:ICONS.executive,     tint:"rgba(234,179,8,.12)",  color:"#ca8a04", label:"Executive",  to:"/executive" },
    { Icon:ICONS.scenarios,     tint:"rgba(236,72,153,.1)",  color:"#ec4899", label:"Scenarios",  to:"/scenarios" },
    { Icon:ICONS.reports,       tint:"rgba(100,116,139,.1)", color:"#64748b", label:"Reports",    to:"/reports" },
    { Icon:ICONS.time,          tint:"rgba(16,185,129,.1)",  color:"#10b981", label:"Time & billing", to:"/time-tracking" },
  ];
  const knowledgeTiles = [
    { Icon:ICONS.docs,      tint:"rgba(99,102,241,.1)", color:"#6366f1", label:"Docs",      to:"/docs" },
    { Icon:ICONS.meetings,  tint:"rgba(14,165,233,.1)", color:"#0ea5e9", label:"Meetings",  to:"/meetings" },
    { Icon:ICONS.decisions, tint:"rgba(139,92,246,.1)", color:"#8b5cf6", label:"Decisions", to:"/decisions" },
    { Icon:ICONS.sops,      tint:"rgba(16,185,129,.1)", color:"#10b981", label:"SOPs",      to:"/sops" },
  ];
  const automateTiles = [
    { Icon:ICONS.bpm,          tint:"rgba(99,102,241,.1)", color:"#6366f1", label:"BPM studio",  to:"/bpm" },
    { Icon:ICONS.automations,  tint:"rgba(245,158,11,.1)", color:"#f59e0b", label:"Automations", to:"/automations" },
    { Icon:ICONS.integrations, tint:"rgba(14,165,233,.1)", color:"#0ea5e9", label:"Integrations",to:"/integrations" },
    { Icon:ICONS.import,       tint:"rgba(16,185,129,.1)", color:"#10b981", label:"Import",      to:"/import" },
  ];
  const quickTiles = [
    { Icon:Plus,           tint:"var(--brand-50)", color:"var(--brand-600)", label:"New task",         to:"/tasks?new=true" },
    { Icon:FolderPlus,     tint:"var(--brand-50)", color:"var(--brand-600)", label:"New project",      to:"/projects?new=true" },
    { Icon:Target,         tint:"var(--brand-50)", color:"var(--brand-600)", label:"New goal",         to:"/goals?new=true" },
    { Icon:CalendarPlus,   tint:"var(--brand-50)", color:"var(--brand-600)", label:"Schedule meeting", to:"/meetings" },
    { Icon:ClipboardList,  tint:"var(--brand-50)", color:"var(--brand-600)", label:"View reports",     to:"/reports" },
  ];
  const aiTiles = [
    { Icon:ICONS.assistant,    label:"Assistant",    to:"/ai" },
    { Icon:ICONS.intelligence, label:"Intelligence", to:"/ai-intelligence" },
    { Icon:ICONS.aiSettings,   label:"Settings",     to:"/ai-settings" },
  ];

  const openTasks = (tab) => { setTaskTab(tab); setDetail("tasks"); };

  return (
    <div className="db-root dz">


      {/* HEADER */}
      <header className="dz-hero">
        <div className="dz-hero-text">
          <h1>Today</h1>
          <p>{todayStr}</p>
        </div>
        <div className="dz-hero-actions">
          <button type="button" className="dz-btn dz-btn--quiet" onClick={() => navigate("/workflow-guide")}><Compass size={15} aria-hidden="true" /> Guide</button>
          <button type="button" className="dz-btn dz-btn--quiet" onClick={handleSendReminder}><Mail size={15} aria-hidden="true" /> Send reminder</button>
          <button type="button" className="dz-btn" onClick={() => navigate("/goals?new=true")}><Plus size={15} aria-hidden="true" /> New goal</button>
          <button type="button" className="dz-btn dz-btn--primary" onClick={() => navigate("/projects?new=true")}><Plus size={15} aria-hidden="true" /> New project</button>
        </div>
      </header>
      <div className="dz-chips" aria-label="At a glance">
        {totalOverdue > 0 && <Chip Icon={AlertTriangle} value={totalOverdue} label="overdue" alert onClick={() => setShowOverdue(true)} />}
        <Chip Icon={CheckSquare} value={summary.inProgressTasks||0} label="in progress" onClick={() => navigate("/tasks?status=IN_PROGRESS")} />
        <Chip Icon={Target} value={`${goalHealth}%`} label="goal health" onClick={() => navigate("/goals")} />
        <Chip Icon={LineChart} value={`${completionRate}%`} label="complete" onClick={() => navigate("/analytics")} />
        <Chip Icon={ShieldCheck} value={summary.raidRisks||0} label="RAID risks" alert={(summary.raidRisks||0) > 0} onClick={() => navigate("/roadmap")} />
        {summary.roiForecast ? <Chip Icon={DollarSign} value={summary.roiForecast} label="ROI forecast" onClick={() => navigate("/roi")} /> : null}
        <Chip Icon={Users} value={summary.onlineCount||0} label="online" onClick={() => navigate("/team")} />
      </div>

      {/* Two columns: work and shortcuts on the left; charts, AI and today's meetings on the right. */}
      <div className="dz-cols">
        <div className="dz-col">
          <WorkOverview projects={projects} goals={goals} dashTasks={dashTasks} navigate={navigate}
            onExpand={(what, tt) => { if (what === "tasks") openTasks(tt); else setDetail(what); }} />
          <section className="dz-card dz-launch" aria-label="Shortcuts">
            <IconRail label="Work" tiles={workTiles} navigate={navigate} />
            <IconRail label="Insights" tiles={insightsTiles} navigate={navigate} />
            <IconRail label="Knowledge" tiles={knowledgeTiles} navigate={navigate} />
            <IconRail label="Automate" tiles={automateTiles} navigate={navigate} />
            <IconRail label="Quick actions" tiles={quickTiles} navigate={navigate} />
          </section>
        </div>
        <div className="dz-col">
          <ChartsPanel summary={summary} navigate={navigate} />
          <AiHub summary={summary} totalOverdue={totalOverdue} completionRate={completionRate} navigate={navigate} tiles={aiTiles} />
          <div className="dz-pulse"><MeetingPulseCard /></div>
        </div>
      </div>

      {detail === "projects" && <DetailPanel title={`Active projects (${projects.length})`} onClose={() => setDetail(null)}><ProjectsDetail projects={projects} navigate={navigate} /></DetailPanel>}
      {detail === "goals" && <DetailPanel title={`Active goals (${goals.length})`} onClose={() => setDetail(null)}><GoalsDetail goals={goals} navigate={navigate} /></DetailPanel>}
      {detail === "tasks" && <DetailPanel title="Tasks" onClose={() => setDetail(null)}><TasksDetail dashTasks={dashTasks} navigate={navigate} projectName={projectName} initialTab={taskTab} /></DetailPanel>}
      {showOverdue && <OverdueModal summary={summary} onClose={() => setShowOverdue(false)} navigate={navigate} />}
    </div>
  );
}
