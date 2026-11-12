import { unwrapList } from "../api/client";
import { useState, useEffect } from "react";
import PageHeader from "../components/PageHeader";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import {
  getDecisions, createDecision, updateDecision, deleteDecision,
  aiAnalyseDecision as aiAnalyse,
} from "../api/decisions";
import "../styles/pages/decisions.css";

// Was a locally-duplicated copy of these same 5 calls, redefined inline
// instead of reusing api/decisions.js (which Decisions.jsx and Docs.jsx
// both already used) — two independent wrapper layers hitting the same
// /api/decisions endpoints, the same shape of risk fixed for
// PortfolioPlus's duplicate Changes tab and api/portfolio.js earlier.

const IMPACT_META = {
  HIGH:   { color:"var(--danger)", bg:"rgba(239,68,68,.1)"  },
  MEDIUM: { color:"var(--warning)", bg:"rgba(245,158,11,.1)" },
  LOW:    { color:"var(--success)", bg:"rgba(16,185,129,.1)" },
};
const STATUS_META = {
  OPEN:        { label:"Open",        color:"#3b82f6" },
  DECIDED:     { label:"Decided",     color:"var(--brand-500)" },
  IMPLEMENTED: { label:"Implemented", color:"var(--success)" },
  SUPERSEDED:  { label:"Superseded",  color:"var(--gray-500)" },
};
const REV_META = {
  REVERSIBLE:   { icon:"↩️", label:"Reversible",   color:"var(--success)" },
  PARTIALLY:    { icon:"⚠️", label:"Partly Rev.",  color:"var(--warning)" },
  IRREVERSIBLE: { icon:"🔒", label:"Irreversible", color:"var(--danger)" },
};

function DecisionForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    title:"", context:"", decision:"", rationale:"", alternatives:"",
    impact:"MEDIUM", category:"PRODUCT", reversibility:"REVERSIBLE",
    status:"OPEN", madeBy:"", reviewAt:"",
  });
  const set = (k, v) => setForm(f => ({...f,[k]:v}));
  return (
    <div className="modal-overlay"><div className="modal" style={{maxWidth:640}}>
      <h2>{initial?.id ? "Edit Decision" : "Log Decision"}</h2>
      <div className="form-group"><label htmlFor={"decision-log-title"}>Title *</label>
        <input value={form.title} onChange={e=>set("title",e.target.value)}
          placeholder="What decision was (or needs to be) made?" id={"decision-log-title"} /></div>
      <div className="form-group"><label htmlFor={"decision-log-context-problem-statement"}>Context / Problem Statement</label>
        <textarea rows={2} value={form.context} onChange={e=>set("context",e.target.value)}
          placeholder="What is the situation? What problem are we solving?" id={"decision-log-context-problem-statement"} /></div>
      <div className="form-group"><label htmlFor={"decision-log-decision-made"}>Decision Made</label>
        <textarea rows={2} value={form.decision} onChange={e=>set("decision",e.target.value)}
          placeholder="What was decided?" id={"decision-log-decision-made"} /></div>
      <div className="form-group"><label htmlFor={"decision-log-rationale"}>Rationale</label>
        <textarea rows={2} value={form.rationale} onChange={e=>set("rationale",e.target.value)}
          placeholder="Why this decision? What evidence supports it?" id={"decision-log-rationale"} /></div>
      <div className="form-group"><label htmlFor={"decision-log-alternatives-considered"}>Alternatives Considered</label>
        <textarea rows={2} value={form.alternatives} onChange={e=>set("alternatives",e.target.value)}
          placeholder="What other options were evaluated?" id={"decision-log-alternatives-considered"} /></div>
      <div className="form-row">
        <div className="form-group"><label htmlFor={"decision-log-impact"}>Impact</label>
          <select value={form.impact} onChange={e=>set("impact",e.target.value)} id={"decision-log-impact"}>
            <option>HIGH</option><option>MEDIUM</option><option>LOW</option>
          </select></div>
        <div className="form-group"><label htmlFor={"decision-log-category"}>Category</label>
          <select value={form.category} onChange={e=>set("category",e.target.value)} id={"decision-log-category"}>
            <option>TECHNICAL</option><option>PRODUCT</option><option>RESOURCE</option><option>STRATEGIC</option>
          </select></div>
        <div className="form-group"><label htmlFor={"decision-log-reversibility"}>Reversibility</label>
          <select value={form.reversibility} onChange={e=>set("reversibility",e.target.value)} id={"decision-log-reversibility"}>
            <option value="REVERSIBLE">Reversible</option>
            <option value="PARTIALLY">Partially</option>
            <option value="IRREVERSIBLE">Irreversible</option>
          </select></div>
        <div className="form-group"><label htmlFor={"decision-log-status"}>Status</label>
          <select value={form.status} onChange={e=>set("status",e.target.value)} id={"decision-log-status"}>
            <option value="OPEN">Open</option><option value="DECIDED">Decided</option>
            <option value="IMPLEMENTED">Implemented</option><option value="SUPERSEDED">Superseded</option>
          </select></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label htmlFor={"decision-log-decision-maker"}>Decision maker</label>
          <input value={form.madeBy} onChange={e=>set("madeBy",e.target.value)}
            placeholder="email or name" id={"decision-log-decision-maker"} /></div>
        <div className="form-group"><label htmlFor={"decision-log-review-date"}>Review date</label>
          <input type="date" value={form.reviewAt?.slice?.(0,10)||""}
            onChange={e=>set("reviewAt",e.target.value)} id={"decision-log-review-date"} /></div>
      </div>
      <div className="form-actions">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" disabled={!form.title} onClick={()=>onSave(form)}>Save Decision</button>
      </div>
    </div></div>
  );
}

function DecisionCard({ d, onEdit, onDelete, onAI }) {
  const [expanded, setExpanded] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const sm = STATUS_META[d.status] || STATUS_META.OPEN;
  const im = IMPACT_META[d.impact] || IMPACT_META.MEDIUM;
  const rm = REV_META[d.reversibility] || REV_META.REVERSIBLE;

  const handleAI = async () => {
    setAiLoading(true);
    try { await onAI(d.id); }
    finally { setAiLoading(false); }
  };

  return (
    <div className={`decision-card${expanded?" expanded":""}`}>
      <div className="decision-card-header" onClick={()=>setExpanded(v=>!v)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (()=>setExpanded(v=>!v))?.(e); } }}>
        <div className="decision-card-left">
          <div className="decision-title">{d.title}</div>
          <div className="decision-meta">
            <span className="decision-category">{d.category}</span>
            <span className="decision-impact"
              style={{color:im.color,background:im.bg}}>{d.impact}</span>
            <span className="decision-rev" style={{color:rm.color}}>
              {rm.icon} {rm.label}
            </span>
            {d.madeBy && <span className="decision-by">{d.madeBy}</span>}
            <span style={{fontSize:"11px",color:"var(--gray-400)"}}>
              {new Date(d.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="decision-card-right" onClick={e=>e.stopPropagation()} role="presentation">
          <span className="decision-status" style={{color:sm.color}}>{sm.label}</span>
          <button className="btn-icon" onClick={()=>onEdit(d)}>✏️</button>
          <button className="btn-icon" onClick={()=>onDelete(d.id)}>🗑️</button>
          <span className="decision-expand-icon">{expanded?"▲":"▼"}</span>
        </div>
      </div>

      {expanded && (
        <div className="decision-body">
          {d.context && (
            <div className="decision-section">
              <div className="decision-section-label">Context</div>
              <div className="decision-section-text">{d.context}</div>
            </div>
          )}
          {d.decision && (
            <div className="decision-section">
              <div className="decision-section-label">Decision</div>
              <div className="decision-section-text">{d.decision}</div>
            </div>
          )}
          {d.rationale && (
            <div className="decision-section">
              <div className="decision-section-label">Rationale</div>
              <div className="decision-section-text">{d.rationale}</div>
            </div>
          )}
          {d.alternatives && (
            <div className="decision-section">
              <div className="decision-section-label">Alternatives</div>
              <div className="decision-section-text">{d.alternatives}</div>
            </div>
          )}
          {d.outcome && (
            <div className="decision-section">
              <div className="decision-section-label">Outcome</div>
              <div className="decision-section-text">{d.outcome}</div>
            </div>
          )}
          {d.aiSuggestion && (
            <div className="decision-ai-block">
              <div className="decision-ai-label">AI Analysis</div>
              <div className="decision-ai-text">{d.aiSuggestion}</div>
            </div>
          )}
          {d.reviewAt && (
            <div className="decision-review-date">
              Review scheduled: {new Date(d.reviewAt).toLocaleDateString()}
            </div>
          )}
          <div className="decision-actions">
            <button className="btn-secondary" style={{fontSize:"11px"}}
              disabled={aiLoading} onClick={handleAI}>
              {aiLoading ? "Analysing…" : "AI Intelligence"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DecisionLog() {
  const [decisions, setDecisions] = useState([]);
  const [showForm,  setShowForm]  = useState(false);
  const [editing,   setEditing]   = useState(null);
  const [filter,    setFilter]    = useState("");
  const { show:toast } = useToast();
  const confirm = useConfirm();

  const load = () => getDecisions().then(r=>setDecisions(unwrapList(r))).catch(()=>{});
  useEffect(()=>{ load(); },[]);

  const handleSave = async (form) => {
    if (editing?.id) await updateDecision(editing.id, form);
    else             await createDecision(form);
    setShowForm(false); setEditing(null); load();
    toast(editing ? "Decision updated" : "Decision logged","success");
  };

  const handleDelete = async (id) => {
    const ok = await confirm({title:"Delete decision?",danger:true});
    if (!ok) return;
    await deleteDecision(id); load(); toast("Deleted","success");
  };

  const handleAI = async (id) => {
    await aiAnalyse(id);
    toast("AI analysis complete","success"); load();
  };

  const filtered = filter ? decisions.filter(d => d.status===filter || d.category===filter) : decisions;
  const counts = Object.fromEntries(Object.keys(STATUS_META).map(k=>[k,decisions.filter(d=>d.status===k).length]));
  const highImpact = decisions.filter(d=>d.impact==="HIGH").length;
  const irreversible = decisions.filter(d=>d.reversibility==="IRREVERSIBLE").length;

  return (
    <div>
      <PageHeader icon="🧠" title="Decision Intelligence"
        description="Log, analyse, and learn from important decisions"
        action={<button className="btn-primary" onClick={()=>{setEditing(null);setShowForm(true);}}>
          + Log Decision
        </button>}
      />

      {/* Summary */}
      <div className="kpi-summary-bar" style={{marginBottom:"16px"}}>
        {[
          {label:"Total",       value:decisions.length,  color:"var(--gray-700)"},
          {label:"Open",        value:counts.OPEN||0,    color:"#3b82f6"},
          {label:"Decided",     value:counts.DECIDED||0, color:"var(--brand-500)"},
          {label:"High Impact", value:highImpact,        color:"var(--danger)"},
          {label:"Irreversible",value:irreversible,      color:"var(--warning)"},
        ].map(s=>(
          <div key={s.label} className="kpi-summary-stat">
            <div className="kpi-summary-num" style={{color:s.color}}>{s.value}</div>
            <div className="kpi-summary-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="intg-filter-bar">
        {["","OPEN","DECIDED","IMPLEMENTED","SUPERSEDED","TECHNICAL","PRODUCT","RESOURCE","STRATEGIC"].map(f=>(
          <button key={f}
            className={`sprint-filter-btn${filter===f?" active":""}`}
            onClick={()=>setFilter(f)}>{f||"All"}</button>
        ))}
      </div>

      {/* Decision cards */}
      <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
        {filtered.map(d=>(
          <DecisionCard key={d.id} d={d}
            onEdit={d=>{setEditing(d);setShowForm(true);}}
            onDelete={handleDelete}
            onAI={handleAI} />
        ))}
        {filtered.length===0 && (
          <div className="empty-state">No decisions yet. Log your first decision above.</div>
        )}
      </div>

      {showForm && (
        <DecisionForm initial={editing} onSave={handleSave}
          onCancel={()=>{setShowForm(false);setEditing(null);}} />
      )}
    </div>
  );
}
