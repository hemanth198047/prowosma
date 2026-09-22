import { unwrapList } from "../api/client";
import { useState, useEffect } from "react";
import PageHeader from "../components/PageHeader";
import client from "../api/client";
import { getTasks } from "../api/tasks";
import { getProjects } from "../api/projects";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";

const api = {
  list:   (pid) => client.get(`/epics${pid?`?projectId=${pid}`:""}`),
  create: (d)   => client.post("/epics", d),
  update: (id,d)=> client.put(`/epics/${id}`, d),
  delete: (id)  => client.delete(`/epics/${id}`),
};

const STATUS_META = {
  OPEN:        { color:"#3b82f6", label:"Open"        },
  IN_PROGRESS: { color:"var(--warning)", label:"In Progress" },
  DONE:        { color:"var(--success)", label:"Done"        },
  CANCELLED:   { color:"var(--gray-500)", label:"Cancelled"   },
};

function EpicForm({ initial, projects, onSave, onClose }) {
  const [form, setForm] = useState(initial || {
    name:"", description:"", projectId:"", color:"var(--brand-500)",
    status:"OPEN", priority:"MEDIUM", startDate:"", targetDate:"",
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (e=>e.target===e.currentTarget&&onClose())?.(e); } }}>
      <div className="modal" style={{maxWidth:520}}>
        <h2>{initial?.id ? "Edit Epic" : "Create Epic"}</h2>
        <div className="form-row">
          <div className="form-group" style={{flex:2}}>
            <label htmlFor={"epics-name"}>Name *</label>
            <input value={form.name} onChange={e=>set("name",e.target.value)}
              placeholder="e.g. User Authentication System" id={"epics-name"} />
          </div>
          <div className="form-group">
            <label htmlFor={"epics-color"}>Color</label>
            <input type="color" value={form.color} onChange={e=>set("color",e.target.value)}
              style={{height:"36px",padding:"2px"}} id={"epics-color"} />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor={"epics-description"}>Description</label>
          <textarea rows={2} value={form.description}
            onChange={e=>set("description",e.target.value)}
            placeholder="What does this epic deliver?" id={"epics-description"} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"epics-project"}>Project</label>
            <select value={form.projectId} onChange={e=>set("projectId",e.target.value)} id={"epics-project"}>
              <option value="">No project</option>
              {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor={"epics-status"}>Status</label>
            <select value={form.status} onChange={e=>set("status",e.target.value)} id={"epics-status"}>
              {Object.entries(STATUS_META).map(([v,m])=>(
                <option key={v} value={v}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor={"epics-priority"}>Priority</label>
            <select value={form.priority} onChange={e=>set("priority",e.target.value)} id={"epics-priority"}>
              {["LOW","MEDIUM","HIGH","CRITICAL"].map(p=><option key={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"epics-start-date"}>Start Date</label>
            <input type="date" value={form.startDate?.slice?.(0,10)||""}
              onChange={e=>set("startDate",e.target.value)} id={"epics-start-date"} />
          </div>
          <div className="form-group">
            <label htmlFor={"epics-target-date"}>Target Date</label>
            <input type="date" value={form.targetDate?.slice?.(0,10)||""}
              onChange={e=>set("targetDate",e.target.value)} id={"epics-target-date"} />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!form.name} onClick={()=>onSave(form)}>
            {initial?.id ? "Update" : "Create"} Epic
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Epics() {
  const [epics,    setEpics]    = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks,    setTasks]    = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing,  setEditing]  = useState(null);
  const [filter,   setFilter]   = useState("");
  const { show:toast } = useToast();
  const confirm = useConfirm();

  const load = () => api.list().then(r=>setEpics(unwrapList(r))).catch(()=>{});

  useEffect(()=>{
    load();
    getProjects().then(r=>setProjects(unwrapList(r))).catch(()=>{});
    getTasks().then(r=>setTasks(unwrapList(r))).catch(()=>{});
  },[]);

  const handleSave = async (form) => {
    if (editing?.id) await api.update(editing.id, form);
    else             await api.create(form);
    setShowForm(false); setEditing(null);
    load(); toast(editing ? "Epic updated" : "Epic created","success");
  };

  const handleDelete = async (id) => {
    const ok = await confirm({title:"Delete this epic?",danger:true});
    if (!ok) return;
    await api.delete(id); load(); toast("Deleted","success");
  };

  const filtered = filter ? epics.filter(e=>e.status===filter) : epics;
  const totalPoints = epics.reduce((a,e)=>a+(e.totalPoints||0),0);
  const donePoints  = epics.reduce((a,e)=>a+(e.completedPoints||0),0);

  return (
    <div>
      <PageHeader icon="⚡" title="Epics"
        description="Group related user stories and track delivery of major features"
        action={<button className="btn-primary" onClick={()=>{setEditing(null);setShowForm(true);}}>
          + Create Epic
        </button>} />

      {/* Summary */}
      <div className="kpi-summary-bar" style={{marginBottom:"14px"}}>
        {[
          {label:"Total Epics",   value:epics.length,                      color:"var(--gray-700)"},
          {label:"In Progress",   value:epics.filter(e=>e.status==="IN_PROGRESS").length, color:"var(--warning)"},
          {label:"Done",          value:epics.filter(e=>e.status==="DONE").length,        color:"var(--success)"},
          {label:"Story Points",  value:`${donePoints}/${totalPoints}`,    color:"var(--brand-500)"},
        ].map(s=>(
          <div key={s.label} className="kpi-summary-stat">
            <div className="kpi-summary-num" style={{color:s.color}}>{s.value}</div>
            <div className="kpi-summary-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="intg-filter-bar">
        {["","OPEN","IN_PROGRESS","DONE","CANCELLED"].map(f=>(
          <button key={f} className={`sprint-filter-btn${filter===f?" active":""}`}
            onClick={()=>setFilter(f)}>{f||"All"}</button>
        ))}
      </div>

      {/* Epic cards grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:"12px"}}>
        {filtered.map(epic=>{
          const sm = STATUS_META[epic.status] || STATUS_META.OPEN;
          const pct = epic.totalPoints > 0
            ? Math.round((epic.completedPoints/epic.totalPoints)*100) : 0;
          const epicTasks = tasks.filter(t=>t.epicId===epic.id || (epic.taskIds||[]).includes(t.id));
          const doneTasks = epicTasks.filter(t=>t.status==="DONE").length;
          return (
            <div key={epic.id} style={{background:"var(--bg-card)",border:`2px solid ${epic.color||"var(--brand-500)"}22`,
              borderRadius:"var(--radius-lg)",padding:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"10px"}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"4px"}}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:epic.color||"var(--brand-500)",flexShrink:0}}/>
                    <div style={{fontWeight:800,fontSize:"14px",color:"var(--gray-800)"}}>{epic.name}</div>
                  </div>
                  {epic.description && (
                    <div style={{fontSize:"12px",color:"var(--gray-500)",marginLeft:"18px"}}>{epic.description}</div>
                  )}
                </div>
                <div style={{display:"flex",gap:"4px",flexShrink:0}}>
                  <button className="btn-icon" onClick={()=>{setEditing(epic);setShowForm(true);}}>✏️</button>
                  <button className="btn-icon" onClick={()=>handleDelete(epic.id)}>🗑️</button>
                </div>
              </div>

              {/* Progress bar */}
              <div style={{marginBottom:"10px"}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:"11px",
                  color:"var(--gray-400)",marginBottom:"4px"}}>
                  <span>{pct}% complete</span>
                  <span>{epic.completedPoints||0}/{epic.totalPoints||0} pts</span>
                </div>
                <div className="kpi-progress-bar">
                  <div className="kpi-progress-fill"
                    style={{width:`${pct}%`,background:epic.color||"var(--brand-500)"}} />
                </div>
              </div>

              {/* Meta row */}
              <div style={{display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center"}}>
                <span style={{fontSize:"10px",fontWeight:700,padding:"2px 8px",borderRadius:"99px",
                  background:`${sm.color}18`,color:sm.color}}>{sm.label}</span>
                <span style={{fontSize:"11px",color:"var(--gray-400)"}}>
                  {doneTasks}/{epicTasks.length} tasks
                </span>
                {epic.targetDate && (
                  <span style={{fontSize:"11px",color:"var(--gray-400)"}}>
                    🎯 {new Date(epic.targetDate).toLocaleDateString()}
                  </span>
                )}
                {epic.priority && epic.priority!=="MEDIUM" && (
                  <span style={{fontSize:"9px",fontWeight:700,
                    color:epic.priority==="HIGH"||epic.priority==="CRITICAL"?"var(--danger)":"var(--warning)"}}>
                    {epic.priority}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length===0 && (
          <div className="empty-state" style={{gridColumn:"1/-1"}}>
            No epics yet. Create your first epic to group related user stories.
          </div>
        )}
      </div>

      {showForm && (
        <EpicForm initial={editing} projects={projects}
          onSave={handleSave} onClose={()=>{setShowForm(false);setEditing(null);}} />
      )}
    </div>
  );
}
