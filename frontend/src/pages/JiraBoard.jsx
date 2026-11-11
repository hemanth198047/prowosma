import { unwrapList } from "../api/client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable, closestCorners,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { getTasks, createTask, updateTask, deleteTask } from "../api/tasks";
import { getSprints, createSprint, updateSprint, saveRetro } from "../api/sprints";
import { getProjects } from "../api/projects";
import client from "../api/client";
import { useAuth } from "../hooks/useAuth";
import PageHeader from "../components/PageHeader";

import "../styles/pages/jira-board.css";
import { statusText } from "../utils/statusText";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../components/ToastContext";
const getEpics    = () => client.get("/epics").catch(()=>({data:[]}));
const getMembers  = () => client.get("/team").catch(()=>({data:[]}));

/* ── Constants ─────────────────────────────────────────────────── */
const PRIORITY_META = {
  HIGHEST:{ icon:"🔴", label:"Highest", color:"#D64545" },
  HIGH:   { icon:"🟠", label:"High",    color:"#f97316" },
  MEDIUM: { icon:"🟡", label:"Medium",  color:"#C17D22" },
  LOW:    { icon:"🟢", label:"Low",     color:"#1E8E5A" },
  LOWEST: { icon:"🔵", label:"Lowest",  color:"#5B5FEE" },
};
const TYPE_META = {
  STORY:  { icon:"📗", label:"Story",   color:"#1E8E5A" },
  BUG:    { icon:"🐛", label:"Bug",     color:"#D64545" },
  TASK:   { icon:"✅", label:"Task",    color:"#5B5FEE" },
  SUBTASK:{ icon:"🔹", label:"Subtask", color:"#7C5CBF" },
  EPIC:   { icon:"⚡", label:"Epic",    color:"#C17D22" },
};
const DEFAULT_COLUMNS = [
  { id:"TODO",        label:"To Do",       color:"#64748b", bg:"rgba(100,116,139,0.08)", wipLimit:null },
  { id:"IN_PROGRESS", label:"In Progress", color:"#3b82f6", bg:"rgba(59,130,246,0.08)",  wipLimit:5    },
  { id:"IN_REVIEW",   label:"In Review",   color:"#7C5CBF", bg:"rgba(139,92,246,0.08)",  wipLimit:3    },
  { id:"DONE",        label:"Done",        color:"#1E8E5A", bg:"rgba(16,185,129,0.08)",  wipLimit:null },
];
const STORY_POINT_SCALE = {
  fibonacci:  [1,2,3,5,8,13,21,34],
  linear:     [1,2,3,4,5,6,7,8,9,10],
  tshirt:     [1,2,3,5,8], // XS=1,S=2,M=3,L=5,XL=8
  powers:     [1,2,4,8,16,32],
};

/* ═══════════════════════════════════════════════════════════════════
   BOARD CONFIGURATION MODAL
   ═══════════════════════════════════════════════════════════════════ */
function BoardConfigModal({ config, onSave, onClose }) {
  const [cfg, setCfg] = useState({ ...config });
  const set = (k,v) => setCfg(p=>({...p,[k]:v}));

  const [columns, setColumns] = useState(cfg.columns || DEFAULT_COLUMNS);
  const addColumn = () => setColumns(p=>[...p,{
    id:"COL_"+Date.now(), label:"New Column", color:"#5B5FEE",
    bg:"rgba(99,102,241,0.08)", wipLimit:null,
  }]);
  const updateCol = (idx, k, v) => setColumns(p=>p.map((c,i)=>i===idx?{...c,[k]:v}:c));
  const removeCol = (idx) => setColumns(p=>p.filter((_,i)=>i!==idx));
  const moveCol   = (idx, dir) => {
    const arr=[...columns]; const to=idx+dir;
    if(to<0||to>=arr.length) return;
    [arr[idx],arr[to]]=[arr[to],arr[idx]]; setColumns(arr);
  };

  const handleSave = () => onSave({ ...cfg, columns });

  return (
    <div className="jb-modal-overlay" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }}>
      <div className="jb-modal jb-config-modal" onClick={e=>e.stopPropagation()} role="presentation">
        <div className="jb-modal-header">
          <span style={{fontWeight:800,fontSize:16}}>⚙️ Board Configuration</span>
          <button className="jb-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="jb-config-body">
          {/* ── Tab nav ── */}
          <div className="jb-config-sections">

            {/* COLUMNS */}
            <div className="jb-config-section">
              <div className="jb-config-section-title">📋 Board Columns</div>
              <div className="jb-config-section-desc">
                Define columns, their colours, and WIP limits. Drag to reorder.
              </div>
              {columns.map((col, idx) => (
                <div key={col.id} className="jb-col-config-row">
                  <input type="color" value={col.color}
                    onChange={e=>updateCol(idx,"color",e.target.value)}
                    className="jb-color-picker" title="Column colour"/>
                  <input className="jb-config-input" value={col.label}
                    onChange={e=>updateCol(idx,"label",e.target.value)}
                    placeholder="Column name"/>
                  <input className="jb-config-input" style={{width:70}}
                    type="number" min="1" max="99"
                    value={col.wipLimit||""} placeholder="WIP"
                    onChange={e=>updateCol(idx,"wipLimit",e.target.value?Number(e.target.value):null)}
                    title="WIP limit (leave blank for none)"/>
                  <div className="jb-col-config-actions">
                    <button onClick={()=>moveCol(idx,-1)} disabled={idx===0} title="Move up">↑</button>
                    <button onClick={()=>moveCol(idx,1)} disabled={idx===columns.length-1} title="Move down">↓</button>
                    <button onClick={()=>removeCol(idx)} disabled={columns.length<=2}
                      style={{color:"#D64545"}} title="Remove">✕</button>
                  </div>
                </div>
              ))}
              <button className="jb-add-col-btn" onClick={addColumn}>+ Add column</button>
            </div>

            {/* STORY POINTS */}
            <div className="jb-config-section">
              <div className="jb-config-section-title">🎯 Story Points</div>
              <div className="jb-form-grid" style={{gridTemplateColumns:"1fr 1fr"}}>
                <div className="jb-form-group">
                  <label htmlFor={"jira-board-estimation-scale"}>Estimation scale</label>
                  <select value={cfg.spScale||"fibonacci"}
                    onChange={e=>set("spScale",e.target.value)} id={"jira-board-estimation-scale"}>
                    <option value="fibonacci">Fibonacci (1,2,3,5,8,13,21)</option>
                    <option value="linear">Linear (1–10)</option>
                    <option value="tshirt">T-shirt (XS→XL)</option>
                    <option value="powers">Powers of 2 (1,2,4,8,16)</option>
                  </select>
                </div>
                <div className="jb-form-group">
                  <label htmlFor={"jira-board-show-story-points-on-cards"}>Show story points on cards</label>
                  <select value={cfg.showSP?"yes":"no"}
                    onChange={e=>set("showSP",e.target.value==="yes")} id={"jira-board-show-story-points-on-cards"}>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
              </div>
              <div className="jb-config-preview">
                <span className="jb-config-label">Available values:</span>
                {(STORY_POINT_SCALE[cfg.spScale||"fibonacci"]).map(v=>(
                  <span key={v} className="jb-sp-chip">{v}</span>
                ))}
              </div>
            </div>

            {/* SPRINT SETTINGS */}
            <div className="jb-config-section">
              <div className="jb-config-section-title">🏃 Sprint Settings</div>
              <div className="jb-form-grid" style={{gridTemplateColumns:"1fr 1fr"}}>
                <div className="jb-form-group">
                  <label htmlFor={"jira-board-default-sprint-duration"}>Default sprint duration</label>
                  <select value={cfg.sprintDuration||2}
                    onChange={e=>set("sprintDuration",Number(e.target.value))} id={"jira-board-default-sprint-duration"}>
                    <option value={1}>1 week</option>
                    <option value={2}>2 weeks</option>
                    <option value={3}>3 weeks</option>
                    <option value={4}>4 weeks</option>
                  </select>
                </div>
                <div className="jb-form-group">
                  <label htmlFor={"jira-board-auto-number-sprints"}>Auto-number sprints</label>
                  <select value={cfg.autoNumberSprints?"yes":"no"}
                    onChange={e=>set("autoNumberSprints",e.target.value==="yes")} id={"jira-board-auto-number-sprints"}>
                    <option value="yes">Yes (Sprint 1, Sprint 2…)</option>
                    <option value="no">Manual naming</option>
                  </select>
                </div>
                <div className="jb-form-group">
                  <label htmlFor={"jira-board-unfinished-work-on-complete"}>Unfinished work on complete</label>
                  <select value={cfg.unfinishedWork||"backlog"}
                    onChange={e=>set("unfinishedWork",e.target.value)} id={"jira-board-unfinished-work-on-complete"}>
                    <option value="backlog">Move to Backlog</option>
                    <option value="next">Move to Next Sprint</option>
                    <option value="ask">Ask each time</option>
                  </select>
                </div>
                <div className="jb-form-group">
                  <label htmlFor={"jira-board-burndown-metric"}>Burndown metric</label>
                  <select value={cfg.burndownMetric||"storyPoints"}
                    onChange={e=>set("burndownMetric",e.target.value)} id={"jira-board-burndown-metric"}>
                    <option value="storyPoints">Story Points</option>
                    <option value="issueCount">Issue Count</option>
                  </select>
                </div>
              </div>
            </div>

            {/* DISPLAY */}
            <div className="jb-config-section">
              <div className="jb-config-section-title">🖼 Display & Cards</div>
              <div className="jb-form-grid" style={{gridTemplateColumns:"1fr 1fr"}}>
                <div className="jb-form-group">
                  <label htmlFor={"jira-board-card-colour-coding"}>Card colour coding</label>
                  <select value={cfg.cardColor||"priority"}
                    onChange={e=>set("cardColor",e.target.value)} id={"jira-board-card-colour-coding"}>
                    <option value="none">None</option>
                    <option value="priority">By Priority</option>
                    <option value="type">By Issue Type</option>
                    <option value="epic">By Epic</option>
                    <option value="assignee">By Assignee</option>
                  </select>
                </div>
                <div className="jb-form-group">
                  <label htmlFor={"jira-board-show-sub-tasks-on-board"}>Show sub-tasks on board</label>
                  <select value={cfg.showSubtasks?"yes":"no"}
                    onChange={e=>set("showSubtasks",e.target.value==="yes")} id={"jira-board-show-sub-tasks-on-board"}>
                    <option value="no">No (parent only)</option>
                    <option value="yes">Yes</option>
                  </select>
                </div>
                <div className="jb-form-group">
                  <label htmlFor={"jira-board-group-backlog-by"}>Group backlog by</label>
                  <select value={cfg.backlogGroupBy||"none"}
                    onChange={e=>set("backlogGroupBy",e.target.value)} id={"jira-board-group-backlog-by"}>
                    <option value="none">No grouping</option>
                    <option value="epic">Epic</option>
                    <option value="type">Issue Type</option>
                    <option value="priority">Priority</option>
                    <option value="assignee">Assignee</option>
                  </select>
                </div>
                <div className="jb-form-group">
                  <label htmlFor={"jira-board-days-in-done-before-auto-archive"}>Days in "Done" before auto-archive</label>
                  <select value={cfg.archiveDays||0}
                    onChange={e=>set("archiveDays",Number(e.target.value))} id={"jira-board-days-in-done-before-auto-archive"}>
                    <option value={0}>Never</option>
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                  </select>
                </div>
              </div>
            </div>

            {/* ISSUE TYPES */}
            <div className="jb-config-section">
              <div className="jb-config-section-title">🏷 Issue Types</div>
              <div className="jb-config-section-desc">
                Choose which issue types are active on this board.
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
                {Object.entries(TYPE_META).map(([k,v])=>{
                  const active = !(cfg.disabledTypes||[]).includes(k);
                  return (
                    <button key={k}
                      className={"jb-type-chip"+(active?" jb-type-chip-active":"")}
                      style={active?{borderColor:v.color,color:v.color,
                        background:`${v.color}18`}:{}}
                      onClick={()=>{
                        const dis = cfg.disabledTypes||[];
                        set("disabledTypes", active ? [...dis,k] : dis.filter(x=>x!==k));
                      }}>
                      {v.icon} {v.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* WORKFLOW */}
            <div className="jb-config-section">
              <div className="jb-config-section-title">🔄 Workflow Rules</div>
              <div className="jb-form-grid" style={{gridTemplateColumns:"1fr"}}>
                <div className="jb-form-group">
                  <label>
                    <input type="checkbox" checked={!!cfg.requireEstimate}
                      onChange={e=>set("requireEstimate",e.target.checked)}
                      style={{marginRight:6}}/>
                    Require story point estimate before moving to In Progress
                  </label>
                </div>
                <div className="jb-form-group">
                  <label>
                    <input type="checkbox" checked={!!cfg.requireAssignee}
                      onChange={e=>set("requireAssignee",e.target.checked)}
                      style={{marginRight:6}}/>
                    Require assignee before moving to In Progress
                  </label>
                </div>
                <div className="jb-form-group">
                  <label>
                    <input type="checkbox" checked={!!cfg.blockAfterWip}
                      onChange={e=>set("blockAfterWip",e.target.checked)}
                      style={{marginRight:6}}/>
                    Block drag when WIP limit is reached (vs just warn)
                  </label>
                </div>
                <div className="jb-form-group">
                  <label>
                    <input type="checkbox" checked={!!cfg.autoCloseSprint}
                      onChange={e=>set("autoCloseSprint",e.target.checked)}
                      style={{marginRight:6}}/>
                    Auto-complete sprint when all issues are Done
                  </label>
                </div>
              </div>
            </div>

          </div>
        </div>

        <div className="jb-modal-footer">
          <button className="jb-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="jb-btn-primary" onClick={handleSave}>Save configuration</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SPRINT COMPLETE MODAL
   ═══════════════════════════════════════════════════════════════════ */
function CompleteSprintModal({ sprint, unfinished, config, nextSprint, onComplete, onClose }) {
  const [dest, setDest] = useState(config.unfinishedWork||"backlog");
  const [retroWent,  setRetroWent]  = useState("");
  const [retroImprove, setRetroImprove] = useState("");
  const [retroAction, setRetroAction] = useState("");
  const [step, setStep] = useState(1); // 1=unfinished, 2=retro, 3=confirm

  const handleComplete = () => onComplete(sprint, dest, {
    wentWell:retroWent, toImprove:retroImprove, actionItems:retroAction
  });

  return (
    <div className="jb-modal-overlay" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }}>
      <div className="jb-modal" style={{maxWidth:540}} onClick={e=>e.stopPropagation()} role="presentation">
        <div className="jb-modal-header">
          <span style={{fontWeight:800}}>✅ Complete Sprint — {sprint?.name}</span>
          <button className="jb-modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{padding:"20px 24px",display:"flex",flexDirection:"column",gap:16}}>
          {/* Step indicator */}
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
            {[1,2,3].map(s=>(
              <span key={s} style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{
                  width:24,height:24,borderRadius:"50%",display:"flex",
                  alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,
                  background:step>=s?"var(--brand-700)":"var(--gray-100)",
                  color:step>=s?"#fff":"var(--gray-400)",
                }}>{ s}</span>
                <span style={{fontSize:11,color:"#64748b"}}>
                  {["Unfinished","Retrospective","Confirm"][s-1]}
                </span>
                {s<3 && <span style={{color:"#e2e8f0"}}>→</span>}
              </span>
            ))}
          </div>

          {step===1 && (
            <>
              <div style={{fontWeight:700,fontSize:14}}>
                {unfinished.length} unfinished {unfinished.length===1?"issue":"issues"}
              </div>
              {unfinished.length>0 && (
                <>
                  <div style={{maxHeight:160,overflowY:"auto",display:"flex",
                    flexDirection:"column",gap:4}}>
                    {unfinished.map(t=>(
                      <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,
                        padding:"5px 8px",background:"var(--gray-50)",borderRadius:6,fontSize:12}}>
                        <span>{TYPE_META[t.taskType||"TASK"]?.icon}</span>
                        <span style={{flex:1}}>{t.title}</span>
                        {t.storyPoints && <span className="jb-story-points">{t.storyPoints}</span>}
                      </div>
                    ))}
                  </div>
                  <div className="jb-form-group">
                    <label htmlFor={"jira-board-move-unfinished-issues-to"}>Move unfinished issues to</label>
                    <select value={dest} onChange={e=>setDest(e.target.value)} id={"jira-board-move-unfinished-issues-to"}>
                      <option value="backlog">Backlog</option>
                      {nextSprint && <option value="next">Next Sprint — {nextSprint.name}</option>}
                    </select>
                  </div>
                </>
              )}
              <div style={{display:"flex",justifyContent:"flex-end"}}>
                <button className="jb-btn-primary" onClick={()=>setStep(2)}>Next →</button>
              </div>
            </>
          )}

          {step===2 && (
            <>
              <div style={{fontWeight:700,fontSize:14}}>Sprint Retrospective</div>
              <div className="jb-form-group">
                <label htmlFor={"jira-board-what-went-well"}>✅ What went well?</label>
                <textarea className="jb-desc-editor" rows={3} value={retroWent}
                  onChange={e=>setRetroWent(e.target.value)}
                  placeholder="Things the team did well this sprint..." id={"jira-board-what-went-well"}/>
              </div>
              <div className="jb-form-group">
                <label htmlFor={"jira-board-what-could-be-improved"}>🔧 What could be improved?</label>
                <textarea className="jb-desc-editor" rows={3} value={retroImprove}
                  onChange={e=>setRetroImprove(e.target.value)}
                  placeholder="Areas for improvement..." id={"jira-board-what-could-be-improved"}/>
              </div>
              <div className="jb-form-group">
                <label htmlFor={"jira-board-action-items-for-next-sprint"}>🎯 Action items for next sprint</label>
                <textarea className="jb-desc-editor" rows={2} value={retroAction}
                  onChange={e=>setRetroAction(e.target.value)}
                  placeholder="Concrete actions to take..." id={"jira-board-action-items-for-next-sprint"}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <button className="jb-btn-secondary" onClick={()=>setStep(1)}>← Back</button>
                <button className="jb-btn-primary" onClick={()=>setStep(3)}>Next →</button>
              </div>
            </>
          )}

          {step===3 && (
            <>
              <div style={{fontWeight:700,fontSize:14}}>Confirm completion</div>
              <div style={{padding:14,background:"rgba(16,185,129,0.06)",
                border:"1px solid rgba(16,185,129,0.2)",borderRadius:10,fontSize:13,
                lineHeight:1.6}}>
                <div>Sprint <strong>{sprint?.name}</strong> will be marked <strong>COMPLETED</strong>.</div>
                {unfinished.length>0 && (
                  <div style={{marginTop:4}}>
                    {unfinished.length} unfinished issue{unfinished.length>1?"s":""} will move to{" "}
                    <strong>{dest==="next"?`next sprint (${nextSprint?.name})`:"backlog"}</strong>.
                  </div>
                )}
                {retroWent && <div style={{marginTop:4}}>✅ Retrospective notes saved.</div>}
              </div>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <button className="jb-btn-secondary" onClick={()=>setStep(2)}>← Back</button>
                <button className="jb-btn-primary" style={{background:"var(--success)"}}
                  onClick={handleComplete}>
                  Complete Sprint ✓
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   BURNDOWN CHART
   ═══════════════════════════════════════════════════════════════════ */
function BurndownChart({ sprint, tasks, metric }) {
  if (!sprint?.startDate) return (
    <div className="jb-burndown-empty">Sprint not yet started — burndown will appear here.</div>
  );

  const sprintTasks = tasks.filter(t=>t.sprintId===sprint.id);
  const total = sprintTasks.reduce((s,t)=>s+(metric==="storyPoints"?(t.storyPoints||0):1),0);
  const done  = sprintTasks.filter(t=>t.status==="DONE")
    .reduce((s,t)=>s+(metric==="storyPoints"?(t.storyPoints||0):1),0);

  const start = new Date(sprint.startDate);
  const end   = sprint.endDate ? new Date(sprint.endDate)
    : new Date(start.getTime() + 14*24*60*60*1000);
  const totalDays = Math.ceil((end-start)/(1000*60*60*24));
  const elapsed   = Math.min(Math.ceil((new Date()-start)/(1000*60*60*24)), totalDays);

  // Ideal burn line + actual points
  const points = [];
  for (let d=0; d<=totalDays; d++) {
    const ideal = total - (total/totalDays)*d;
    const actual = d<=elapsed
      ? (d===elapsed ? total-done : null)
      : null;
    points.push({ d, ideal:Math.max(0,ideal), actual });
  }

  const W=500, H=200, PAD=40;
  const xScale = d => PAD + (d/totalDays)*(W-PAD*2);
  const yScale = v => H-PAD - (v/Math.max(total,1))*(H-PAD*1.5);

  const idealPath = points.map((p,i)=>`${i===0?"M":"L"}${xScale(p.d)},${yScale(p.ideal)}`).join(" ");
  const actualPts = points.filter(p=>p.actual!=null);
  const actualPath= actualPts.map((p,i)=>`${i===0?"M":"L"}${xScale(p.d)},${yScale(p.actual)}`).join(" ");

  const pct = total>0 ? Math.round(done/total*100) : 0;
  const remaining = total-done;

  return (
    <div className="jb-burndown-card">
      <div className="jb-burndown-header">
        <div>
          <div className="jb-burndown-title">📉 Burndown Chart</div>
          <div className="jb-burndown-sub">
            {done}/{total} {metric==="storyPoints"?"SP":"issues"} done · {remaining} remaining
          </div>
        </div>
        <div className="jb-burndown-pct">{pct}%</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="jb-burndown-svg">
        {/* Grid lines */}
        {[0,0.25,0.5,0.75,1].map(f=>(
          <line key={f} x1={PAD} x2={W-PAD}
            y1={yScale(total*f)} y2={yScale(total*f)}
            stroke="var(--border)" strokeWidth={0.5} strokeDasharray="4,4"/>
        ))}
        {/* Ideal line */}
        <path d={idealPath} fill="none" stroke="var(--gray-400)" strokeWidth={1.5}
          strokeDasharray="5,4"/>
        {/* Actual line */}
        {actualPath && (
          <path d={actualPath} fill="none" stroke="var(--brand-700)" strokeWidth={2.5}
            strokeLinecap="round" strokeLinejoin="round"/>
        )}
        {/* Today marker */}
        <line x1={xScale(elapsed)} x2={xScale(elapsed)} y1={PAD} y2={H-PAD}
          stroke="var(--danger)" strokeWidth={1} strokeDasharray="3,3"/>
        {/* Labels */}
        <text x={PAD} y={H-8} fontSize={9} fill="var(--gray-400)">
          {new Date(start).toLocaleDateString("en-GB",{day:"2-digit",month:"short"})}
        </text>
        <text x={W-PAD} y={H-8} fontSize={9} fill="var(--gray-400)" textAnchor="end">
          {new Date(end).toLocaleDateString("en-GB",{day:"2-digit",month:"short"})}
        </text>
        <text x={xScale(elapsed)+3} y={PAD+10} fontSize={9} fill="var(--danger)">Today</text>
        <text x={W-PAD} y={yScale(0)+4} fontSize={9} fill="var(--gray-400)" textAnchor="end">Ideal</text>
      </svg>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   VELOCITY CHART
   ═══════════════════════════════════════════════════════════════════ */
function VelocityChart({ sprints, tasks, metric }) {
  const completed = sprints.filter(s=>s.status==="COMPLETED").slice(-8);
  if (completed.length===0) return (
    <div className="jb-burndown-empty">Complete sprints to see velocity history.</div>
  );

  const data = completed.map(s=>{
    const st = tasks.filter(t=>t.sprintId===s.id);
    const committed = st.reduce((sum,t)=>sum+(metric==="storyPoints"?(t.storyPoints||0):1),0);
    const done      = st.filter(t=>t.status==="DONE")
      .reduce((sum,t)=>sum+(metric==="storyPoints"?(t.storyPoints||0):1),0);
    return { name:s.name, committed, done };
  });
  const avg = Math.round(data.reduce((s,d)=>s+d.done,0)/data.length);
  const max = Math.max(...data.map(d=>Math.max(d.committed,d.done)),1);

  return (
    <div className="jb-burndown-card">
      <div className="jb-burndown-header">
        <div>
          <div className="jb-burndown-title">📈 Velocity</div>
          <div className="jb-burndown-sub">Avg {avg} {metric==="storyPoints"?"SP":"issues"}/sprint</div>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"flex-end",gap:8,padding:"8px 0",height:130}}>
        {data.map((d,i)=>(
          <div key={i} style={{flex:1,display:"flex",flexDirection:"column",
            alignItems:"center",gap:2,height:"100%",justifyContent:"flex-end"}}>
            <div style={{fontSize:9,color:"#94a3b8",fontWeight:700}}>{d.done}</div>
            <div style={{width:"60%",background:"var(--brand-700)",borderRadius:"3px 3px 0 0",
              height:`${(d.done/max)*100}%`,minHeight:2,transition:"height .3s"}}/>
            <div style={{width:"80%",background:"rgba(99,102,241,0.2)",borderRadius:"3px 3px 0 0",
              height:`${(d.committed/max)*100}%`,minHeight:2,position:"absolute",
              bottom:16,opacity:.6}}/>
            <div style={{fontSize:8,color:"#94a3b8",textAlign:"center",
              overflow:"hidden",width:"100%"}}>
              {d.name.replace("Sprint ","S")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ISSUE CARD (draggable)
   ═══════════════════════════════════════════════════════════════════ */
function IssueCard({ task, onClick, compact, cardColor, spScale }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useDraggable({ id: task.id });
  const style = {
    transform:CSS.Transform.toString(transform), transition,
    opacity:isDragging?0.35:1, cursor:isDragging?"grabbing":"grab",
  };
  const pri = PRIORITY_META[task.priority] || PRIORITY_META.MEDIUM;
  const typ = TYPE_META[task.taskType||"TASK"];
  const sp  = task.storyPoints;
  const TSHIRT_LABELS = { 1:"XS", 2:"S", 3:"M", 5:"L", 8:"XL" };
  const spLabel = spScale === "tshirt" ? (TSHIRT_LABELS[sp] || sp) : sp;

  // Left border colour by config
  const leftColor = cardColor==="priority" ? pri.color
    : cardColor==="type"     ? typ.color
    : cardColor==="epic"     ? "var(--warning)"
    : "transparent";

  return (
    <div ref={setNodeRef} style={{...style, borderLeft:leftColor!=="transparent"?`3px solid ${leftColor}`:undefined}}
      {...listeners} {...attributes}
      className={"jb-card"+(isDragging?" jb-card-dragging":"")+(compact?" jb-card-compact":"")}
      onClick={e=>{ e.stopPropagation(); onClick(task); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (e=>{ e.stopPropagation(); onClick(task); })?.(e); } }}>
      <div className="jb-card-meta">
        <span className="jb-type-badge" style={{color:typ.color}} title={typ.label}>{typ.icon}</span>
        {task.epicName && <span className="jb-epic-tag">{task.epicName}</span>}
        <span style={{flex:1}}/>
        <span className="jb-pri-badge" title={pri.label} style={{color:pri.color}}>{pri.icon}</span>
      </div>
      <div className="jb-card-title">{task.title}</div>
      {task.labels?.length>0 && (
        <div className="jb-card-labels">
          {task.labels.slice(0,3).map(l=><span key={l} className="jb-label">{l}</span>)}
        </div>
      )}
      <div className="jb-card-footer">
        <span className="jb-issue-key">{task.issueKey||`PROJ-${task.id?.slice(-4)?.toUpperCase()}`}</span>
        {sp!=null && <span className="jb-story-points">{spLabel}</span>}
        {task.assigneeIds?.[0] && (
          <div className="jb-avatar" title={task.assigneeIds[0]}>
            {task.assigneeIds[0].slice(0,2).toUpperCase()}
          </div>
        )}
        {task.dueDate && (
          <span className={"jb-due"+(new Date(task.dueDate)<new Date()?" jb-due-overdue":"")}>
            {new Date(task.dueDate).toLocaleDateString("en-GB",{day:"2-digit",month:"short"})}
          </span>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   BOARD COLUMN (droppable)
   ═══════════════════════════════════════════════════════════════════ */
function BoardColumn({ col, tasks, onCardClick, onAddCard, compact, cardColor, spScale }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const isWipViolation = col.wipLimit && tasks.length > col.wipLimit;
  const totalSP = tasks.reduce((s,t)=>s+(t.storyPoints||0),0);
  return (
    <div className="jb-column">
      <div className="jb-col-header" style={{borderTop:`3px solid ${col.color}`}}>
        <span className="jb-col-dot" style={{background:col.color}}/>
        <span className="jb-col-label" style={{color:col.color}}>{col.label}</span>
        <span className={"jb-col-count"+(isWipViolation?" jb-wip-over":"")}
          style={{background:col.bg,color:col.color}}>
          {tasks.length}{col.wipLimit?`/${col.wipLimit}`:""}
        </span>
        {totalSP>0 && <span className="jb-col-sp">{totalSP}SP</span>}
      </div>
      <div ref={setNodeRef}
        className={"jb-col-body"+(isOver?" jb-col-over":"")+(isWipViolation?" jb-col-wip-violation":"")}>
        {tasks.length===0 && <div className="jb-col-empty">Drop issues here</div>}
        {tasks.map(t=>(
          <IssueCard key={t.id} task={t} onClick={onCardClick}
            compact={compact} cardColor={cardColor} spScale={spScale}/>
        ))}
      </div>
      <button className="jb-add-btn" onClick={()=>onAddCard(col.id)}>+ Add issue</button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ISSUE DETAIL MODAL
   ═══════════════════════════════════════════════════════════════════ */
function IssueModal({ task, projects, epics, sprints, members, spScale, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({...task});
  const [saving, setSaving] = useState(false);
  const [tab, setTab]   = useState("details");
  const [newLabel, setNewLabel] = useState("");
  const set = (k,v) => setForm(p=>({...p,[k]:v}));
  const sp = STORY_POINT_SCALE[spScale||"fibonacci"];

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <div className="jb-modal-overlay" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }}>
      <div className="jb-modal" onClick={e=>e.stopPropagation()} role="presentation">
        <div className="jb-modal-header">
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:16,color:TYPE_META[form.taskType||"TASK"].color}}>
              {TYPE_META[form.taskType||"TASK"].icon}
            </span>
            <span className="jb-modal-key">
              {form.issueKey||`PROJ-${form.id?.slice(-4)?.toUpperCase()}`}
            </span>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="jb-btn-danger-sm" onClick={()=>onDelete(form.id)}>Delete</button>
            <button className="jb-modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="jb-modal-body">
          <div className="jb-modal-left">
            <textarea className="jb-modal-title-input" value={form.title||""}
              onChange={e=>set("title",e.target.value)} rows={2} placeholder="Issue title"/>
            <div className="jb-modal-tabs">
              {["details","description","subtasks"].map(t=>(
                <button key={t} className={"jb-modal-tab"+(tab===t?" active":"")}
                  onClick={()=>setTab(t)}>
                  {t.charAt(0).toUpperCase()+t.slice(1)}
                </button>
              ))}
            </div>
            {tab==="details" && (
              <div className="jb-modal-section">
                <div className="jb-form-grid">
                  <div className="jb-form-group">
                    <label htmlFor={"jira-board-type"}>Type</label>
                    <select value={form.taskType||"TASK"} onChange={e=>set("taskType",e.target.value)} id={"jira-board-type"}>
                      {Object.entries(TYPE_META).map(([k,v])=>(
                        <option key={k} value={k}>{v.icon} {v.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="jb-form-group">
                    <label htmlFor={"jira-board-status"}>Status</label>
                    <select value={form.status||"TODO"} onChange={e=>set("status",e.target.value)} id={"jira-board-status"}>
                      <option value="TODO">To Do</option>
                      <option value="IN_PROGRESS">In Progress</option>
                      <option value="IN_REVIEW">In Review</option>
                      <option value="DONE">Done</option>
                    </select>
                  </div>
                  <div className="jb-form-group">
                    <label htmlFor={"jira-board-priority"}>Priority</label>
                    <select value={form.priority||"MEDIUM"} onChange={e=>set("priority",e.target.value)} id={"jira-board-priority"}>
                      {Object.entries(PRIORITY_META).map(([k,v])=>(
                        <option key={k} value={k}>{v.icon} {v.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="jb-form-group">
                    <label htmlFor={"jira-board-story-points"}>Story Points</label>
                    <select value={form.storyPoints||""} onChange={e=>set("storyPoints",e.target.value?Number(e.target.value):null)} id={"jira-board-story-points"}>
                      <option value="">–</option>
                      {sp.map(n=><option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div className="jb-form-group">
                    <label htmlFor={"jira-board-sprint"}>Sprint</label>
                    <select value={form.sprintId||""} onChange={e=>set("sprintId",e.target.value||null)} id={"jira-board-sprint"}>
                      <option value="">Backlog</option>
                      {sprints.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="jb-form-group">
                    <label htmlFor={"jira-board-epic"}>Epic</label>
                    <select value={form.epicId||""} onChange={e=>set("epicId",e.target.value||null)} id={"jira-board-epic"}>
                      <option value="">None</option>
                      {epics.map(e=><option key={e.id} value={e.id}>{e.title||e.name}</option>)}
                    </select>
                  </div>
                  <div className="jb-form-group">
                    <label htmlFor={"jira-board-assignee"}>Assignee</label>
                    <select value={form.assigneeIds?.[0]||""} onChange={e=>set("assigneeIds",e.target.value?[e.target.value]:[])} id={"jira-board-assignee"}>
                      <option value="">Unassigned</option>
                      {members.map(m=><option key={m.id||m.email} value={m.email||m.id}>{m.name||m.email}</option>)}
                    </select>
                  </div>
                  <div className="jb-form-group">
                    <label htmlFor={"jira-board-due-date"}>Due Date</label>
                    <input type="date" value={form.dueDate?form.dueDate.slice(0,10):""}
                      onChange={e=>set("dueDate",e.target.value?e.target.value+"T00:00:00":null)} id={"jira-board-due-date"}/>
                  </div>
                  <div className="jb-form-group">
                    <label htmlFor={"jira-board-project"}>Project</label>
                    <select value={form.projectId||""} onChange={e=>set("projectId",e.target.value||null)} id={"jira-board-project"}>
                      <option value="">None</option>
                      {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="jb-form-group">
                    <label htmlFor={"jira-board-story-points-original-estimate"}>Story Points (original estimate)</label>
                    <input type="number" min="0" value={form.originalEstimate||""}
                      onChange={e=>set("originalEstimate",e.target.value?Number(e.target.value):null)}
                      placeholder="–" id={"jira-board-story-points-original-estimate"}/>
                  </div>
                </div>
                <div className="jb-form-group" style={{marginTop:8}}>
                  <label htmlFor={"jira-board-labels"}>Labels</label>
                  <div className="jb-label-editor">
                    {(form.labels||[]).map(l=>(
                      <span key={l} className="jb-label jb-label-removable">
                        {l}
                        <button onClick={()=>set("labels",(form.labels||[]).filter(x=>x!==l))}>×</button>
                      </span>
                    ))}
                    <input className="jb-label-input" value={newLabel}
                      onChange={e=>setNewLabel(e.target.value)}
                      onKeyDown={e=>{
                        if(e.key==="Enter"&&newLabel.trim()){
                          set("labels",[...(form.labels||[]),newLabel.trim()]);
                          setNewLabel("");
                        }
                      }} placeholder="Add label + Enter" id={"jira-board-labels"}/>
                  </div>
                </div>
              </div>
            )}
            {tab==="description" && (
              <div className="jb-modal-section">
                <textarea className="jb-desc-editor" rows={10} value={form.description||""}
                  onChange={e=>set("description",e.target.value)}
                  placeholder="Add a description..."/>
              </div>
            )}
            {tab==="subtasks" && (
              <div className="jb-modal-section">
                <div style={{color:"#94a3b8",fontSize:13,padding:"16px 0"}}>
                  Subtask management available via the Tasks page for this issue.
                </div>
              </div>
            )}
          </div>
          <div className="jb-modal-right">
            <div className="jb-modal-meta-section">
              <div className="jb-meta-row"><span className="jb-meta-key">Reporter</span><span className="jb-meta-val">{form.createdBy||"—"}</span></div>
              <div className="jb-meta-row"><span className="jb-meta-key">Created</span><span className="jb-meta-val">{form.createdAt?new Date(form.createdAt).toLocaleDateString():"—"}</span></div>
              <div className="jb-meta-row"><span className="jb-meta-key">Updated</span><span className="jb-meta-val">{form.updatedAt?new Date(form.updatedAt).toLocaleDateString():"—"}</span></div>
              <div className="jb-meta-row"><span className="jb-meta-key">Points</span><span className="jb-meta-val">{form.storyPoints??form.originalEstimate??"—"}</span></div>
              <div className="jb-meta-row"><span className="jb-meta-key">Type</span><span className="jb-meta-val">{TYPE_META[form.taskType||"TASK"]?.label}</span></div>
            </div>
          </div>
        </div>
        <div className="jb-modal-footer">
          <button className="jb-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="jb-btn-primary" onClick={handleSave} disabled={saving}>
            {saving?"Saving…":"Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   QUICK CREATE
   ═══════════════════════════════════════════════════════════════════ */
function QuickCreate({ status, projectId, sprintId, onSave, onCancel }) {
  const [title,setTitle]=useState("");
  const [type, setType] =useState("STORY");
  const ref=useRef();
  useEffect(()=>{ref.current?.focus();},[]);
  const submit=()=>{ if(!title.trim()){onCancel();return;} onSave({title:title.trim(),status,taskType:type,projectId,sprintId,priority:"MEDIUM"}); };
  return (
    <div className="jb-quick-create">
      <div style={{display:"flex",gap:6,marginBottom:6}}>
        {Object.entries(TYPE_META).slice(0,4).map(([k,v])=>(
          <button key={k} className={"jb-type-toggle"+(type===k?" active":"")}
            style={type===k?{borderColor:v.color,color:v.color}:{}}
            onClick={()=>setType(k)} title={v.label}>{v.icon}</button>
        ))}
      </div>
      <textarea ref={ref} className="jb-quick-input" rows={2} value={title}
        onChange={e=>setTitle(e.target.value)} placeholder="Issue title..."
        onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submit();}if(e.key==="Escape")onCancel();}}/>
      <div style={{display:"flex",gap:6,marginTop:6}}>
        <button className="jb-btn-primary" style={{fontSize:11,padding:"4px 10px"}} onClick={submit}>Create</button>
        <button className="jb-btn-secondary" style={{fontSize:11,padding:"4px 10px"}} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   BACKLOG ROW
   ═══════════════════════════════════════════════════════════════════ */
function BacklogRow({ task, onEdit, onMoveToSprint, sprints }) {
  const pri=PRIORITY_META[task.priority]||PRIORITY_META.MEDIUM;
  const typ=TYPE_META[task.taskType||"TASK"];
  return (
    <div className="jb-backlog-row" onClick={()=>onEdit(task)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (()=>onEdit(task))?.(e); } }}>
      <span className="jb-type-badge" style={{color:typ.color}}>{typ.icon}</span>
      <span className="jb-issue-key-sm">{task.issueKey||`PROJ-${task.id?.slice(-4)?.toUpperCase()}`}</span>
      <span className="jb-backlog-title">{task.title}</span>
      {task.labels?.slice(0,2).map(l=><span key={l} className="jb-label">{l}</span>)}
      <span style={{flex:1}}/>
      {task.storyPoints!=null&&<span className="jb-story-points">{task.storyPoints}</span>}
      <span className="jb-pri-badge" style={{color:pri.color}}>{pri.icon}</span>
      {sprints.length>0&&(
        <select className="jb-sprint-mover" value="" onClick={e=>e.stopPropagation()}
          onChange={e=>{if(e.target.value)onMoveToSprint(task.id,e.target.value);}}>
          <option value="">→ Sprint</option>
          {sprints.filter(s=>s.status==="PLANNED"||s.status==="ACTIVE").map(s=>(
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════ */
const DEFAULT_CONFIG = {
  columns:DEFAULT_COLUMNS, spScale:"fibonacci", showSP:true,
  sprintDuration:2, autoNumberSprints:true, unfinishedWork:"backlog",
  burndownMetric:"storyPoints", cardColor:"priority", showSubtasks:false,
  backlogGroupBy:"none", archiveDays:0, requireEstimate:false,
  requireAssignee:false, blockAfterWip:false, autoCloseSprint:false,
  disabledTypes:[],
};

export default function JiraBoard() {
  const { activeWorkspace } = useAuth();
  const confirm = useConfirm();
  const { show: showToast } = useToast();

  const [view,         setView]         = useState("board");
  const [tasks,        setTasks]        = useState([]);
  const [sprints,      setSprints]      = useState([]);
  const [projects,     setProjects]     = useState([]);
  const [epics,        setEpics]        = useState([]);
  const [members,      setMembers]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [activeId,     setActiveId]     = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [quickCreate,  setQuickCreate]  = useState(null);
  const [filterSprint, setFilterSprint] = useState("active");
  const [filterProject,setFilterProject]= useState("");
  const [filterType,   setFilterType]   = useState("");
  const [filterPri,    setFilterPri]    = useState("");
  const [filterAssignee,setFilterAssignee]=useState("");
  const [compact,      setCompact]      = useState(false);
  const [showConfig,   setShowConfig]   = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [showNewSprint,setShowNewSprint]= useState(false);
  const [newSprintName,setNewSprintName]= useState("");
  const [config, setConfig] = useState(() => {
    try { return {...DEFAULT_CONFIG,...JSON.parse(localStorage.getItem("jb_config")||"{}")}; }
    catch { return DEFAULT_CONFIG; }
  });

  const sensors = useSensors(useSensor(PointerSensor,{activationConstraint:{distance:6}}));

  const load = async () => {
    setLoading(true);
    try {
      const [tr,sr,pr,er,mr] = await Promise.all([
        getTasks(), getSprints(), getProjects(),
        getEpics(), getMembers(),
      ]);
      setTasks(unwrapList(tr));
      setSprints(unwrapList(sr));
      setProjects(unwrapList(pr));
      setEpics(unwrapList(er));
      setMembers(unwrapList(mr));
    } catch(e){console.error(e);}
    finally{setLoading(false);}
  };

  useEffect(()=>{
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern
    load();
  },[activeWorkspace?.id]);

  /* ── Derived ─────────────────────────────────────────────────── */
  const activeSprint = sprints.find(s=>s.status==="ACTIVE");
  const displayedSprint = filterSprint==="active" ? activeSprint
    : sprints.find(s=>s.id===filterSprint);
  const nextSprint = sprints.find(s=>s.status==="PLANNED");
  const getEpicName = useCallback(id => epics.find(e=>e.id===id)?.title||epics.find(e=>e.id===id)?.name||"", [epics]);

  const getFilteredTasks = useCallback((forBoard=true) => {
    let f = [...tasks];
    if (forBoard && displayedSprint) f=f.filter(t=>t.sprintId===displayedSprint.id);
    else if (forBoard && !displayedSprint) f=f.filter(t=>!t.sprintId);
    if (!forBoard) f=f.filter(t=>!t.sprintId);
    if (filterProject)  f=f.filter(t=>t.projectId===filterProject);
    if (filterType)     f=f.filter(t=>(t.taskType||"TASK")===filterType);
    if (filterPri)      f=f.filter(t=>t.priority===filterPri);
    if (filterAssignee) f=f.filter(t=>t.assigneeIds?.includes(filterAssignee));
    if (config.disabledTypes?.length) f=f.filter(t=>!config.disabledTypes.includes(t.taskType||"TASK"));
    return f.map(t=>({...t,epicName:getEpicName(t.epicId)}));
  },[tasks,displayedSprint,filterProject,filterType,filterPri,filterAssignee,config.disabledTypes,getEpicName]);

  const boardTasks   = getFilteredTasks(true);
  const backlogTasks = getFilteredTasks(false);
  const activeTask   = tasks.find(t=>t.id===activeId);

  const sprintSP  = boardTasks.reduce((s,t)=>s+(t.storyPoints||0),0);
  const doneSP    = boardTasks.filter(t=>t.status==="DONE").reduce((s,t)=>s+(t.storyPoints||0),0);
  const unfinished = displayedSprint
    ? tasks.filter(t=>t.sprintId===displayedSprint.id&&t.status!=="DONE") : [];

  /* ── Drag ─────────────────────────────────────────────────────── */
  const handleDragStart = e=>setActiveId(e.active.id);
  const handleDragEnd = async({active,over}) => {
    setActiveId(null);
    if(!over) return;
    const cols = config.columns||DEFAULT_COLUMNS;
    const newStatus = cols.find(c=>c.id===over.id)?.id
      ||tasks.find(t=>t.id===over.id)?.status;
    if(!newStatus) return;
    const task=tasks.find(t=>t.id===active.id);
    if(!task||task.status===newStatus) return;
    // WIP block check
    if(config.blockAfterWip) {
      const col=cols.find(c=>c.id===newStatus);
      if(col?.wipLimit) {
        const count=boardTasks.filter(t=>t.status===newStatus&&t.id!==active.id).length;
        if(count>=col.wipLimit) { showToast(`WIP limit (${col.wipLimit}) reached for "${col.label}"`, "warning"); return; }
      }
    }
    setTasks(prev=>prev.map(t=>t.id===active.id?{...t,status:newStatus}:t));
    try { await updateTask(active.id,{...task,status:newStatus}); }
    catch { await load(); }
  };

  /* ── CRUD ─────────────────────────────────────────────────────── */
  const handleQuickCreate = async(data) => {
    setQuickCreate(null);
    try {
      const r=await createTask({...data,sprintId:displayedSprint?.id||null});
      setTasks(prev=>[r.data,...prev]);
    }catch(e){console.error(e);}
  };

  const handleSaveIssue = async(form) => {
    try {
      const r=await updateTask(form.id,form);
      setTasks(prev=>prev.map(t=>t.id===form.id?r.data:t));
      setSelectedTask(null);
    }catch(e){console.error(e);}
  };

  const handleDeleteIssue = async(id) => {
    if(!(await confirm({ title: "Delete this issue?", danger: true, confirmText: "Delete" }))) return;
    try {
      await deleteTask(id);
      setTasks(prev=>prev.filter(t=>t.id!==id));
      setSelectedTask(null);
    }catch(e){console.error(e);}
  };

  const handleMoveToSprint = async(taskId,sprintId) => {
    const task=tasks.find(t=>t.id===taskId);
    if(!task) return;
    try {
      const r=await updateTask(taskId,{...task,sprintId});
      setTasks(prev=>prev.map(t=>t.id===taskId?r.data:t));
    }catch(e){console.error(e);}
  };

  const handleCreateSprint = async() => {
    if(!newSprintName.trim()) return;
    const num = sprints.filter(s=>s.status!=="CANCELLED").length+1;
    const name = config.autoNumberSprints ? `Sprint ${num}` : newSprintName.trim();
    try {
      const r=await createSprint({name,status:"PLANNED",duration:config.sprintDuration});
      setSprints(prev=>[...prev,r.data]);
      setNewSprintName(""); setShowNewSprint(false);
    }catch(e){console.error(e);}
  };

  const handleStartSprint = async(sprint) => {
    if(!(await confirm({ title: `Start "${sprint.name}"?`, confirmText: "Start sprint" }))) return;
    const start=new Date();
    const end=new Date(start.getTime()+config.sprintDuration*7*24*60*60*1000);
    try {
      const r=await updateSprint(sprint.id,{...sprint,status:"ACTIVE",
        startDate:start.toISOString(),endDate:end.toISOString()});
      setSprints(prev=>prev.map(s=>s.id===sprint.id?r.data:s));
    }catch(e){console.error(e);}
  };

  const handleCompleteSprint = async(sprint, dest, retro) => {
    try {
      // Save retro notes
      if(retro.wentWell||retro.toImprove||retro.actionItems) {
        await saveRetro(sprint.id,retro).catch(()=>{});
      }
      // Move unfinished tasks
      const unfinishedIds=tasks.filter(t=>t.sprintId===sprint.id&&t.status!=="DONE").map(t=>t.id);
      if(dest==="backlog") {
        await Promise.all(unfinishedIds.map(id=>
          updateTask(id,{...tasks.find(t=>t.id===id),sprintId:null})
        ));
      } else if(dest==="next"&&nextSprint) {
        await Promise.all(unfinishedIds.map(id=>
          updateTask(id,{...tasks.find(t=>t.id===id),sprintId:nextSprint.id})
        ));
      }
      const r=await updateSprint(sprint.id,{...sprint,status:"COMPLETED"});
      setSprints(prev=>prev.map(s=>s.id===sprint.id?r.data:s));
      setTasks(prev=>prev.map(t=>
        unfinishedIds.includes(t.id)?{...t,sprintId:dest==="next"&&nextSprint?nextSprint.id:null}:t
      ));
      setShowComplete(false);
    }catch(e){console.error(e);}
  };

  const handleSaveConfig = (newConfig) => {
    setConfig(newConfig);
    try{localStorage.setItem("jb_config",JSON.stringify(newConfig));}catch{ /* storage full/unavailable — config still applied in-memory */ }
    setShowConfig(false);
  };

  const cols = config.columns || DEFAULT_COLUMNS;

  if(loading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"60vh"}}>
      <div className="spinner"/>
    </div>
  );

  return (
    <div className="jb-root">
      <PageHeader title="Jira Board" subtitle="Sprint board · Backlog · Agile metrics"/>

      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="jb-toolbar">
        <div className="jb-view-tabs">
          {[["board","📋 Board"],["backlog","📑 Backlog"],["metrics","📊 Metrics"]].map(([v,l])=>(
            <button key={v} className={"jb-view-tab"+(view===v?" active":"")}
              onClick={()=>setView(v)}>{l}</button>
          ))}
        </div>
        <div style={{flex:1}}/>
        {/* Sprint selector */}
        <select className="jb-filter-select" value={filterSprint}
          onChange={e=>setFilterSprint(e.target.value)}>
          <option value="active">Active{activeSprint?` — ${activeSprint.name}`:""}</option>
          {sprints.map(s=><option key={s.id} value={s.id}>{s.name} ({statusText(s.status)})</option>)}
        </select>
        {/* Filters */}
        <select className="jb-filter-select" value={filterProject}
          onChange={e=>setFilterProject(e.target.value)}>
          <option value="">All projects</option>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="jb-filter-select" value={filterType}
          onChange={e=>setFilterType(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(TYPE_META).map(([k,v])=>(
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
        <select className="jb-filter-select" value={filterPri}
          onChange={e=>setFilterPri(e.target.value)}>
          <option value="">All priorities</option>
          {Object.entries(PRIORITY_META).map(([k,v])=>(
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
        <select className="jb-filter-select" value={filterAssignee}
          onChange={e=>setFilterAssignee(e.target.value)}>
          <option value="">All assignees</option>
          {members.map(m=><option key={m.id||m.email} value={m.email||m.id}>{m.name||m.email}</option>)}
        </select>
        {/* Toolbar actions */}
        <button className={"jb-icon-btn"+(compact?" active":"")}
          onClick={()=>setCompact(c=>!c)} title="Compact view">⊟</button>
        <button className="jb-icon-btn" onClick={()=>setShowConfig(true)} title="Configure board">⚙️</button>
        <button className="jb-btn-primary" onClick={()=>setQuickCreate({status:"TODO"})}>
          + Create issue
        </button>
      </div>

      {/* ── Sprint bar ───────────────────────────────────────────── */}
      {displayedSprint && (view==="board"||view==="backlog") && (
        <div className="jb-sprint-bar">
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span className="jb-sprint-name">{displayedSprint.name}</span>
            <span className={"jb-sprint-badge jb-sprint-"+displayedSprint.status.toLowerCase()}>
              {statusText(displayedSprint.status)}
            </span>
            {displayedSprint.endDate && (
              <span style={{fontSize:11,color:"#94a3b8"}}>
                Ends {new Date(displayedSprint.endDate).toLocaleDateString("en-GB",{day:"2-digit",month:"short"})}
              </span>
            )}
          </div>
          <div className="jb-sprint-stats">
            <span>{boardTasks.length} issues</span>
            <span>·</span>
            <span>{doneSP}/{sprintSP} SP</span>
            {sprintSP>0 && (
              <div className="jb-sprint-progress">
                <div className="jb-sprint-progress-bar"
                  style={{width:`${Math.round(doneSP/sprintSP*100)}%`}}/>
              </div>
            )}
            {displayedSprint.status==="PLANNED" && (
              <button className="jb-btn-start-sprint"
                onClick={()=>handleStartSprint(displayedSprint)}>
                ▶ Start Sprint
              </button>
            )}
            {displayedSprint.status==="ACTIVE" && (
              <button className="jb-btn-start-sprint"
                style={{background:"var(--success)"}}
                onClick={()=>setShowComplete(true)}>
                ✓ Complete Sprint
              </button>
            )}
          </div>
        </div>
      )}

      {/* ══ BOARD VIEW ══════════════════════════════════════════════ */}
      {view==="board" && (
        <DndContext sensors={sensors} collisionDetection={closestCorners}
          onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="jb-board" style={{gridTemplateColumns:`repeat(${cols.length},1fr)`}}>
            {cols.map(col => {
              const colTasks=boardTasks.filter(t=>t.status===col.id);
              return (
                <BoardColumn key={col.id} col={col} tasks={colTasks} compact={compact}
                  cardColor={config.cardColor} spScale={config.spScale}
                  onCardClick={setSelectedTask}
                  onAddCard={status=>setQuickCreate({status})}/>
              );
            })}
          </div>
          {quickCreate && (
            <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",
              zIndex:500,width:340}}>
              <QuickCreate status={quickCreate.status}
                projectId={filterProject||null} sprintId={displayedSprint?.id||null}
                onSave={handleQuickCreate} onCancel={()=>setQuickCreate(null)}/>
            </div>
          )}
          <DragOverlay>
            {activeTask&&<IssueCard task={activeTask} onClick={()=>{}} compact={compact}
              cardColor={config.cardColor} spScale={config.spScale}/>}
          </DragOverlay>
        </DndContext>
      )}

      {/* ══ BACKLOG VIEW ════════════════════════════════════════════ */}
      {view==="backlog" && (
        <div className="jb-backlog">
          {sprints.map(sprint=>{
            const st=tasks.filter(t=>t.sprintId===sprint.id);
            if(st.length===0) return null;
            const sp=st.reduce((s,t)=>s+(t.storyPoints||0),0);
            return (
              <div key={sprint.id} className="jb-backlog-section">
                <div className="jb-backlog-section-header">
                  <span className="jb-sprint-name">{sprint.name}</span>
                  <span className={"jb-sprint-badge jb-sprint-"+sprint.status.toLowerCase()}>
                    {statusText(sprint.status)}
                  </span>
                  <span className="jb-backlog-count">{st.length} issues · {sp} SP</span>
                  <span style={{flex:1}}/>
                  {sprint.status==="PLANNED"&&(
                    <button className="jb-btn-start-sprint" onClick={()=>handleStartSprint(sprint)}>
                      ▶ Start
                    </button>
                  )}
                  {sprint.status==="ACTIVE"&&(
                    <button className="jb-btn-start-sprint" style={{background:"var(--success)"}}
                      onClick={()=>{setFilterSprint(sprint.id);setShowComplete(true);}}>
                      ✓ Complete
                    </button>
                  )}
                </div>
                {st.map(t=>(
                  <BacklogRow key={t.id} task={{...t,epicName:getEpicName(t.epicId)}}
                    onEdit={setSelectedTask} onMoveToSprint={handleMoveToSprint} sprints={sprints}/>
                ))}
              </div>
            );
          })}
          {/* Backlog */}
          <div className="jb-backlog-section">
            <div className="jb-backlog-section-header">
              <span className="jb-sprint-name" style={{color:"#475569"}}>Backlog</span>
              <span className="jb-backlog-count">{backlogTasks.length} issues</span>
              <span style={{flex:1}}/>
              <button className="jb-btn-secondary" style={{fontSize:12}}
                onClick={()=>setShowNewSprint(true)}>+ Create sprint</button>
            </div>
            {backlogTasks.length===0&&(
              <div className="jb-backlog-empty">Backlog is empty. All issues are in sprints.</div>
            )}
            {backlogTasks.map(t=>(
              <BacklogRow key={t.id} task={t} onEdit={setSelectedTask}
                onMoveToSprint={handleMoveToSprint} sprints={sprints}/>
            ))}
            <button className="jb-backlog-add-btn" onClick={()=>setQuickCreate({status:"TODO"})}>
              + Create issue
            </button>
          </div>
          {/* Create sprint modal */}
          {showNewSprint&&(
            <div className="jb-modal-overlay" onClick={()=>setShowNewSprint(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (()=>setShowNewSprint(false))?.(e); } }}>
              <div className="jb-mini-modal" onClick={e=>e.stopPropagation()} role="presentation">
                <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>Create Sprint</div>
                {config.autoNumberSprints
                  ? <div style={{padding:"10px 14px",background:"var(--gray-50)",borderRadius:8,fontSize:13}}>
                      Will be named: <strong>Sprint {sprints.filter(s=>s.status!=="CANCELLED").length+1}</strong>
                    </div>
                  : <input className="jb-quick-input" value={newSprintName}
                      onChange={e=>setNewSprintName(e.target.value)}
                      placeholder="Sprint name"
                      onKeyDown={e=>e.key==="Enter"&&handleCreateSprint()}/>
                }
                <div style={{display:"flex",gap:8,marginTop:12}}>
                  <button className="jb-btn-secondary" onClick={()=>setShowNewSprint(false)}>Cancel</button>
                  <button className="jb-btn-primary" onClick={handleCreateSprint}>Create</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ METRICS VIEW ════════════════════════════════════════════ */}
      {view==="metrics" && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,padding:"4px 0",overflowY:"auto"}}>
          <BurndownChart sprint={displayedSprint} tasks={tasks}
            metric={config.burndownMetric}/>
          <VelocityChart sprints={sprints} tasks={tasks}
            metric={config.burndownMetric}/>
          {/* Sprint summary cards */}
          <div className="jb-burndown-card">
            <div className="jb-burndown-header">
              <div>
                <div className="jb-burndown-title">📋 Sprint Summary</div>
                <div className="jb-burndown-sub">{displayedSprint?.name||"No active sprint"}</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:8}}>
              {[
                {l:"Total Issues",  v:boardTasks.length,      c:"var(--brand-500)"},
                {l:"Done",          v:boardTasks.filter(t=>t.status==="DONE").length, c:"var(--success)"},
                {l:"In Progress",   v:boardTasks.filter(t=>t.status==="IN_PROGRESS").length, c:"#3b82f6"},
                {l:"Story Points",  v:`${doneSP}/${sprintSP}`, c:"var(--warning)"},
                {l:"Stories",       v:boardTasks.filter(t=>t.taskType==="STORY").length, c:"var(--success)"},
                {l:"Bugs",          v:boardTasks.filter(t=>t.taskType==="BUG").length,   c:"var(--danger)"},
              ].map(m=>(
                <div key={m.l} style={{padding:"10px 12px",background:"var(--gray-50)",
                  borderRadius:8,textAlign:"center",border:`1px solid ${m.c}22`}}>
                  <div style={{fontSize:22,fontWeight:900,color:m.c}}>{m.v}</div>
                  <div style={{fontSize:10,color:"#64748b",marginTop:2}}>{m.l}</div>
                </div>
              ))}
            </div>
          </div>
          {/* Issue type breakdown */}
          <div className="jb-burndown-card">
            <div className="jb-burndown-header">
              <div>
                <div className="jb-burndown-title">🏷 Issue Breakdown</div>
                <div className="jb-burndown-sub">By type across all sprints</div>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:8}}>
              {Object.entries(TYPE_META).map(([k,v])=>{
                const count=tasks.filter(t=>(t.taskType||"TASK")===k).length;
                const pct=tasks.length>0?Math.round(count/tasks.length*100):0;
                return (
                  <div key={k} style={{display:"flex",alignItems:"center",gap:8,fontSize:12}}>
                    <span>{v.icon}</span>
                    <span style={{width:80,color:"#475569"}}>{v.label}</span>
                    <div style={{flex:1,height:6,background:"var(--gray-100)",borderRadius:99}}>
                      <div style={{height:"100%",background:v.color,borderRadius:99,
                        width:`${pct}%`,transition:"width .3s"}}/>
                    </div>
                    <span style={{fontWeight:700,color:"#334155",minWidth:20}}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────── */}
      {showConfig && (
        <BoardConfigModal config={config} onSave={handleSaveConfig}
          onClose={()=>setShowConfig(false)}/>
      )}
      {showComplete && displayedSprint && (
        <CompleteSprintModal sprint={displayedSprint} unfinished={unfinished}
          config={config} nextSprint={nextSprint}
          onComplete={handleCompleteSprint} onClose={()=>setShowComplete(false)}/>
      )}
      {selectedTask && (
        <IssueModal task={selectedTask} projects={projects} epics={epics}
          sprints={sprints} members={members} spScale={config.spScale}
          onSave={handleSaveIssue} onDelete={handleDeleteIssue}
          onClose={()=>setSelectedTask(null)}/>
      )}
    </div>
  );
}
