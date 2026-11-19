import { useState, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, CheckCircle2, ListChecks, Plus, Timer, X } from "lucide-react";
import { getDashboardSummary } from "../api/dashboard";
import { getTasks } from "../api/tasks";
import { useAuth } from "../hooks/useAuth";
import { usePeople } from "../context/PeopleContext";
import MeetingPulseCard from "../components/MeetingPulseCard";
import { ProjectWorkButton } from "../components/WorkTimer";
import { elapsed, hoursText, useNow, useWorkTimer } from "../hooks/useWorkTimer";
import { statusText } from "../utils/statusText";
import "../styles/pages/dashboard.css";            // MeetingPulseCard uses its db-card styles
import "../styles/pages/dashboard-today.css";

/*
 * The dashboard answers one question: "what needs me today?"
 * Everything else (every hub, chart and shortcut that used to be here) is one click away in the sidebar.
 */

function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 21) return "Good evening";
  return "Hello";
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };

function TaskLine({ t, navigate }) {
  const due = t.dueDate ? new Date(t.dueDate) : null;
  const late = due && due < startOfToday() && t.status !== "DONE";
  const today = due && due >= startOfToday() && due <= endOfToday();
  return (
    <li>
      <button type="button" className="td-task" onClick={() => navigate(`/tasks?highlight=${t.id}`)}>
        <span className="td-task-title">{t.title}</span>
        {due && (
          <span className={"td-task-due" + (late ? " td-late" : today ? " td-today" : "")}>
            {late && <AlertTriangle size={12} aria-hidden="true" />}
            {late && <span className="sr-only">Overdue: </span>}
            {today ? "Today" : due.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </span>
        )}
        <span className={"td-task-status td-s-" + (t.status || "TODO").toLowerCase()}>{statusText(t.status || "TODO")}</span>
      </button>
    </li>
  );
}

function TimeToday({ projects }) {
  const { running, todayMinutes, loaded } = useWorkTimer();
  const now = useNow(!!running);
  return (
    <section className="td-card" aria-labelledby="td-time">
      <div className="td-card-head"><h2 id="td-time"><Timer size={15} aria-hidden="true" /> Time today</h2></div>
      {running ? (
        <div className="td-running">
          <span className="td-running-label">Working on</span>
          <span className="td-running-name">{running.projectName}</span>
          <span className="td-running-time">{elapsed(running.startedAt, now)}</span>
        </div>
      ) : (
        <p className="td-muted">{loaded ? "No timer running." : "Checking…"}</p>
      )}
      <p className="td-total">{hoursText(todayMinutes)} tracked today</p>
      {projects.length > 0 && (
        <div className="td-quick">
          <span className="td-muted">{running ? "Switch to" : "Start on"}</span>
          {projects.filter((p) => p.id !== running?.projectId).slice(0, 3).map((p) => (
            <div key={p.id} className="td-quick-row"><span className="td-quick-name">{p.name}</span><ProjectWorkButton project={p} /></div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function Dashboard() {
  const { user, activeWorkspace } = useAuth();
  const { byEmail, ensureLoaded } = usePeople();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [tab, setTab] = useState(null);
  const [failed, setFailed] = useState(false);
  const [hideAlert, setHideAlert] = useState(false);

  useEffect(() => { ensureLoaded(); }, [ensureLoaded]);
  useEffect(() => {
    if (!activeWorkspace?.id) return undefined;              // right after sign-in: wait until the workspace is chosen
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on workspace switch, then load
    setSummary(null); setTasks(null); setFailed(false);
    getDashboardSummary().then((r) => { if (alive) setSummary(r.data); }).catch(() => { if (alive) setFailed(true); });
    getTasks({ limit: 200 }).then((r) => {
      if (!alive) return;
      setTasks(Array.isArray(r.data) ? r.data : Array.isArray(r.data?.data) ? r.data.data : []);
    }).catch(() => { if (alive) setTasks([]); });
    return () => { alive = false; };
  }, [activeWorkspace?.id]);

  // My tasks when I have any; otherwise the workspace's (e.g. a manager who assigns but isn't assigned).
  const me = byEmail.get((user?.email || "").toLowerCase());
  const { list, mine } = useMemo(() => {
    const open = (tasks || []).filter((t) => t.status !== "DONE");
    const assigned = me ? open.filter((t) => (t.assigneeIds || []).includes(me.id)) : [];
    return assigned.length ? { list: assigned, mine: true } : { list: open, mine: false };
  }, [tasks, me]);
  const groups = useMemo(() => {
    const s = startOfToday(), e = endOfToday();
    return {
      overdue: list.filter((t) => t.dueDate && new Date(t.dueDate) < s),
      today: list.filter((t) => t.dueDate && new Date(t.dueDate) >= s && new Date(t.dueDate) <= e),
      doing: list.filter((t) => t.status === "IN_PROGRESS"),
    };
  }, [list]);
  const firstTab = groups.overdue.length ? "overdue" : groups.today.length ? "today" : "doing";
  const current = tab || firstTab;
  const shown = groups[current] || [];

  if (failed && !summary) return (
    <div className="td"><div className="td-card td-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /> The dashboard couldn't load. Check your connection and refresh.</div></div>
  );

  const projects = (summary?.projectsWithProgress?.length ? summary.projectsWithProgress : summary?.activeProjectList || [])
    .filter((p) => !p.archived);
  const myEmail = (user?.email || "").toLowerCase();
  const myProjects = projects.filter((p) => (p.memberEmails || []).some((e) => e.toLowerCase() === myEmail));
  const quickProjects = (myProjects.length ? myProjects : projects);
  const goals = summary?.activeGoalList || [];
  const overdueCount = summary?.overdueCount ?? groups.overdue.length;
  const firstName = user?.name?.split(" ")[0] || "there";

  const TABS = [
    { key: "overdue", label: "Overdue", n: groups.overdue.length },
    { key: "today", label: "Due today", n: groups.today.length },
    { key: "doing", label: "In progress", n: groups.doing.length },
  ];

  return (
    <div className="td">
      {overdueCount > 0 && !hideAlert && (
        <div className="td-alert" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{mine
            ? `${overdueCount} ${overdueCount === 1 ? "task" : "tasks"} overdue in the workspace`
            : `${overdueCount} ${overdueCount === 1 ? "task is" : "tasks are"} overdue`}</span>
          <Link to="/tasks?filter=overdue" className="td-alert-link">Review</Link>
          <button type="button" className="td-x" onClick={() => setHideAlert(true)} aria-label="Hide"><X size={15} /></button>
        </div>
      )}

      <header className="td-head">
        <div>
          <h1>{greeting()}, {firstName}</h1>
          <p className="td-date">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <div className="td-actions">
          <button type="button" className="btn btn-primary" onClick={() => navigate("/tasks?new=true")}><Plus size={15} aria-hidden="true" /> New task</button>
          <button type="button" className="btn btn-secondary" onClick={() => navigate("/projects?new=true")}><Plus size={15} aria-hidden="true" /> New project</button>
        </div>
      </header>

      <div className="td-stats">
        <button type="button" className={"td-stat" + (groups.overdue.length ? " td-stat--bad" : "")} onClick={() => setTab("overdue")}>
          <span className="td-stat-n">{tasks ? groups.overdue.length : "–"}</span><span className="td-stat-l">Overdue</span>
        </button>
        <button type="button" className="td-stat" onClick={() => setTab("today")}>
          <span className="td-stat-n">{tasks ? groups.today.length : "–"}</span><span className="td-stat-l">Due today</span>
        </button>
        <button type="button" className="td-stat" onClick={() => setTab("doing")}>
          <span className="td-stat-n">{tasks ? groups.doing.length : "–"}</span><span className="td-stat-l">In progress</span>
        </button>
      </div>

      <div className="td-grid">
        <div className="td-main">
        <section className="td-card td-work" aria-labelledby="td-work">
          <div className="td-card-head">
            <h2 id="td-work"><ListChecks size={15} aria-hidden="true" /> {mine ? "My work" : "Open work"}</h2>
            <Link to="/tasks" className="td-link">All tasks</Link>
          </div>
          <div className="td-tabs" role="tablist" aria-label="Which tasks">
            {TABS.map((x) => (
              <button key={x.key} type="button" role="tab" aria-selected={current === x.key}
                className={"td-tab" + (current === x.key ? " on" : "")} onClick={() => setTab(x.key)}>
                {x.label} <span className="td-tab-n">{x.n}</span>
              </button>
            ))}
          </div>
          {!tasks ? <p className="td-muted">Loading…</p>
            : shown.length === 0 ? (
              <p className="td-empty"><CheckCircle2 size={16} aria-hidden="true" />
                {current === "overdue" ? "Nothing overdue." : current === "today" ? "Nothing due today." : "Nothing in progress."}</p>
            ) : (
              <ul className="td-tasks">{shown.slice(0, 8).map((t) => <TaskLine key={t.id} t={t} navigate={navigate} />)}</ul>
            )}
          {shown.length > 8 && <Link to="/tasks" className="td-link td-more">+{shown.length - 8} more</Link>}
        </section>

        <section className="td-card td-projects" aria-labelledby="td-proj">
          <div className="td-card-head">
            <h2 id="td-proj">Projects</h2>
            <Link to="/projects" className="td-link">All projects</Link>
          </div>
          {!summary ? <p className="td-muted">Loading…</p>
            : projects.length === 0 ? <p className="td-muted">No projects yet. <Link to="/projects?new=true" className="td-link">Create one</Link></p>
            : (
              <ul className="td-plist">
                {projects.slice(0, 6).map((p) => (
                  <li key={p.id}>
                    <button type="button" className="td-proj" onClick={() => navigate(`/tasks?projectId=${p.id}`)}>
                      <span className="td-proj-dot" style={{ background: p.color || "var(--brand-500)" }} aria-hidden="true" />
                      <span className="td-proj-name">{p.name}</span>
                      <span className="td-bar" aria-hidden="true"><span style={{ width: `${p.progress || 0}%`, background: p.color || "var(--brand-500)" }} /></span>
                      <span className="td-proj-pct">{p.progress || 0}%</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </section>

        {goals.length > 0 && (
          <section className="td-card td-goals" aria-labelledby="td-goals">
            <div className="td-card-head"><h2 id="td-goals"><CalendarClock size={15} aria-hidden="true" /> Goals</h2><Link to="/goals" className="td-link">All goals</Link></div>
            <ul className="td-plist">
              {goals.slice(0, 4).map((g) => (
                <li key={g.id}>
                  <button type="button" className="td-proj" onClick={() => navigate("/goals")}>
                    <span className="td-proj-name">{g.title}</span>
                    <span className="td-bar" aria-hidden="true"><span style={{ width: `${g.progress || 0}%` }} /></span>
                    <span className="td-proj-pct">{g.progress || 0}%</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        </div>

        <div className="td-side">
          <TimeToday projects={quickProjects} />
          <MeetingPulseCard />
        </div>
      </div>
    </div>
  );
}
