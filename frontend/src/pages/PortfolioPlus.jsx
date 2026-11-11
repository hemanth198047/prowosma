import client from "../api/client";
import { useState, useEffect } from "react";
import { unwrapList } from "../api/client";
import PageHeader from "../components/PageHeader";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import { getProjects } from "../api/projects";
import { getGoals }    from "../api/goals";
import "../styles/pages/analytics.css";
import {
  getReleases, createRelease, updateRelease, deleteRelease,
  getInitiatives, createInitiative, updateInitiative, deleteInitiative,
  getProgrammes, createProgramme, updateProgramme, deleteProgramme,
  addMilestone, toggleMilestone,
} from "../api/portfolio";
import { statusText } from "../utils/statusText";

// ─────────────────────────────────────────────────────────────
// RELEASE MANAGEMENT
// ─────────────────────────────────────────────────────────────
const REL_STATUS = {
  PLANNED:    { label:"Planned",     color:"var(--brand-500)", bg:"rgba(99,102,241,0.1)"  },
  IN_PROGRESS:{ label:"In Progress", color:"var(--warning)", bg:"rgba(245,158,11,0.1)"  },
  RELEASED:   { label:"Released",    color:"var(--success)", bg:"rgba(16,185,129,0.1)"  },
  CANCELLED:  { label:"Cancelled",   color:"var(--gray-500)", bg:"rgba(107,114,128,0.1)" },
};

function ReleaseForm({ initial, projects, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    version:"", name:"", description:"", projectId:"",
    status:"PLANNED", releaseDate:"", environment:"PRODUCTION",
    releaseNotes:"", owner:"",
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  return (
    <div className="modal-overlay"><div className="modal">
      <h2>{initial?.id ? "Edit Release" : "New Release"}</h2>
      <div className="form-row">
        <div className="form-group"><label htmlFor={"portfolio-plus-version"}>Version *</label>
          <input value={form.version} onChange={e=>set("version",e.target.value)}
            placeholder="e.g. v2.1.0" id={"portfolio-plus-version"} /></div>
        <div className="form-group" style={{flex:2}}><label htmlFor={"portfolio-plus-release-name"}>Release Name</label>
          <input value={form.name} onChange={e=>set("name",e.target.value)}
            placeholder="e.g. Summer Release" id={"portfolio-plus-release-name"} /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label htmlFor={"portfolio-plus-project"}>Project</label>
          <select value={form.projectId} onChange={e=>set("projectId",e.target.value)} id={"portfolio-plus-project"}>
            <option value="">— All Projects —</option>
            {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
        <div className="form-group"><label htmlFor={"portfolio-plus-status"}>Status</label>
          <select value={form.status} onChange={e=>set("status",e.target.value)} id={"portfolio-plus-status"}>
            {Object.keys(REL_STATUS).map(s=><option key={s}>{s}</option>)}
          </select></div>
        <div className="form-group"><label htmlFor={"portfolio-plus-environment"}>Environment</label>
          <select value={form.environment} onChange={e=>set("environment",e.target.value)} id={"portfolio-plus-environment"}>
            <option>PRODUCTION</option><option>STAGING</option><option>BETA</option>
          </select></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label htmlFor={"portfolio-plus-release-date"}>Release Date</label>
          <input type="date" value={form.releaseDate?.slice?.(0,10)||""}
            onChange={e=>set("releaseDate",e.target.value)} id={"portfolio-plus-release-date"} /></div>
        <div className="form-group"><label htmlFor={"portfolio-plus-owner"}>Owner</label>
          <input value={form.owner} onChange={e=>set("owner",e.target.value)} id={"portfolio-plus-owner"} /></div>
      </div>
      <div className="form-group"><label htmlFor={"portfolio-plus-description"}>Description</label>
        <textarea rows={2} value={form.description} onChange={e=>set("description",e.target.value)} id={"portfolio-plus-description"} /></div>
      <div className="form-group"><label htmlFor={"portfolio-plus-release-notes"}>Release Notes</label>
        <textarea rows={3} value={form.releaseNotes||""}
          onChange={e=>set("releaseNotes",e.target.value)}
          placeholder="What's new in this release…" id={"portfolio-plus-release-notes"} /></div>
      <div className="form-actions">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" disabled={!form.version}
          onClick={()=>onSave(form)}>Save Release</button>
      </div>
    </div></div>
  );
}

function ReleasesTab({ projects }) {
  const [releases, setReleases] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing,  setEditing]  = useState(null);
  const [filter,   setFilter]   = useState("");
  const { show:toast } = useToast();
  const confirm = useConfirm();

  const load = () => getReleases().then(r=>setReleases(unwrapList(r))).catch(()=>{});
  useEffect(()=>{ load(); },[]);

  const handleSave = async (form) => {
    if (editing?.id) await updateRelease(editing.id, form);
    else             await createRelease(form);
    setShowForm(false); setEditing(null); load();
    toast(editing ? "Release updated" : "Release created","success");
  };

  const handleDelete = async (id) => {
    const ok = await confirm({title:"Delete release?",danger:true});
    if (!ok) return;
    await deleteRelease(id); load(); toast("Release deleted","success");
  };

  const filtered = filter ? releases.filter(r=>r.status===filter) : releases;
  const projectName = (id) => projects.find(p=>p.id===id)?.name || "—";

  return (
    <div>
      <div className="pplus-toolbar">
        <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
          {["","PLANNED","IN_PROGRESS","RELEASED","CANCELLED"].map(s=>(
            <button key={s}
              className={`sprint-filter-btn${filter===s?" active":""}`}
              onClick={()=>setFilter(s)}>{s||"All"}</button>
          ))}
        </div>
        <button className="btn-primary" onClick={()=>{setEditing(null);setShowForm(true);}}>+ New Release</button>
      </div>

      <div className="pplus-table">
        <div className="pplus-table-head">
          <span>Version</span><span>Name</span><span>Project</span>
          <span>Environment</span><span>Release Date</span><span>Status</span><span></span>
        </div>
        {filtered.map(r=>{
          const sm = REL_STATUS[r.status]||REL_STATUS.PLANNED;
          return (
            <div key={r.id} className="pplus-table-row">
              <span className="pplus-version-chip">{r.version}</span>
              <div>
                <div className="pplus-row-title">{r.name||r.version}</div>
                {r.owner && <div className="pplus-row-meta">👤 {r.owner}</div>}
              </div>
              <span className="pplus-row-meta">{projectName(r.projectId)}</span>
              <span className="pplus-row-meta">{r.environment||"—"}</span>
              <span className="pplus-row-meta">
                {r.releaseDate ? new Date(r.releaseDate).toLocaleDateString() : "TBD"}
              </span>
              <span><span className="pplus-status-chip"
                style={{background:sm.bg,color:sm.color}}>{sm.label}</span></span>
              <span style={{display:"flex",gap:"4px",alignItems:"center"}}>
                <button className="btn-icon" title="Generate changelog"
                  onClick={async()=>{
                    const res = await client.post(`/releases/${r.id}/generate-changelog`);
                    if (res.data.autoChangelog) {
                      alert("Changelog:\n\n" + res.data.autoChangelog);
                      load();
                    }
                  }}>📋</button>
                <button className="btn-icon" onClick={()=>{setEditing(r);setShowForm(true);}}>✏️</button>
                <button className="btn-icon" onClick={()=>handleDelete(r.id)}>🗑️</button>
              </span>
            {r.autoChangelog && (
              <div style={{gridColumn:"1/-1",padding:"8px 10px",background:"rgba(99,102,241,.04)",
                borderTop:"1px solid rgba(99,102,241,.1)",fontSize:"11px",fontFamily:"monospace",
                color:"var(--gray-600)",whiteSpace:"pre-wrap",maxHeight:100,overflowY:"auto"}}>
                {r.autoChangelog.slice(0,400)}{r.autoChangelog.length>400?"…":""}
              </div>
            )}
            </div>
          );
        })}
        {filtered.length===0 && <div className="pplus-empty">No releases found. Create your first release.</div>}
      </div>

      {showForm && <ReleaseForm initial={editing} projects={projects}
        onSave={handleSave} onCancel={()=>{setShowForm(false);setEditing(null);}} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// STRATEGIC INITIATIVES
// ─────────────────────────────────────────────────────────────
function InitiativesTab({ projects, goals }) {
  const [items,    setItems]   = useState([]);
  const [showForm, setShowForm]= useState(false);
  const [editing,  setEditing] = useState(null);
  const [form, setForm] = useState({
    name:"", description:"", strategicRationale:"",
    status:"ACTIVE", owner:"", priority:"MEDIUM",
    projectIds:[], goalIds:[], progress:0,
  });
  const { show:toast } = useToast();
  const confirm = useConfirm();
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const toggleArr = (k,v) => setForm(f=>({...f,[k]:f[k].includes(v)?f[k].filter(x=>x!==v):[...f[k],v]}));

  const load = () => getInitiatives().then(r=>setItems(unwrapList(r))).catch(()=>{});
  useEffect(()=>{ load(); },[]);

  const openForm = (item=null) => {
    setEditing(item);
    setForm(item ? {
      name:item.name||"", description:item.description||"",
      strategicRationale:item.strategicRationale||"",
      status:item.status||"ACTIVE", owner:item.owner||"",
      priority:item.priority||"MEDIUM",
      projectIds:item.projectIds||[], goalIds:item.goalIds||[],
      progress:item.progress||0,
    } : {name:"",description:"",strategicRationale:"",
         status:"ACTIVE",owner:"",priority:"MEDIUM",projectIds:[],goalIds:[],progress:0});
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name) return;
    if (editing?.id) await updateInitiative(editing.id, form);
    else             await createInitiative(form);
    setShowForm(false); setEditing(null); load();
    toast(editing?"Initiative updated":"Initiative created","success");
  };

  const handleDelete = async (id) => {
    const ok = await confirm({title:"Delete initiative?",danger:true});
    if (!ok) return;
    await deleteInitiative(id); load(); toast("Deleted","success");
  };

  const PRIORITY_COLOR = {HIGH:"var(--danger)",MEDIUM:"var(--warning)",LOW:"var(--success)"};

  return (
    <div>
      <div className="pplus-toolbar">
        <div /> <button className="btn-primary" onClick={()=>openForm()}>+ New Initiative</button>
      </div>

      <div className="pplus-initiative-grid">
        {items.map(item=>(
          <div key={item.id} className="pplus-initiative-card">
            <div className="pplus-initiative-header">
              <div>
                <div className="pplus-initiative-name">{item.name}</div>
                <div className="pplus-initiative-meta">
                  {item.owner && <span>👤 {item.owner}</span>}
                  <span className="pplus-priority-chip"
                    style={{color:PRIORITY_COLOR[item.priority||"MEDIUM"]}}>
                    {item.priority||"MEDIUM"}
                  </span>
                </div>
              </div>
              <div style={{display:"flex",gap:"4px"}}>
                <button className="btn-icon" onClick={()=>openForm(item)}>✏️</button>
                <button className="btn-icon" onClick={()=>handleDelete(item.id)}>🗑️</button>
              </div>
            </div>
            {item.description && <div className="pplus-initiative-desc">{item.description}</div>}
            {item.strategicRationale && (
              <div className="pplus-initiative-rationale">💡 {item.strategicRationale}</div>
            )}
            <div className="pplus-initiative-progress">
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
                <span style={{fontSize:"11px",color:"var(--gray-400)"}}>Progress</span>
                <span style={{fontSize:"11px",fontWeight:700}}>{item.progress||0}%</span>
              </div>
              <div className="pplus-progress-bar">
                <div className="pplus-progress-fill"
                  style={{width:`${item.progress||0}%`}} />
              </div>
            </div>
            <div className="pplus-initiative-links">
              {(item.projectIds||[]).length>0 && (
                <span className="pplus-link-chip">📁 {item.projectIds.length} project{item.projectIds.length>1?"s":""}</span>
              )}
              {(item.goalIds||[]).length>0 && (
                <span className="pplus-link-chip">🎯 {item.goalIds.length} goal{item.goalIds.length>1?"s":""}</span>
              )}
            </div>
          </div>
        ))}
        {items.length===0 && <div className="pplus-empty">No strategic initiatives yet.</div>}
      </div>

      {showForm && (
        <div className="modal-overlay"><div className="modal">
          <h2>{editing?"Edit Initiative":"New Strategic Initiative"}</h2>
          <div className="form-group"><label htmlFor={"portfolio-plus-name"}>Name *</label>
            <input value={form.name} onChange={e=>set("name",e.target.value)} id={"portfolio-plus-name"} /></div>
          <div className="form-group"><label htmlFor={"portfolio-plus-description-2"}>Description</label>
            <textarea rows={2} value={form.description} onChange={e=>set("description",e.target.value)} id={"portfolio-plus-description-2"} /></div>
          <div className="form-group"><label htmlFor={"portfolio-plus-strategic-rationale"}>Strategic Rationale</label>
            <textarea rows={2} value={form.strategicRationale}
              onChange={e=>set("strategicRationale",e.target.value)}
              placeholder="Why is this initiative important?" id={"portfolio-plus-strategic-rationale"} /></div>
          <div className="form-row">
            <div className="form-group"><label htmlFor={"portfolio-plus-status-2"}>Status</label>
              <select value={form.status} onChange={e=>set("status",e.target.value)} id={"portfolio-plus-status-2"}>
                <option>ACTIVE</option><option>PAUSED</option><option>COMPLETED</option><option>CANCELLED</option>
              </select></div>
            <div className="form-group"><label htmlFor={"portfolio-plus-priority"}>Priority</label>
              <select value={form.priority} onChange={e=>set("priority",e.target.value)} id={"portfolio-plus-priority"}>
                <option>HIGH</option><option>MEDIUM</option><option>LOW</option>
              </select></div>
            <div className="form-group"><label htmlFor={"portfolio-plus-owner-2"}>Owner</label>
              <input value={form.owner} onChange={e=>set("owner",e.target.value)} id={"portfolio-plus-owner-2"} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Progress ({form.progress}%)</label>
              <input type="range" min={0} max={100} value={form.progress}
                onChange={e=>set("progress",Number(e.target.value))} /></div>
          </div>
          <div className="form-group"><span className="field-label">Linked Projects</span>
            <div className="pplus-multi-select">
              {projects.map(p=>(
                <label key={p.id} className={`pplus-multi-chip${form.projectIds.includes(p.id)?" active":""}`}>
                  <input type="checkbox" checked={form.projectIds.includes(p.id)}
                    onChange={()=>toggleArr("projectIds",p.id)} />
                  {p.name}
                </label>
              ))}
            </div>
          </div>
          <div className="form-group"><span className="field-label">Linked Goals</span>
            <div className="pplus-multi-select">
              {goals.map(g=>(
                <label key={g.id} className={`pplus-multi-chip${form.goalIds.includes(g.id)?" active":""}`}>
                  <input type="checkbox" checked={form.goalIds.includes(g.id)}
                    onChange={()=>toggleArr("goalIds",g.id)} />
                  {g.title}
                </label>
              ))}
            </div>
          </div>
          <div className="form-actions">
            <button className="btn-secondary" onClick={()=>{setShowForm(false);setEditing(null);}}>Cancel</button>
            <button className="btn-primary" disabled={!form.name} onClick={handleSave}>Save</button>
          </div>
        </div></div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PROGRAMME MANAGEMENT
// ─────────────────────────────────────────────────────────────
function ProgrammesTab({ projects }) {
  const [items,    setItems]   = useState([]);
  const [showForm, setShowForm]= useState(false);
  const [editing,  setEditing] = useState(null);
  const [expanded, setExpanded]= useState(null);
  const [newMs,    setNewMs]   = useState({title:"",dueDate:"",ownedBy:""});
  const [form, setForm] = useState({
    name:"", description:"", status:"ACTIVE", owner:"", projectIds:[],
  });
  const { show:toast } = useToast();
  const confirm = useConfirm();
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const load = () => getProgrammes().then(r=>setItems(unwrapList(r))).catch(()=>{});
  useEffect(()=>{ load(); },[]);

  const openForm = (item=null) => {
    setEditing(item);
    setForm(item ? {
      name:item.name||"", description:item.description||"",
      status:item.status||"ACTIVE", owner:item.owner||"",
      projectIds:item.projectIds||[],
    } : {name:"",description:"",status:"ACTIVE",owner:"",projectIds:[]});
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name) return;
    if (editing?.id) await updateProgramme(editing.id, form);
    else             await createProgramme(form);
    setShowForm(false); setEditing(null); load();
    toast(editing?"Programme updated":"Programme created","success");
  };

  const handleAddMilestone = async (progId) => {
    if (!newMs.title) return;
    await addMilestone(progId, newMs);
    setNewMs({title:"",dueDate:"",ownedBy:""}); load();
    toast("Milestone added","success");
  };

  const handleToggle = async (progId, mId) => {
    await toggleMilestone(progId, mId); load();
  };

  const handleDelete = async (id) => {
    const ok = await confirm({title:"Delete programme?",danger:true});
    if (!ok) return;
    await deleteProgramme(id); load(); toast("Deleted","success");
  };

  const STATUS_COLOR = {ACTIVE:"var(--success)",PAUSED:"var(--warning)",COMPLETED:"var(--brand-500)",CANCELLED:"var(--gray-500)"};

  return (
    <div>
      <div className="pplus-toolbar">
        <div/> <button className="btn-primary" onClick={()=>openForm()}>+ New Programme</button>
      </div>

      <div className="pplus-programme-list">
        {items.map(prog=>{
          const ms        = prog.milestones||[];
          const doneMs    = ms.filter(m=>m.completed).length;
          const pct       = ms.length ? Math.round((doneMs/ms.length)*100) : 0;
          const isExpanded= expanded===prog.id;
          const linkedProjs= projects.filter(p=>(prog.projectIds||[]).includes(p.id));
          return (
            <div key={prog.id} className="pplus-programme-card">
              <div className="pplus-programme-header">
                <div className="pplus-programme-left">
                  <div className="pplus-initiative-name">{prog.name}</div>
                  {prog.owner && <div className="pplus-row-meta">👤 {prog.owner}</div>}
                  <div style={{display:"flex",gap:"6px",marginTop:"4px",flexWrap:"wrap"}}>
                    <span className="pplus-status-chip"
                      style={{color:STATUS_COLOR[prog.status]||"var(--gray-500)",
                        background:`${STATUS_COLOR[prog.status]||"var(--gray-500)"}1a`}}>
                      {statusText(prog.status)}
                    </span>
                    {linkedProjs.map(p=>(
                      <span key={p.id} className="pplus-link-chip">📁 {p.name}</span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                  <div className="pplus-milestone-count">
                    {doneMs}/{ms.length} milestones
                  </div>
                  <button className="btn-secondary" style={{fontSize:"11px"}}
                    onClick={()=>setExpanded(v=>v===prog.id?null:prog.id)}>
                    {isExpanded?"▲ Hide":"▼ Milestones"}
                  </button>
                  <button className="btn-icon" onClick={()=>openForm(prog)}>✏️</button>
                  <button className="btn-icon" onClick={()=>handleDelete(prog.id)}>🗑️</button>
                </div>
              </div>

              {ms.length > 0 && (
                <div className="pplus-prog-bar-wrap">
                  <div className="pplus-progress-bar">
                    <div className="pplus-progress-fill" style={{width:`${pct}%`}} />
                  </div>
                  <span style={{fontSize:"11px",fontWeight:700}}>{pct}%</span>
                </div>
              )}

              {prog.description && (
                <div className="pplus-initiative-desc">{prog.description}</div>
              )}

              {isExpanded && (
                <div className="pplus-milestone-panel">
                  <div className="pplus-milestone-list">
                    {ms.map(m=>(
                      <div key={m.id} className="pplus-milestone-row">
                        <input type="checkbox" checked={m.completed}
                          onChange={()=>handleToggle(prog.id,m.id)} />
                        <span className={`pplus-milestone-title${m.completed?" done":""}`}>
                          {m.title}
                        </span>
                        {m.dueDate && (
                          <span className="pplus-milestone-date">
                            📅 {new Date(m.dueDate).toLocaleDateString()}
                          </span>
                        )}
                        {m.ownedBy && (
                          <span className="pplus-milestone-owner">👤 {m.ownedBy}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="pplus-milestone-add">
                    <input value={newMs.title}
                      onChange={e=>setNewMs(v=>({...v,title:e.target.value}))}
                      placeholder="New milestone…" />
                    <input type="date" value={newMs.dueDate}
                      onChange={e=>setNewMs(v=>({...v,dueDate:e.target.value}))} />
                    <input value={newMs.ownedBy}
                      onChange={e=>setNewMs(v=>({...v,ownedBy:e.target.value}))}
                      placeholder="Owner" />
                    <button className="btn-primary" style={{fontSize:"11px"}}
                      onClick={()=>handleAddMilestone(prog.id)}>Add</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {items.length===0 && <div className="pplus-empty">No programmes yet. Create one to group related projects.</div>}
      </div>

      {showForm && (
        <div className="modal-overlay"><div className="modal">
          <h2>{editing?"Edit Programme":"New Programme"}</h2>
          <div className="form-group"><label htmlFor={"portfolio-plus-name-2"}>Name *</label>
            <input value={form.name} onChange={e=>set("name",e.target.value)} id={"portfolio-plus-name-2"} /></div>
          <div className="form-group"><label htmlFor={"portfolio-plus-description-3"}>Description</label>
            <textarea rows={2} value={form.description} onChange={e=>set("description",e.target.value)} id={"portfolio-plus-description-3"} /></div>
          <div className="form-row">
            <div className="form-group"><label htmlFor={"portfolio-plus-status-3"}>Status</label>
              <select value={form.status} onChange={e=>set("status",e.target.value)} id={"portfolio-plus-status-3"}>
                <option>ACTIVE</option><option>PAUSED</option><option>COMPLETED</option><option>CANCELLED</option>
              </select></div>
            <div className="form-group"><label htmlFor={"portfolio-plus-owner-3"}>Owner</label>
              <input value={form.owner} onChange={e=>set("owner",e.target.value)} id={"portfolio-plus-owner-3"} /></div>
          </div>
          <div className="form-group"><span className="field-label">Linked Projects</span>
            <div className="pplus-multi-select">
              {projects.map(p=>(
                <label key={p.id} className={`pplus-multi-chip${form.projectIds.includes(p.id)?" active":""}`}>
                  <input type="checkbox" checked={form.projectIds.includes(p.id)}
                    onChange={()=>set("projectIds",form.projectIds.includes(p.id)
                      ?form.projectIds.filter(x=>x!==p.id):[...form.projectIds,p.id])} />
                  {p.name}
                </label>
              ))}
            </div>
          </div>
          <div className="form-actions">
            <button className="btn-secondary" onClick={()=>{setShowForm(false);setEditing(null);}}>Cancel</button>
            <button className="btn-primary" disabled={!form.name} onClick={handleSave}>Save</button>
          </div>
        </div></div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────
export default function PortfolioPlus() {
  const [tab,      setTab]      = useState("releases");
  const [projects, setProjects] = useState([]);
  const [goals,    setGoals]    = useState([]);

  useEffect(() => {
    getProjects().then(r => setProjects(unwrapList(r))).catch(()=>{});
    getGoals().then(r    => setGoals(unwrapList(r))).catch(()=>{});
  }, []);

  const TABS = [
    { id:"releases",    label:"🚀 Releases"   },
    { id:"initiatives", label:"⚡ Initiatives" },
    { id:"programmes",  label:"📦 Programmes" },
  ];

  return (
    <div>
      <PageHeader icon="🏗" title="Portfolio+"
        description="Release management, strategic initiatives, and programme tracking. Looking for Change Requests? That moved to its own page in the sidebar." />

      <div className="admin-tab-bar">
        {TABS.map(t=>(
          <button key={t.id}
            className={`admin-tab-btn${tab===t.id?" active":""}`}
            onClick={()=>setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab==="releases"    && <ReleasesTab    projects={projects} />}
      {tab==="initiatives" && <InitiativesTab projects={projects} goals={goals} />}
      {tab==="programmes"  && <ProgrammesTab  projects={projects} />}
    </div>
  );
}