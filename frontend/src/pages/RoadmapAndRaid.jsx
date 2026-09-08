import { unwrapList } from "../api/client";
import { useState, useEffect, useCallback } from "react";
import PageHeader from "../components/PageHeader";
import client from "../api/client";
import { getProjects } from "../api/projects";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";

const getRaid        = (projectId) => client.get("/raid", { params: projectId ? { projectId } : {} });
const createRaid     = (data)      => client.post("/raid", data);
const updateRaid     = (id, data)  => client.put(`/raid/${id}`, data);
const deleteRaid     = (id)        => client.delete(`/raid/${id}`);
const addExpense     = (id, data)  => client.post(`/projects/${id}/expenses`, data);
const deleteExpense  = (id, eid)   => client.delete(`/projects/${id}/expenses/${eid}`);
const updateBudget   = (id, data)  => client.patch(`/projects/${id}/budget`, data);

const TYPE_META = {
  RISK:       { label:"Risk",       icon:"⚠️", color:"#ef4444", bg:"rgba(239,68,68,0.1)" },
  ASSUMPTION: { label:"Assumption", icon:"💭", color:"#6366f1", bg:"rgba(99,102,241,0.1)" },
  ISSUE:      { label:"Issue",      icon:"🔥", color:"#f59e0b", bg:"rgba(245,158,11,0.1)" },
  DEPENDENCY: { label:"Dependency", icon:"🔗", color:"#10b981", bg:"rgba(16,185,129,0.1)" },
};
const STATUS_COLORS = {
  OPEN:"#ef4444", IN_PROGRESS:"#f59e0b", CLOSED:"#6b7280", MITIGATED:"#10b981"
};
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Budget Panel ──────────────────────────────────────────────
function BudgetPanel({ project, onRefresh }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ description:"", amount:"", category:"OTHER" });
  const [editBudget, setEditBudget] = useState(false);
  const [budgetVal, setBudgetVal]   = useState(project.budget || "");
  const { show: toast } = useToast();

  const spent    = project.spent || 0;
  const budget   = project.budget || 0;
  const burnPct  = budget > 0 ? Math.min(100, Math.round((spent/budget)*100)) : 0;
  const variance = budget - spent;
  const burnColor= burnPct >= 90 ? "#ef4444" : burnPct >= 70 ? "#f59e0b" : "#10b981";

  const handleAddExpense = async () => {
    if (!form.description || !form.amount) return;
    await addExpense(project.id, { ...form, amount: Number(form.amount) });
    setForm({ description:"", amount:"", category:"OTHER" });
    setShowForm(false);
    onRefresh();
    toast("Expense added", "success");
  };

  const handleUpdateBudget = async () => {
    await updateBudget(project.id, { budget: Number(budgetVal), currency: "USD" });
    setEditBudget(false);
    onRefresh();
    toast("Budget updated", "success");
  };

  return (
    <div className="raid-panel">
      <div className="raid-panel-title">💰 Budget Tracking — {project.name}</div>

      {/* Summary */}
      <div className="budget-summary">
        <div className="budget-stat">
          <div className="budget-stat-num">${budget.toLocaleString()}</div>
          <div className="budget-stat-label">Budget</div>
        </div>
        <div className="budget-stat">
          <div className="budget-stat-num" style={{ color:burnColor }}>${spent.toLocaleString()}</div>
          <div className="budget-stat-label">Spent</div>
        </div>
        <div className="budget-stat">
          <div className="budget-stat-num" style={{ color: variance >= 0 ? "#10b981" : "#ef4444" }}>
            {variance >= 0 ? "+" : ""}${variance.toLocaleString()}
          </div>
          <div className="budget-stat-label">Variance</div>
        </div>
        <div className="budget-stat">
          <div className="budget-stat-num" style={{ color:burnColor }}>{burnPct}%</div>
          <div className="budget-stat-label">Burn Rate</div>
        </div>
      </div>

      {/* Burn bar */}
      <div className="budget-burn-bar">
        <div className="budget-burn-fill" style={{ width:`${burnPct}%`, background:burnColor }} />
      </div>

      {/* Edit budget + add expense */}
      <div className="budget-actions">
        {editBudget ? (
          <div style={{ display:"flex", gap:"6px", alignItems:"center" }}>
            <input type="number" value={budgetVal}
              onChange={e => setBudgetVal(e.target.value)}
              style={{ width:"120px" }} placeholder="Budget amount" />
            <button className="btn-primary" style={{ fontSize:"11px" }} onClick={handleUpdateBudget}>Save</button>
            <button className="btn-secondary" style={{ fontSize:"11px" }} onClick={() => setEditBudget(false)}>Cancel</button>
          </div>
        ) : (
          <button className="btn-secondary" style={{ fontSize:"11px" }} onClick={() => setEditBudget(true)}>
            ✏️ {budget > 0 ? "Edit Budget" : "Set Budget"}
          </button>
        )}
        <button className="btn-primary" style={{ fontSize:"11px" }}
          onClick={() => setShowForm(v => !v)}>+ Add Expense</button>
      </div>

      {showForm && (
        <div className="budget-expense-form">
          <div className="form-row">
            <div className="form-group" style={{ flex:2 }}>
              <label htmlFor={"roadmap-and-raid-description"}>Description</label>
              <input value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))}
                placeholder="e.g. AWS hosting" id={"roadmap-and-raid-description"} />
            </div>
            <div className="form-group">
              <label htmlFor={"roadmap-and-raid-amount"}>Amount ($)</label>
              <input type="number" value={form.amount}
                onChange={e => setForm(f=>({...f,amount:e.target.value}))} placeholder="0" id={"roadmap-and-raid-amount"} />
            </div>
            <div className="form-group">
              <label htmlFor={"roadmap-and-raid-category"}>Category</label>
              <select value={form.category} onChange={e => setForm(f=>({...f,category:e.target.value}))} id={"roadmap-and-raid-category"}>
                <option value="PEOPLE">People</option>
                <option value="TOOLS">Tools</option>
                <option value="INFRASTRUCTURE">Infrastructure</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleAddExpense}>Add</button>
          </div>
        </div>
      )}

      {/* Expense list */}
      <div className="budget-expenses">
        {(project.expenses || []).map(e => (
          <div key={e.id} className="budget-expense-row">
            <span className="budget-expense-cat">{e.category}</span>
            <span className="budget-expense-desc">{e.description}</span>
            <span className="budget-expense-amount">${e.amount?.toLocaleString()}</span>
            <span className="budget-expense-date">
              {e.date ? new Date(e.date).toLocaleDateString() : "—"}
            </span>
            <button className="btn-icon" onClick={async () => {
              await deleteExpense(project.id, e.id); onRefresh();
            }}>🗑️</button>
          </div>
        ))}
        {(!project.expenses || project.expenses.length === 0) && (
          <div className="budget-empty">No expenses logged yet.</div>
        )}
      </div>
    </div>
  );
}

// ── RAID Panel ────────────────────────────────────────────────
function RaidPanel({ projectId }) {
  const [entries, setEntries] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [filter,   setFilter]   = useState("");
  const [editing,  setEditing]  = useState(null);
  const [form, setForm] = useState({
    type:"RISK", title:"", description:"", owner:"",
    impact:"MEDIUM", probability:"MEDIUM", status:"OPEN", mitigation:""
  });
  const { show: toast } = useToast();
  const confirm = useConfirm();

  const load = useCallback(() => getRaid(projectId).then(r => setEntries(unwrapList(r))).catch(()=>{}), [projectId]);
  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.title) return;
    const data = { ...form, projectId };
    if (editing) await updateRaid(editing.id, data);
    else         await createRaid(data);
    setShowForm(false); setEditing(null);
    setForm({ type:"RISK", title:"", description:"", owner:"",
      impact:"MEDIUM", probability:"MEDIUM", status:"OPEN", mitigation:"" });
    load();
    toast(editing ? "Entry updated" : "Entry created", "success");
  };

  const handleDelete = async (id) => {
    const ok = await confirm({ title:"Delete RAID entry?", danger:true });
    if (!ok) return;
    await deleteRaid(id); load(); toast("Deleted", "success");
  };

  const filtered = filter ? entries.filter(e => e.type === filter) : entries;

  const counts = Object.keys(TYPE_META).reduce((acc, t) => {
    acc[t] = entries.filter(e => e.type === t).length; return acc;
  }, {});

  return (
    <div className="raid-panel">
      <div className="raid-panel-header">
        <div className="raid-panel-title">📋 RAID Log</div>
        <div style={{ display:"flex", gap:"6px", alignItems:"center", flexWrap:"wrap" }}>
          {Object.entries(TYPE_META).map(([t,m]) => (
            <button key={t}
              className={`raid-type-filter${filter===t?" active":""}`}
              style={{ borderColor: filter===t ? m.color : undefined, color: filter===t ? m.color : undefined }}
              onClick={() => setFilter(f => f===t ? "" : t)}>
              {m.icon} {m.label} ({counts[t]||0})
            </button>
          ))}
          <button className="btn-primary" style={{ fontSize:"11px" }}
            onClick={() => { setEditing(null); setShowForm(true); }}>+ Add Entry</button>
        </div>
      </div>

      {showForm && (
        <div className="raid-form">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor={"roadmap-and-raid-type"}>Type</label>
              <select value={form.type} onChange={e => setForm(f=>({...f,type:e.target.value}))} id={"roadmap-and-raid-type"}>
                {Object.keys(TYPE_META).map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex:2 }}>
              <label htmlFor={"roadmap-and-raid-title"}>Title *</label>
              <input value={form.title} onChange={e => setForm(f=>({...f,title:e.target.value}))}
                placeholder="What is the risk/issue/assumption/dependency?" id={"roadmap-and-raid-title"} />
            </div>
            <div className="form-group">
              <label htmlFor={"roadmap-and-raid-owner"}>Owner</label>
              <input value={form.owner} onChange={e => setForm(f=>({...f,owner:e.target.value}))}
                placeholder="Person responsible" id={"roadmap-and-raid-owner"} />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor={"roadmap-and-raid-description-2"}>Description</label>
            <textarea rows={2} value={form.description}
              onChange={e => setForm(f=>({...f,description:e.target.value}))} id={"roadmap-and-raid-description-2"} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor={"roadmap-and-raid-impact"}>Impact</label>
              <select value={form.impact} onChange={e => setForm(f=>({...f,impact:e.target.value}))} id={"roadmap-and-raid-impact"}>
                <option>HIGH</option><option>MEDIUM</option><option>LOW</option>
              </select>
            </div>
            {form.type === "RISK" && (
              <div className="form-group">
                <label htmlFor={"roadmap-and-raid-probability"}>Probability</label>
                <select value={form.probability} onChange={e => setForm(f=>({...f,probability:e.target.value}))} id={"roadmap-and-raid-probability"}>
                  <option>HIGH</option><option>MEDIUM</option><option>LOW</option>
                </select>
              </div>
            )}
            <div className="form-group">
              <label htmlFor={"roadmap-and-raid-status"}>Status</label>
              <select value={form.status} onChange={e => setForm(f=>({...f,status:e.target.value}))} id={"roadmap-and-raid-status"}>
                <option>OPEN</option><option>IN_PROGRESS</option>
                <option>MITIGATED</option><option>CLOSED</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor={"roadmap-and-raid-mitigation-notes"}>Mitigation / Notes</label>
            <textarea rows={2} value={form.mitigation}
              onChange={e => setForm(f=>({...f,mitigation:e.target.value}))} id={"roadmap-and-raid-mitigation-notes"} />
          </div>
          <div className="form-actions">
            <button className="btn-secondary" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>
              {editing ? "Update" : "Add Entry"}
            </button>
          </div>
        </div>
      )}

      <div className="raid-table">
        <div className="raid-table-header">
          <span>Type</span><span>Title</span><span>Owner</span>
          <span>Impact</span><span>Status</span><span>Mitigation</span><span></span>
        </div>
        {filtered.map(e => {
          const tm = TYPE_META[e.type] || TYPE_META.RISK;
          return (
            <div key={e.id} className="raid-table-row">
              <span>
                <span className="raid-type-badge"
                  style={{ background:tm.bg, color:tm.color }}>{tm.icon} {tm.label}</span>
              </span>
              <div className="raid-entry-title">
                <div className="raid-title-text">{e.title}</div>
                {e.description && <div className="raid-title-desc">{e.description}</div>}
              </div>
              <span className="raid-owner">{e.owner || "—"}</span>
              <span>
                <span className="raid-impact-badge"
                  style={{ color: e.impact==="HIGH"?"#ef4444":e.impact==="MEDIUM"?"#f59e0b":"#10b981" }}>
                  {e.impact}
                </span>
              </span>
              <span>
                <span className="raid-status-badge"
                  style={{ color: STATUS_COLORS[e.status] || "#6b7280" }}>{e.status}</span>
              </span>
              <span className="raid-mitigation">{e.mitigation || "—"}</span>
              <span style={{ display:"flex", gap:"4px" }}>
                <button className="btn-icon" onClick={() => {
                  setEditing(e);
                  setForm({ type:e.type, title:e.title, description:e.description||"",
                    owner:e.owner||"", impact:e.impact||"MEDIUM",
                    probability:e.probability||"MEDIUM", status:e.status||"OPEN",
                    mitigation:e.mitigation||"" });
                  setShowForm(true);
                }}>✏️</button>
                <button className="btn-icon" onClick={() => handleDelete(e.id)}>🗑️</button>
              </span>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="raid-empty">
            No {filter ? TYPE_META[filter]?.label.toLowerCase() + " entries" : "RAID entries"} yet.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Roadmap View ──────────────────────────────────────────────
function RoadmapView({ projects }) {
  const safeProjects = Array.isArray(projects) ? projects : [];
  const now    = new Date();
  const year   = now.getFullYear();

  const getLeft  = (d) => { const dt = new Date(d); return (dt.getMonth()/12)*100; };
  const getWidth = (s, e) => {
    const sd = new Date(s), ed = new Date(e);
    const diff = (ed - sd) / (365*24*3600*1000);
    return Math.max(2, diff * 100);
  };

  const projWithDates = safeProjects.filter(p => p.createdAt);

  return (
    <div className="roadmap-wrap">
      <div className="roadmap-header-title">📅 Project Roadmap — {year}</div>

      {/* Month headers */}
      <div className="roadmap-months">
        {MONTHS.map(m => (
          <div key={m} className="roadmap-month">{m}</div>
        ))}
      </div>

      {/* Today line */}
      <div className="roadmap-today-wrap">
        <div className="roadmap-today-line"
          style={{ left:`${(now.getMonth()/12)*100}%` }}
          title={`Today: ${now.toLocaleDateString()}`} />
      </div>

      {/* Project bars */}
      <div className="roadmap-rows">
        {projWithDates.map(p => {
          const start = p.createdAt || new Date().toISOString();
          // eslint-disable-next-line react-hooks/purity -- fallback due-date, no visible drift on bar position
          const end   = p.dueDate   || new Date(Date.now() + 90*24*3600*1000).toISOString();
          const left  = getLeft(start);
          const width = getWidth(start, end);
          const color = p.status === "DONE" ? "#10b981"
            : p.status === "PAUSED" ? "#6b7280" : "#6366f1";
          return (
            <div key={p.id} className="roadmap-row">
              <div className="roadmap-row-label" title={p.name}>{p.name}</div>
              <div className="roadmap-row-track">
                <div className="roadmap-bar"
                  style={{ left:`${Math.min(90,left)}%`, width:`${Math.min(100-left, width)}%`,
                    background:color }}>
                  <span className="roadmap-bar-label">{p.name}</span>
                </div>
              </div>
            </div>
          );
        })}
        {projWithDates.length === 0 && (
          <div className="empty-state" style={{ padding:"24px" }}>
            No projects with dates found. Add due dates to projects to see them on the roadmap.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function RoadmapAndRaid() {
  const [tab,      setTab]      = useState("roadmap");
  const [projects, setProjects] = useState([]);
  const [selProject, setSelProject] = useState(null);
  const { show: toast } = useToast();

  const load = useCallback(() => getProjects().then(r => {
    const list = r.data || [];
    setProjects(list);
    setSelProject(prev => prev || (list.length > 0 ? list[0] : prev));
  }).catch(() => toast("Failed to load projects", "error")), [toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader icon="🗺️" title="Roadmap & RAID"
        description="Project roadmap timeline, budget tracking, and RAID log" />

      <div className="admin-tab-bar">
        {[["roadmap","📅 Roadmap"],["budget","💰 Budget"],["raid","📋 RAID Log"]].map(([t,l]) => (
          <button key={t} className={`admin-tab-btn${tab===t?" active":""}`}
            onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>

      {tab === "roadmap" && <RoadmapView projects={projects} />}

      {tab === "budget" && (
        <div>
          <div className="form-group" style={{ marginBottom:"16px", maxWidth:"300px" }}>
            <label htmlFor={"roadmap-and-raid-select-project"}>Select Project</label>
            <select value={selProject?.id || ""}
              onChange={e => setSelProject(projects.find(p => p.id === e.target.value))} id={"roadmap-and-raid-select-project"}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {selProject && <BudgetPanel project={selProject} onRefresh={load} />}
        </div>
      )}

      {tab === "raid" && (
        <div>
          <div className="form-group" style={{ marginBottom:"16px", maxWidth:"300px" }}>
            <label htmlFor={"roadmap-and-raid-filter-by-project-optional"}>Filter by Project (optional)</label>
            <select value={selProject?.id || ""}
              onChange={e => setSelProject(projects.find(p => p.id === e.target.value) || null)} id={"roadmap-and-raid-filter-by-project-optional"}>
              <option value="">All Projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <RaidPanel projectId={selProject?.id} />
        </div>
      )}
    </div>
  );
}