import client, { unwrapList } from "../api/client";
import React, { useState, useEffect } from "react";
import {
  getSprints, createSprint, updateSprint, deleteSprint, addTaskToSprint, removeTaskFromSprint,
  getBurndown, saveRetro,
} from "../api/sprints";
import { getTasks } from "../api/tasks";
import PageHeader from "../components/PageHeader";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

const STATUS_META = {
  PLANNING:  { label:"Planning",  color:"var(--brand-500)", bg:"rgba(99,102,241,0.12)" },
  ACTIVE:    { label:"Active",    color:"var(--success)", bg:"rgba(5,150,105,0.12)" },
  COMPLETED: { label:"Completed", color:"#06b6d4", bg:"rgba(6,182,212,0.12)" },
  CANCELLED: { label:"Cancelled", color:"var(--gray-500)", bg:"rgba(107,114,128,0.12)" },
};

const MOOD_META = {
  GREAT:   { icon:"😄", label:"Great" },
  GOOD:    { icon:"🙂", label:"Good" },
  NEUTRAL: { icon:"😐", label:"Neutral" },
  BAD:     { icon:"😟", label:"Bad" },
};

// ── Sprint Form ────────────────────────────────────────────────

// ── A-7: Sprint Velocity + Cycle Time chart ───────────────────
function VelocityChart({ sprints, tasks }) {
  if (!sprints || sprints.length === 0) return null;

  // Calculate velocity per sprint (completed tasks)
  const velocityData = sprints
    .filter(s => s.status === "COMPLETED" || s.status === "ACTIVE")
    .slice(-8) // last 8 sprints
    .map(s => {
      const sprintTasks = tasks.filter(t => (s.taskIds||[]).includes(t.id));
      const completed   = sprintTasks.filter(t => t.status === "DONE").length;
      const total       = sprintTasks.length;
      const storyPoints = sprintTasks.filter(t => t.status === "DONE")
        .reduce((sum, t) => sum + (t.storyPoints || 0), 0);
      return {
        name:       s.name || "Sprint",
        completed,
        total,
        storyPoints,
        completion: total > 0 ? Math.round((completed/total)*100) : 0,
      };
    });

  const avgVelocity = velocityData.length > 0
    ? Math.round(velocityData.reduce((s,d) => s + d.completed, 0) / velocityData.length)
    : 0;

  const maxVal = Math.max(...velocityData.map(d => Math.max(d.completed, d.total)), 1);

  return (
    <div className="velocity-chart-card">
      <div className="velocity-chart-header">
        <div>
          <div className="velocity-chart-title">📈 Sprint Velocity History</div>
          <div className="velocity-chart-sub">Avg: {avgVelocity} tasks/sprint</div>
        </div>
      </div>

      {velocityData.length === 0 ? (
        <div className="empty-state" style={{ padding:"20px" }}>
          Complete sprints to see velocity history.
        </div>
      ) : (
        <div className="velocity-bars">
          {velocityData.map((d, i) => (
            <div key={i} className="velocity-bar-group">
              <div className="velocity-bar-track">
                {/* Total bar */}
                <div className="velocity-bar-total"
                  style={{ height:`${(d.total/maxVal)*100}%` }}
                  title={`Total: ${d.total} tasks`} />
                {/* Completed bar */}
                <div className="velocity-bar-done"
                  style={{ height:`${(d.completed/maxVal)*100}%` }}
                  title={`Completed: ${d.completed} tasks`} />
                {/* Average line */}
                <div className="velocity-avg-line"
                  style={{ bottom:`${(avgVelocity/maxVal)*100}%` }} />
              </div>
              <div className="velocity-bar-label">{d.name.replace("Sprint ","S")}</div>
              <div className="velocity-bar-num">{d.completed}</div>
              {d.completion < 80 && d.total > 0 && (
                <div className="velocity-completion"
                  style={{ color: d.completion >= 80 ? "var(--success)" : "var(--warning)" }}>
                  {d.completion}%
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Cycle time approximation */}
      {tasks.length > 0 && (() => {
        const doneTasks = tasks.filter(t => t.status === "DONE" &&
          t.createdAt && t.updatedAt);
        if (doneTasks.length === 0) return null;
        const avgCycle = doneTasks.reduce((sum, t) => {
          const days = (new Date(t.updatedAt) - new Date(t.createdAt))
            / (1000*60*60*24);
          return sum + Math.max(0, days);
        }, 0) / doneTasks.length;
        return (
          <div className="cycle-time-bar">
            <span className="cycle-time-label">⏱ Avg Cycle Time</span>
            <span className="cycle-time-value">{avgCycle.toFixed(1)} days</span>
            <span className="cycle-time-label" style={{ marginLeft:"16px" }}>
              📊 Based on {doneTasks.length} completed tasks
            </span>
          </div>
        );
      })()}
    </div>
  );
}

function SprintForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    name: "", goal: "", status: "PLANNING",
    startDate: "", endDate: "", projectId: "",
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
        <h2>{initial ? "Edit Sprint" : "New Sprint"}</h2>
        <div className="form-group">
          <label htmlFor={"sprints-sprint-name"}>Sprint Name *</label>
          <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Sprint 1" id={"sprints-sprint-name"} />
        </div>
        <div className="form-group">
          <label htmlFor={"sprints-sprint-goal"}>Sprint Goal</label>
          <textarea rows={2} value={form.goal} onChange={e => set("goal", e.target.value)}
            placeholder="What does this sprint aim to achieve?" id={"sprints-sprint-goal"} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"sprints-start-date"}>Start Date</label>
            <input type="date" value={form.startDate?.slice(0,10) || ""}
              onChange={e => set("startDate", e.target.value)} id={"sprints-start-date"} />
          </div>
          <div className="form-group">
            <label htmlFor={"sprints-end-date"}>End Date</label>
            <input type="date" value={form.endDate?.slice(0,10) || ""}
              onChange={e => set("endDate", e.target.value)} id={"sprints-end-date"} />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor={"sprints-status"}>Status</label>
          <select value={form.status} onChange={e => set("status", e.target.value)} id={"sprints-status"}>
            {Object.keys(STATUS_META).map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        </div>
        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || !form.name.trim()}>
            {saving ? "Saving…" : "Save Sprint"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Backlog Panel (C-1) ────────────────────────────────────────
function BacklogPanel({ sprint, allTasks, onTaskAdded, onTaskRemoved }) {
  const sprintTaskIds = sprint.taskIds || [];
  const sprintTasks   = allTasks.filter(t => sprintTaskIds.includes(t.id));
  const backlogTasks  = allTasks.filter(t => !t.sprintId && !sprintTaskIds.includes(t.id) && t.status !== "DONE");
  const [search, setSearch] = useState("");

  const filtered = backlogTasks.filter(t =>
    t.title?.toLowerCase().includes(search.toLowerCase())
  );

  const totalPoints = sprintTasks.reduce((s, t) => s + (t.storyPoints || 0), 0);
  const donePoints  = sprintTasks.filter(t => t.status === "DONE").reduce((s, t) => s + (t.storyPoints || 0), 0);

  return (
    <div className="sprint-backlog">
      <div className="sprint-backlog-header">
        <span className="sprint-section-label">📋 Sprint Backlog</span>
        <span className="sprint-points-badge">{donePoints} / {totalPoints} pts</span>
      </div>

      {/* Sprint tasks */}
      <div className="sprint-task-list">
        {sprintTasks.map(t => (
          <div key={t.id} className="sprint-task-row">
            <span className={`sprint-task-status sprint-status-${t.status?.toLowerCase()}`} />
            <span className="sprint-task-title">{t.title}</span>
            <span className="sprint-task-points">{t.storyPoints || "—"} pt</span>
            <button className="sprint-task-remove-btn" title="Remove from sprint"
              onClick={() => onTaskRemoved(sprint.id, t.id)}>✕</button>
          </div>
        ))}
        {sprintTasks.length === 0 && (
          <div className="sprint-backlog-empty">No tasks in sprint. Add from backlog below.</div>
        )}
      </div>

      {/* Backlog */}
      <div className="sprint-section-label" style={{ marginTop:"16px" }}>
        📥 Backlog ({filtered.length})
      </div>
      <input className="sprint-search" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search backlog tasks…" />
      <div className="sprint-task-list sprint-backlog-list">
        {filtered.slice(0,20).map(t => (
          <div key={t.id} className="sprint-task-row sprint-backlog-row">
            <span className="sprint-task-title">{t.title}</span>
            <span className="sprint-task-points">{t.storyPoints || "—"} pt</span>
            <button className="btn-secondary" style={{ fontSize:"11px", padding:"3px 8px" }}
              onClick={() => onTaskAdded(sprint.id, t.id)}>+ Add</button>
          </div>
        ))}
        {filtered.length === 0 && <div className="sprint-backlog-empty">No backlog tasks</div>}
      </div>
    </div>
  );
}


// ── Burnup Chart ──────────────────────────────────────────────
function BurnupChart({ sprint, allTasks }) {
  const sprintTasks = allTasks.filter(t => (sprint.taskIds||[]).includes(t.id));
  const totalPts    = sprintTasks.reduce((s,t) => s + (t.storyPoints||0), 0);

  if (!sprint.startDate || !sprint.endDate || sprintTasks.length === 0) {
    return (
      <div className="sprint-chart-empty">
        Set sprint dates and add tasks with story points to see the burnup chart.
      </div>
    );
  }

  const start   = new Date(sprint.startDate);
  const end     = new Date(sprint.endDate);
  const today   = new Date();
  const totalDays = Math.max(1, Math.ceil((end - start) / 86400000));

  // Build data points: one per day
  const points = [];
  for (let d = 0; d <= Math.min(totalDays, Math.ceil((today - start)/86400000)); d++) {
    const dayEnd = new Date(start.getTime() + (d+1)*86400000);
    const completed = sprintTasks
      .filter(t => t.status === "DONE" && t.updatedAt && new Date(t.updatedAt) <= dayEnd)
      .reduce((s,t) => s + (t.storyPoints||0), 0);
    points.push({ day:`D${d+1}`, completed, scope: totalPts });
  }

  const maxPts = Math.max(totalPts, 1);

  return (
    <div className="sprint-burnup-card">
      <div className="sprint-chart-title">📈 Burnup Chart — {sprint.name}</div>
      <div className="sprint-chart-legend">
        <span className="sprint-legend-dot" style={{ background:"var(--brand-500)" }} /> Completed
        <span className="sprint-legend-dot" style={{ background:"var(--border)", marginLeft:"12px" }} /> Scope
      </div>
      <div className="sprint-burnup-bars">
        {points.map((p, i) => (
          <div key={i} className="sprint-burnup-col">
            <div className="sprint-burnup-track">
              <div className="sprint-burnup-scope"
                style={{ height:`${(p.scope/maxPts)*100}%` }} />
              <div className="sprint-burnup-done"
                style={{ height:`${(p.completed/maxPts)*100}%`,
                  background: p.completed >= p.scope ? "var(--success)" : "var(--brand-500)" }} />
            </div>
            <div className="sprint-burnup-label">{p.day}</div>
          </div>
        ))}
      </div>
      <div className="sprint-burnup-stats">
        <span>Total scope: <strong>{totalPts} pts</strong></span>
        <span>Completed: <strong style={{ color:"var(--brand-500)" }}>
          {points.length > 0 ? points[points.length-1].completed : 0} pts
        </strong></span>
      </div>
    </div>
  );
}

// ── Sprint Predictability Score ───────────────────────────────
function PredictabilityPanel({ sprints, allTasks }) {
  const completed = sprints.filter(s => s.status === "COMPLETED");
  if (completed.length === 0) {
    return <div className="sprint-chart-empty">Complete sprints to see predictability scores.</div>;
  }

  const scores = completed.slice(-6).map(s => {
    const tasks     = allTasks.filter(t => (s.taskIds||[]).includes(t.id));
    const committed = tasks.reduce((sum, t) => sum + (t.storyPoints||0), 0);
    const done      = tasks.filter(t => t.status==="DONE")
                       .reduce((sum, t) => sum + (t.storyPoints||0), 0);
    const score     = committed > 0 ? Math.round((done/committed)*100) : 0;
    return { name: s.name, committed, done, score };
  });

  const avg = scores.length > 0
    ? Math.round(scores.reduce((s,d) => s+d.score, 0) / scores.length)
    : 0;

  const avgColor = avg >= 80 ? "var(--success)" : avg >= 60 ? "var(--warning)" : "var(--danger)";
  const label    = avg >= 80 ? "Highly Predictable" : avg >= 60 ? "Moderately Predictable" : "Needs Improvement";

  return (
    <div className="sprint-predict-card">
      <div className="sprint-chart-title">🎯 Sprint Predictability</div>
      <div className="sprint-predict-score" style={{ color: avgColor }}>
        {avg}%
        <span className="sprint-predict-label">{label}</span>
      </div>
      <div className="sprint-predict-table">
        {scores.map((s,i) => (
          <div key={i} className="sprint-predict-row">
            <span className="sprint-predict-name">{s.name}</span>
            <div className="sprint-predict-bar-track">
              <div className="sprint-predict-bar"
                style={{ width:`${s.score}%`,
                  background: s.score>=80?"var(--success)":s.score>=60?"var(--warning)":"var(--danger)" }} />
            </div>
            <span className="sprint-predict-pct"
              style={{ color: s.score>=80?"var(--success)":s.score>=60?"var(--warning)":"var(--danger)" }}>
              {s.score}%
            </span>
          </div>
        ))}
      </div>
      <div className="sprint-predict-note">
        Predictability = completed pts ÷ committed pts per sprint. Target: ≥80%.
      </div>
    </div>
  );
}

// ── SAFe PI Planning Panel ────────────────────────────────────
function PIPanel({ sprints, allTasks }) {
  const [piName, setPiName] = useState("PI 2026.2");
  const [piGoals, setPiGoals] = useState([
    { id:"1", text:"Deliver user authentication module", confidence:"HIGH" },
    { id:"2", text:"Complete API integration layer", confidence:"MEDIUM" },
  ]);
  const [newGoal, setNewGoal] = useState("");

  const addGoal = () => {
    if (!newGoal.trim()) return;
    setPiGoals(g => [...g, { id:Date.now().toString(), text:newGoal, confidence:"MEDIUM" }]);
    setNewGoal("");
  };
  const setConf = (id, conf) =>
    setPiGoals(g => g.map(x => x.id===id ? {...x, confidence:conf} : x));
  const removeGoal = (id) => setPiGoals(g => g.filter(x => x.id!==id));

  const sprinting = sprints.filter(s => s.status !== "CANCELLED");
  const iterations = sprinting.slice(0, 6); // PI = 6 iterations (sprints)

  const CONF_COLOR = { HIGH:"var(--success)", MEDIUM:"var(--warning)", LOW:"var(--danger)" };

  return (
    <div className="pi-panel">
      <div className="pi-header">
        <div>
          <div className="pi-title">🏃 SAFe PI Planning — Program Increment</div>
          <div className="pi-subtitle">Agile Release Train (ART) planning board</div>
        </div>
        <input className="pi-name-input" value={piName}
          onChange={e => setPiName(e.target.value)} />
      </div>

      {/* PI Objectives */}
      <div className="pi-section-label">PI Objectives</div>
      {piGoals.map(g => (
        <div key={g.id} className="pi-goal-row">
          <span className="pi-goal-text">{g.text}</span>
          <select className="pi-conf-select"
            value={g.confidence}
            onChange={e => setConf(g.id, e.target.value)}
            style={{ color: CONF_COLOR[g.confidence] }}>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
          <button className="btn-icon" onClick={() => removeGoal(g.id)}>✕</button>
        </div>
      ))}
      <div className="pi-add-row">
        <input value={newGoal} onChange={e => setNewGoal(e.target.value)}
          placeholder="Add PI objective…" onKeyDown={e => e.key==="Enter" && addGoal()} />
        <button className="btn-primary" style={{ fontSize:"11px" }} onClick={addGoal}>Add</button>
      </div>

      {/* Iteration overview */}
      <div className="pi-section-label" style={{ marginTop:"16px" }}>
        Iterations ({iterations.length})
      </div>
      <div className="pi-iterations">
        {iterations.map((s,i) => {
          const tasks = allTasks.filter(t => (s.taskIds||[]).includes(t.id));
          const pts   = tasks.reduce((sum,t) => sum+(t.storyPoints||0), 0);
          const done  = tasks.filter(t=>t.status==="DONE").reduce((sum,t)=>sum+(t.storyPoints||0),0);
          return (
            <div key={s.id} className="pi-iteration">
              <div className="pi-iter-num">I{i+1}</div>
              <div className="pi-iter-name">{s.name}</div>
              <div className="pi-iter-pts">{done}/{pts} pts</div>
              <div className="pi-iter-bar">
                <div className="pi-iter-fill"
                  style={{ width:`${pts>0?Math.round((done/pts)*100):0}%` }} />
              </div>
            </div>
          );
        })}
        {iterations.length === 0 && (
          <div className="sprint-chart-empty">
            Create sprints to populate the PI iteration view.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Backlog Grooming Panel ────────────────────────────────────
function GroomingPanel({ sprint, allTasks, onRefresh }) {
  const backlog = allTasks.filter(t =>
    !(sprint.taskIds||[]).includes(t.id) &&
    t.status !== "DONE"
  );
  const [selected, setSelected] = useState([]);
  const [estimate, setEstimate] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [saving,   setSaving]   = useState(false);
  const { show: toast } = useToast();

  const toggle  = (id) => setSelected(s => s.includes(id) ? s.filter(x=>x!==id) : [...s,id]);
  const selAll  = () => setSelected(backlog.map(t=>t.id));
  const selNone = () => setSelected([]);

  const applyEstimate = async () => {
    if (!estimate || selected.length === 0) return;
    setSaving(true);
    try {
      await Promise.all(selected.map(id =>
        import("../api/tasks").then(m =>
          m.updateTask(id, { storyPoints: Number(estimate), priority })
        )
      ));
      setSelected([]);
      setEstimate("");
      onRefresh();
    } catch {
      toast("Failed to apply estimate", "error");
    } finally { setSaving(false); }
  };

  const FIB = [1, 2, 3, 5, 8, 13, 21];

  return (
    <div className="grooming-panel">
      <div className="grooming-header">
        <div className="sprint-section-label">🧹 Backlog Grooming ({backlog.length} items)</div>
        <div style={{ display:"flex", gap:"6px", alignItems:"center", flexWrap:"wrap" }}>
          <button className="btn-secondary" style={{ fontSize:"11px" }} onClick={selAll}>Select All</button>
          <button className="btn-secondary" style={{ fontSize:"11px" }} onClick={selNone}>Clear</button>
          {selected.length > 0 && (
            <span className="grooming-selected-badge">{selected.length} selected</span>
          )}
        </div>
      </div>

      {selected.length > 0 && (
        <div className="grooming-bulk-bar">
          <span className="grooming-bulk-label">Bulk estimate:</span>
          <div className="grooming-fib-row">
            {FIB.map(n => (
              <button key={n}
                className={`grooming-fib-btn${estimate===String(n)?" active":""}`}
                onClick={() => setEstimate(String(n))}>{n}</button>
            ))}
          </div>
          <select className="grooming-priority-select" value={priority}
            onChange={e => setPriority(e.target.value)}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
          <button className="btn-primary" style={{ fontSize:"11px" }}
            disabled={saving || !estimate} onClick={applyEstimate}>
            {saving ? "Saving…" : `Apply to ${selected.length} task${selected.length>1?"s":""}`}
          </button>
        </div>
      )}

      <div className="grooming-task-list">
        {backlog.slice(0,30).map(t => (
          <label key={t.id} className={`grooming-task-row${selected.includes(t.id)?" selected":""}`}>
            <input type="checkbox" checked={selected.includes(t.id)}
              onChange={() => toggle(t.id)} />
            <span className="grooming-task-title">{t.title}</span>
            <span className={`grooming-priority grooming-priority-${t.priority?.toLowerCase()||"medium"}`}>
              {t.priority || "MEDIUM"}
            </span>
            <span className="grooming-pts">
              {t.storyPoints ? `${t.storyPoints} pt` : "—"}
            </span>
          </label>
        ))}
        {backlog.length === 0 && (
          <div className="sprint-chart-empty">No backlog tasks to groom.</div>
        )}
      </div>
    </div>
  );
}

// ── Burndown Chart (C-2) ────────────────────────────────────────
function BurndownChart({ sprintId }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBurndown(sprintId)
      .then(r => setData(unwrapList(r)))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [sprintId]);

  if (loading) return <div className="sprint-loading">Loading burndown…</div>;
  if (!data.length) return <div className="sprint-empty">No burndown data. Set sprint dates and add tasks.</div>;

  return (
    <div className="sprint-burndown">
      <div className="sprint-section-label">🔥 Burndown Chart</div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top:8, right:16, left:0, bottom:0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="day" tick={{ fontSize:11 }}
            tickFormatter={v => v?.slice(5)} />
          <YAxis tick={{ fontSize:11 }} />
          <Tooltip formatter={(v, n) => [v + " pts", n === "remaining" ? "Actual" : "Ideal"]} />
          <Legend />
          <Line type="monotone" dataKey="remaining" stroke="var(--brand-500)" strokeWidth={2}
            dot={false} name="Actual" />
          <Line type="monotone" dataKey="ideal" stroke="var(--gray-400)" strokeWidth={1.5}
            strokeDasharray="5 5" dot={false} name="Ideal" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Retrospective Panel (C-3) ────────────────────────────────────
function RetroPanel({ sprint, onSaved }) {
  const existing = sprint.retrospective;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    wentWell:     existing?.wentWell?.join("\n")     || "",
    improvements: existing?.improvements?.join("\n") || "",
    actionItems:  existing?.actionItems?.join("\n")  || "",
    mood:         existing?.mood || "NEUTRAL",
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveRetro(sprint.id, {
        wentWell:     form.wentWell.split("\n").map(s=>s.trim()).filter(Boolean),
        improvements: form.improvements.split("\n").map(s=>s.trim()).filter(Boolean),
        actionItems:  form.actionItems.split("\n").map(s=>s.trim()).filter(Boolean),
        mood:         form.mood,
      });
      setOpen(false);
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div className="sprint-retro">
      <div className="sprint-retro-header">
        <span className="sprint-section-label">🔄 Retrospective</span>
        <button className="btn-secondary" style={{ fontSize:"11px", padding:"4px 10px" }}
          onClick={() => setOpen(v => !v)}>
          {open ? "✕ Close" : existing ? "✎ Edit" : "+ Add Retro"}
        </button>
      </div>

      {/* Show existing retro summary */}
      {existing && !open && (
        <div className="sprint-retro-summary">
          <div className="sprint-retro-mood">
            {MOOD_META[existing.mood]?.icon} {MOOD_META[existing.mood]?.label}
          </div>
          {existing.wentWell?.length > 0 && (
            <div className="sprint-retro-section">
              <div className="sprint-retro-section-title">✅ Went Well</div>
              {existing.wentWell.map((item, i) => (
                <div key={i} className="sprint-retro-item">{item}</div>
              ))}
            </div>
          )}
          {existing.improvements?.length > 0 && (
            <div className="sprint-retro-section">
              <div className="sprint-retro-section-title">📈 To Improve</div>
              {existing.improvements.map((item, i) => (
                <div key={i} className="sprint-retro-item">{item}</div>
              ))}
            </div>
          )}
          {existing.actionItems?.length > 0 && (
            <div className="sprint-retro-section">
              <div className="sprint-retro-section-title">⚡ Action Items</div>
              {existing.actionItems.map((item, i) => (
                <div key={i} className="sprint-retro-item sprint-retro-action">{item}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="sprint-retro-form">
          <div className="form-group">
            <span id="sprints-mood-label" className="field-label">Team Mood</span>
            <div className="sprint-mood-row" role="radiogroup" aria-labelledby="sprints-mood-label">
              {Object.entries(MOOD_META).map(([k, v]) => (
                <button key={k}
                  className={`sprint-mood-btn${form.mood === k ? " active" : ""}`}
                  role="radio" aria-checked={form.mood===k}
                  onClick={() => setForm(f => ({...f, mood: k}))}>
                  {v.icon} {v.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label htmlFor={"sprints-what-went-well"}>✅ What went well? <span style={{color:"var(--gray-400)",fontSize:"11px"}}>(one per line)</span></label>
            <textarea rows={3} value={form.wentWell}
              onChange={e => setForm(f => ({...f, wentWell: e.target.value}))}
              placeholder="Delivered all planned features&#10;Great team collaboration&#10;…" id={"sprints-what-went-well"} />
          </div>
          <div className="form-group">
            <label htmlFor={"sprints-what-to-improve"}>📈 What to improve?</label>
            <textarea rows={3} value={form.improvements}
              onChange={e => setForm(f => ({...f, improvements: e.target.value}))}
              placeholder="Better estimation&#10;Daily standups&#10;…" id={"sprints-what-to-improve"} />
          </div>
          <div className="form-group">
            <label htmlFor={"sprints-action-items"}>⚡ Action items</label>
            <textarea rows={3} value={form.actionItems}
              onChange={e => setForm(f => ({...f, actionItems: e.target.value}))}
              placeholder="Set up CI/CD pipeline&#10;Schedule design reviews&#10;…" id={"sprints-action-items"} />
          </div>
          <div className="form-actions">
            <button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? "Saving…" : "Save Retrospective"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sprint Card ────────────────────────────────────────────────
function SprintGoalsPanel({ sprint, onRefresh }) {
  const [milestones, setMilestones] = React.useState(sprint.goalMilestones || []);
  const [newMs, setNewMs] = React.useState("");
  const { show:toast } = useToast();

  const save = async (updated) => {
    await client.put(`/sprints/${sprint.id}`, { ...sprint, goalMilestones: updated });
    onRefresh();
  };

  const add = () => {
    if (!newMs.trim()) return;
    const ms = { id: Date.now().toString(), milestone: newMs.trim(), achieved: false };
    const updated = [...milestones, ms];
    setMilestones(updated); setNewMs("");
    save(updated); toast("Milestone added","success");
  };

  const toggle = (id) => {
    const updated = milestones.map(m => m.id===id ? {...m, achieved:!m.achieved} : m);
    setMilestones(updated); save(updated);
  };

  const remove = (id) => {
    const updated = milestones.filter(m => m.id!==id);
    setMilestones(updated); save(updated);
  };

  const achieved = milestones.filter(m=>m.achieved).length;

  return (
    <div className="sprint-goals-panel">
      <div className="sprint-goals-header">
        <div className="sprint-goals-title">🎯 Sprint Goal Milestones</div>
        {milestones.length > 0 && (
          <div className="sprint-goals-pct">
            {achieved}/{milestones.length} achieved
            <div className="sprint-progress-bar" style={{width:120,marginLeft:10}}>
              <div className="sprint-progress-fill"
                style={{width:`${Math.round(achieved/milestones.length*100)}%`,background:"var(--success)"}} />
            </div>
          </div>
        )}
      </div>

      {milestones.map(m => (
        <div key={m.id} className="sprint-goal-ms-row">
          <button className={`sprint-goal-ms-check${m.achieved?" done":""}`}
            onClick={()=>toggle(m.id)}>
            {m.achieved ? "✅" : "⬜"}
          </button>
          <span className={`sprint-goal-ms-text${m.achieved?" done-text":""}`}>
            {m.milestone}
          </span>
          <button className="btn-icon" onClick={()=>remove(m.id)}>✕</button>
        </div>
      ))}

      <div className="form-row" style={{marginTop:10,gap:8}}>
        <input style={{flex:1}} value={newMs} onChange={e=>setNewMs(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&add()}
          placeholder="Add milestone (e.g. Complete auth module)" />
        <button className="btn-primary" style={{fontSize:"12px"}} onClick={add}>+ Add</button>
      </div>
    </div>
  );
}

function SprintCard({ sprint, allTasks, onEdit, onDelete, onRefresh }) {
  const [activePanel, setActivePanel] = useState(null);
  const toggle = (p) => setActivePanel(v => v === p ? null : p);
  const meta = STATUS_META[sprint.status] || STATUS_META.PLANNING;

  const sprintTaskIds = sprint.taskIds || [];
  const sprintTasks   = allTasks.filter(t => sprintTaskIds.includes(t.id));
  const totalPts      = sprintTasks.reduce((s, t) => s + (t.storyPoints || 0), 0);
  const donePts       = sprintTasks.filter(t => t.status === "DONE").reduce((s, t) => s + (t.storyPoints || 0), 0);
  const pct           = totalPts > 0 ? Math.round((donePts / totalPts) * 100) : 0;

  const handleAddTask = async (sprintId, taskId) => {
    await addTaskToSprint(sprintId, taskId);
    onRefresh();
  };
  const handleRemoveTask = async (sprintId, taskId) => {
    await removeTaskFromSprint(sprintId, taskId);
    onRefresh();
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString([], { day:"numeric", month:"short", year:"numeric" }) : "—";

  const daysLeft = sprint.endDate
    ? Math.ceil((new Date(sprint.endDate) - new Date()) / 86400000)
    : null;

  return (
    <div className="sprint-card">
      {/* Header */}
      <div className="sprint-card-header">
        <div className="sprint-card-top">
          <h3 className="sprint-card-title">{sprint.name}</h3>
          <span className="sprint-status-chip" style={{ background:meta.bg, color:meta.color }}>
            {meta.label}
          </span>
        </div>
        {sprint.goal && <div className="sprint-goal-text">🎯 {sprint.goal}</div>}
        <div className="sprint-dates">
          📅 {formatDate(sprint.startDate)} → {formatDate(sprint.endDate)}
          {daysLeft !== null && sprint.status === "ACTIVE" && (
            <span className={`sprint-days-left${daysLeft < 3 ? " urgent" : ""}`}>
              {daysLeft > 0 ? `${daysLeft}d left` : "Overdue"}
            </span>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="sprint-progress-section">
        <div className="sprint-progress-label">
          <span>{sprintTasks.length} tasks · {donePts}/{totalPts} pts</span>
          <span style={{ fontWeight:700, color: pct===100?"var(--success)":"var(--gray-600)" }}>{pct}%</span>
        </div>
        <div className="sprint-progress-bar">
          <div className="sprint-progress-fill" style={{ width:`${pct}%`, background:pct===100?"var(--success)":"var(--brand-500)" }} />
        </div>
      </div>

      {/* Action buttons */}
      <div className="sprint-card-actions">
        <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
          <button className={`btn-secondary${activePanel==="backlog"?" btn-active":""}`}
            style={{ fontSize:"12px", padding:"5px 10px" }} onClick={() => toggle("backlog")}>
            📋 Backlog ({sprintTasks.length})
          </button>
          <button className={`btn-secondary${activePanel==="burndown"?" btn-active":""}`}
            style={{ fontSize:"12px", padding:"5px 10px" }} onClick={() => toggle("burndown")}>
            🔥 Burndown
          </button>
          <button className={`btn-secondary${activePanel==="retro"?" btn-active":""}`}
            style={{ fontSize:"12px", padding:"5px 10px" }} onClick={() => toggle("retro")}>
            🔄 Retro {sprint.retrospective ? "✓" : ""}
          </button>
          <button className={`btn-secondary${activePanel==="burnup"?" btn-active":""}`}
            style={{ fontSize:"12px", padding:"5px 10px" }} onClick={() => toggle("burnup")}>
            📈 Burnup
          </button>
          <button className={`btn-secondary${activePanel==="grooming"?" btn-active":""}`}
            style={{ fontSize:"12px", padding:"5px 10px" }} onClick={() => toggle("grooming")}>
            🧹 Grooming
          </button>
          {sprint.status === "PLANNING" && (
            <button className="btn-primary" style={{ fontSize:"12px", padding:"5px 10px" }}
              onClick={() => { updateSprint(sprint.id, { status:"ACTIVE" }); onRefresh(); }}>
              ▶ Start Sprint
            </button>
          )}
          {sprint.status === "ACTIVE" && (
            <button className="btn-secondary" style={{ fontSize:"12px", padding:"5px 10px" }}
              onClick={() => { updateSprint(sprint.id, { status:"COMPLETED" }); onRefresh(); }}>
              ✓ Complete
            </button>
          )}
        </div>
        <div style={{ display:"flex", gap:"4px" }}>
          <button className="btn-icon" onClick={() => onEdit(sprint)}>✏️</button>
          <button className="btn-icon" onClick={() => onDelete(sprint.id)}>🗑️</button>
        </div>
      </div>

      {/* Panels */}
      {activePanel === "backlog" && (
        <BacklogPanel sprint={sprint} allTasks={allTasks}
          onTaskAdded={handleAddTask} onTaskRemoved={handleRemoveTask} />
      )}
      {activePanel === "burndown"  && <BurndownChart sprintId={sprint.id} />}
      {activePanel === "burnup"    && <BurnupChart sprint={sprint} allTasks={allTasks} />}
      {activePanel === "grooming"  && <GroomingPanel sprint={sprint} allTasks={allTasks} onRefresh={onRefresh} />}
      {activePanel === "retro"     && <RetroPanel sprint={sprint} onSaved={onRefresh} />}
      {activePanel === "goals"    && <SprintGoalsPanel sprint={sprint} onRefresh={onRefresh} />}
    </div>
  );
}

// ── Main Sprints Page ─────────────────────────────────────────
export default function Sprints() {
  const [sprints, setSprints]   = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [pageTab, setPageTab] = useState("sprints");
  const { show: showToast } = useToast();
  const confirm = useConfirm();

  const load = async () => {
    const [sr, tr] = await Promise.all([getSprints(), getTasks()]);
    setSprints(unwrapList(sr));
    setAllTasks(unwrapList(tr) || []);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern
    load();
  }, []);

  const handleSave = async (form) => {
    const payload = {
      ...form,
      startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
      endDate:   form.endDate   ? new Date(form.endDate).toISOString()   : null,
    };
    if (editing) await updateSprint(editing.id, payload);
    else         await createSprint(payload);
    setShowForm(false);
    setEditing(null);
    load();
    showToast(editing ? "Sprint updated" : "Sprint created", "success");
  };

  const handleDelete = async (id) => {
    const ok = await confirm({ title:"Delete sprint?", message:"This removes the sprint but keeps the tasks.", danger:true });
    if (!ok) return;
    await deleteSprint(id);
    load();
    showToast("Sprint deleted", "success");
  };

  const filtered = statusFilter
    ? sprints.filter(s => s.status === statusFilter)
    : sprints;

  const activeSprint  = sprints.find(s => s.status === "ACTIVE");
  const totalVelocity = sprints
    .filter(s => s.status === "COMPLETED")
    .slice(-3)
    .reduce((sum, s) => {
      const pts = allTasks
        .filter(t => s.taskIds?.includes(t.id) && t.status === "DONE")
        .reduce((s, t) => s + (t.storyPoints || 0), 0);
      return sum + pts;
    }, 0);

  return (
    <div>
      <PageHeader
        icon="🏃"
        title="Sprints"
        description="Plan, run, and review agile sprints"
        action={
          <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
            {activeSprint && (
              <span style={{ fontSize:"12px", fontWeight:600, color:"var(--success)",
                background:"rgba(5,150,105,0.12)", padding:"4px 10px", borderRadius:"99px" }}>
                ● Active: {activeSprint.name}
              </span>
            )}
            <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
              + New Sprint
            </button>
          </div>
        }
      />

      {/* Summary bar */}
      <div className="sprint-summary-bar">
        <div className="sprint-summary-stat">
          <div className="sprint-summary-num">{sprints.length}</div>
          <div className="sprint-summary-label">Total Sprints</div>
        </div>
        <div className="sprint-summary-stat">
          <div className="sprint-summary-num" style={{ color:"var(--success)" }}>
            {sprints.filter(s=>s.status==="ACTIVE").length}
          </div>
          <div className="sprint-summary-label">Active</div>
        </div>
        <div className="sprint-summary-stat">
          <div className="sprint-summary-num" style={{ color:"#06b6d4" }}>
            {sprints.filter(s=>s.status==="COMPLETED").length}
          </div>
          <div className="sprint-summary-label">Completed</div>
        </div>
        <div className="sprint-summary-stat">
          <div className="sprint-summary-num" style={{ color:"var(--brand-500)" }}>
            {totalVelocity}
          </div>
          <div className="sprint-summary-label">Avg Velocity (last 3)</div>
        </div>
      </div>

      {/* Status filter */}
      <div className="sprint-filter-bar">
        {["", "PLANNING", "ACTIVE", "COMPLETED", "CANCELLED"].map(s => (
          <button key={s}
            className={`sprint-filter-btn${statusFilter === s ? " active" : ""}`}
            onClick={() => setStatusFilter(s)}>
            {s ? STATUS_META[s]?.label : "All"}
          </button>
        ))}
      </div>

      {/* Sprints page tabs */}
      <div className="sprint-page-tabs">
        {[
          { key:"sprints",        label:"🏃 Sprints"        },
          { key:"velocity",       label:"📈 Velocity"       },
          { key:"predictability", label:"🎯 Predictability" },
          { key:"pi",             label:"🏃 SAFe / PI"      },
        ].map(t => (
          <button key={t.key}
            className={`sprint-filter-btn${pageTab===t.key?" active":""}`}
            onClick={() => setPageTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {pageTab === "velocity"       && <VelocityChart sprints={sprints} tasks={allTasks} />}
      {pageTab === "predictability" && <PredictabilityPanel sprints={sprints} allTasks={allTasks} />}
      {pageTab === "pi"             && <PIPanel sprints={sprints} allTasks={allTasks} />}

      {/* Sprint cards */}
      {pageTab === "sprints" && <div className="sprint-cards-grid">
        {filtered.map(sprint => (
          <SprintCard
            key={sprint.id}
            sprint={sprint}
            allTasks={allTasks}
            onEdit={(s) => { setEditing(s); setShowForm(true); }}
            onDelete={handleDelete}
            onRefresh={load}
          />
        ))}
        {filtered.length === 0 && (
          <div className="empty-state">
            No sprints yet. Create your first sprint to start planning!
          </div>
        )}
      </div>}

      {showForm && (
        <SprintForm
          initial={editing}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}