import { useState } from "react";
import { useNavigate } from "react-router-dom";

import "../styles/pages/jira-board.css";
/* ── Shared constants (mirrors JiraBoard.jsx) ───────────────────── */
const STORY_POINT_SCALE = {
  fibonacci: [1,2,3,5,8,13,21,34],
  linear:    [1,2,3,4,5,6,7,8,9,10],
  tshirt:    [1,2,3,5,8],
  powers:    [1,2,4,8,16,32],
};
const TYPE_META = {
  STORY:  { icon:"📗", label:"Story",   color:"var(--success)" },
  BUG:    { icon:"🐛", label:"Bug",     color:"var(--danger)" },
  TASK:   { icon:"✅", label:"Task",    color:"var(--brand-500)" },
  SUBTASK:{ icon:"🔹", label:"Subtask", color:"var(--purple)" },
  EPIC:   { icon:"⚡", label:"Epic",    color:"var(--warning)" },
};
const DEFAULT_COLUMNS = [
  { id:"TODO",        label:"To Do",       color:"var(--gray-500)", wipLimit:null },
  { id:"IN_PROGRESS", label:"In Progress", color:"#3b82f6", wipLimit:5   },
  { id:"IN_REVIEW",   label:"In Review",   color:"var(--purple)", wipLimit:3   },
  { id:"DONE",        label:"Done",        color:"var(--success)", wipLimit:null },
];
const DEFAULT_CONFIG = {
  columns:DEFAULT_COLUMNS, spScale:"fibonacci", showSP:true,
  sprintDuration:2, autoNumberSprints:true, unfinishedWork:"backlog",
  burndownMetric:"storyPoints", cardColor:"priority", showSubtasks:false,
  backlogGroupBy:"none", archiveDays:0, requireEstimate:false,
  requireAssignee:false, blockAfterWip:false, autoCloseSprint:false,
  disabledTypes:[],
};

const TABS = [
  { id:"columns",    icon:"📋", label:"Columns & WIP"    },
  { id:"sprints",    icon:"🏃", label:"Sprint Settings"  },
  { id:"estimation", icon:"🎯", label:"Estimation"       },
  { id:"display",    icon:"🖼", label:"Cards & Display"  },
  { id:"types",      icon:"🏷", label:"Issue Types"      },
  { id:"workflow",   icon:"🔄", label:"Workflow Rules"   },
  { id:"statuses",   icon:"🔁", label:"Status Mapping"   },
  { id:"permissions",icon:"🔐", label:"Permissions"      },
];

/* ── Column row editor ──────────────────────────────────────────── */
function ColumnRow({ col, idx, total, onChange, onRemove, onMove }) {
  return (
    <div className="jbs-col-row">
      <div className="jbs-col-handle">⠿</div>
      <input type="color" value={col.color||"var(--brand-500)"}
        onChange={e=>onChange(idx,"color",e.target.value)}
        className="jbs-color-dot" title="Column colour"/>
      <input className="jbs-input jbs-col-name" value={col.label}
        onChange={e=>onChange(idx,"label",e.target.value)}
        placeholder="Column name"/>
      <div className="jbs-col-wip-wrap">
        <input className="jbs-input jbs-col-wip" type="number"
          min="1" max="99" value={col.wipLimit||""}
          placeholder="No WIP"
          onChange={e=>onChange(idx,"wipLimit",e.target.value?Number(e.target.value):null)}/>
        <span className="jbs-col-wip-label">WIP limit</span>
      </div>
      <div className="jbs-col-actions">
        <button onClick={()=>onMove(idx,-1)} disabled={idx===0} className="jbs-icon-action">↑</button>
        <button onClick={()=>onMove(idx,1)} disabled={idx===total-1} className="jbs-icon-action">↓</button>
        <button onClick={()=>onRemove(idx)} disabled={total<=2}
          className="jbs-icon-action jbs-danger" title="Remove column">✕</button>
      </div>
    </div>
  );
}

/* ── Preview board mini-render ──────────────────────────────────── */
function BoardPreview({ columns }) {
  return (
    <div className="jbs-preview-board">
      {columns.map(col=>(
        <div key={col.id} className="jbs-preview-col">
          <div className="jbs-preview-col-head"
            style={{borderTop:`3px solid ${col.color||"var(--brand-500)"}`}}>
            <span className="jbs-preview-dot" style={{background:col.color||"var(--brand-500)"}}/>
            <span className="jbs-preview-label">{col.label}</span>
            {col.wipLimit&&<span className="jbs-preview-wip">/{col.wipLimit}</span>}
          </div>
          <div className="jbs-preview-cards">
            <div className="jbs-preview-card"/>
            <div className="jbs-preview-card" style={{opacity:.5}}/>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN SETTINGS PAGE
   ═══════════════════════════════════════════════════════════════════ */
export default function JiraBoardSettings() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("columns");
  const [saved,     setSaved]     = useState(false);
  const [config, setConfig] = useState(() => {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem("jb_config")||"{}") };
    } catch { return { ...DEFAULT_CONFIG }; }
  });

  const set = (k,v) => setConfig(p=>({...p,[k]:v}));

  /* Column helpers */
  const updateCol = (idx,k,v) =>
    set("columns", config.columns.map((c,i)=>i===idx?{...c,[k]:v}:c));
  const removeCol = idx =>
    set("columns", config.columns.filter((_,i)=>i!==idx));
  const moveCol   = (idx,dir) => {
    const arr=[...config.columns]; const to=idx+dir;
    if(to<0||to>=arr.length) return;
    [arr[idx],arr[to]]=[arr[to],arr[idx]]; set("columns",arr);
  };
  const addCol = () => set("columns",[...config.columns,{
    id:"COL_"+Date.now(), label:"New Column",
    color:"var(--brand-500)", wipLimit:null,
  }]);

  const handleSave = () => {
    try { localStorage.setItem("jb_config", JSON.stringify(config)); } catch { /* storage full/unavailable — config still applied in-memory */ }
    setSaved(true);
    setTimeout(()=>setSaved(false), 2500);
  };

  const handleReset = async () => {
    const ok = await confirm({ title: "Reset board settings?", message: "This will reset all board settings to their defaults. This cannot be undone.", danger: true, confirmText: "Reset" });
    if (!ok) return;
    setConfig({...DEFAULT_CONFIG});
    try { localStorage.removeItem("jb_config"); } catch { /* storage unavailable — in-memory reset still applied */ }
  };

  return (
    <div className="jbs-root">
      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="jbs-header">
        <div>
          <div className="jbs-breadcrumb">
            <span onClick={()=>navigate("/jira-board")} className="jbs-bc-link" role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (()=>navigate("/jira-board"))?.(e); } }}>
              Jira Board
            </span>
            <span className="jbs-bc-sep">›</span>
            <span>Settings</span>
          </div>
          <h1 className="jbs-title">Board Configuration</h1>
          <p className="jbs-subtitle">
            Customise columns, sprint behaviour, estimation, and workflow rules.
            Settings are saved to this browser.
          </p>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexShrink:0}}>
          {saved && <span className="jbs-saved">✓ Saved</span>}
          <button className="jbs-btn-ghost" onClick={handleReset}>Reset to defaults</button>
          <button className="jbs-btn-secondary" onClick={()=>navigate("/jira-board")}>
            ← Back to board
          </button>
          <button className="jbs-btn-primary" onClick={handleSave}>Save changes</button>
        </div>
      </div>

      <div className="jbs-body">
        {/* ── Sidebar tabs ──────────────────────────────────────── */}
        <div className="jbs-sidebar">
          {TABS.map(t=>(
            <button key={t.id}
              className={"jbs-tab"+(activeTab===t.id?" active":"")}
              onClick={()=>setActiveTab(t.id)}>
              <span className="jbs-tab-icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
          <div className="jbs-sidebar-divider"/>
          <button className="jbs-tab jbs-tab-danger" onClick={handleReset}>
            <span className="jbs-tab-icon">♻️</span>
            <span>Reset defaults</span>
          </button>
        </div>

        {/* ── Main content ────────────────────────────────────────── */}
        <div className="jbs-content">

          {/* ══ COLUMNS ══ */}
          {activeTab==="columns" && (
            <div className="jbs-section">
              <div className="jbs-section-head">
                <div>
                  <div className="jbs-section-title">Board Columns</div>
                  <div className="jbs-section-desc">
                    Add, remove, rename and reorder columns. Set a WIP (work-in-progress)
                    limit to cap how many issues can be in a column at once.
                  </div>
                </div>
              </div>

              <div className="jbs-card">
                <div className="jbs-col-list-header">
                  <span style={{width:24}}/>
                  <span style={{width:32}}/>
                  <span style={{flex:1}}>Column name</span>
                  <span style={{width:130}}>WIP limit</span>
                  <span style={{width:80}}>Actions</span>
                </div>
                {config.columns.map((col,idx)=>(
                  <ColumnRow key={col.id||idx} col={col} idx={idx}
                    total={config.columns.length}
                    onChange={updateCol} onRemove={removeCol} onMove={moveCol}/>
                ))}
                <button className="jbs-add-col-btn" onClick={addCol}>
                  + Add column
                </button>
              </div>

              <div className="jbs-section-title" style={{marginTop:20,marginBottom:12}}>
                Live preview
              </div>
              <BoardPreview columns={config.columns}/>

              <div className="jbs-info-box" style={{marginTop:16}}>
                <strong>WIP limits</strong> — when a column reaches its limit, cards
                turn red. Enable "Block drag when WIP reached" in Workflow Rules
                to prevent adding more issues beyond the limit.
              </div>
            </div>
          )}

          {/* ══ SPRINTS ══ */}
          {activeTab==="sprints" && (
            <div className="jbs-section">
              <div className="jbs-section-head">
                <div className="jbs-section-title">Sprint Settings</div>
                <div className="jbs-section-desc">
                  Control how sprints are created, named, and completed.
                </div>
              </div>

              <div className="jbs-card">
                <div className="jbs-field-group">
                  <span className="jbs-label">Default sprint duration</span>
                  <p className="jbs-hint">Used when starting a sprint to auto-set the end date.</p>
                  <div className="jbs-radio-group">
                    {[1,2,3,4].map(w=>(
                      <label key={w} className={"jbs-radio"+(config.sprintDuration===w?" active":"")}>
                        <input type="radio" name="sprintDuration" value={w}
                          checked={config.sprintDuration===w}
                          onChange={()=>set("sprintDuration",w)}/>
                        {w} {w===1?"week":"weeks"}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="jbs-field-group">
                  <span className="jbs-label">Sprint naming</span>
                  <p className="jbs-hint">Auto-number generates "Sprint 1", "Sprint 2" etc. automatically.</p>
                  <div className="jbs-radio-group">
                    <label className={"jbs-radio"+(config.autoNumberSprints?" active":"")}>
                      <input type="radio" checked={!!config.autoNumberSprints}
                        onChange={()=>set("autoNumberSprints",true)}/>
                      Auto-number (Sprint 1, Sprint 2…)
                    </label>
                    <label className={"jbs-radio"+(!config.autoNumberSprints?" active":"")}>
                      <input type="radio" checked={!config.autoNumberSprints}
                        onChange={()=>set("autoNumberSprints",false)}/>
                      Manual naming
                    </label>
                  </div>
                </div>

                <div className="jbs-field-group">
                  <label className="jbs-label" htmlFor="jira-board-settings-unfinished-work">Unfinished issues on sprint completion</label>
                  <p className="jbs-hint">What happens to issues that aren't Done when you complete a sprint.</p>
                  <div className="jbs-select-row">
                    <select className="jbs-select" id="jira-board-settings-unfinished-work" value={config.unfinishedWork||"backlog"}
                      onChange={e=>set("unfinishedWork",e.target.value)}>
                      <option value="backlog">Move to Backlog</option>
                      <option value="next">Move to Next Sprint</option>
                      <option value="ask">Ask each time (completion wizard)</option>
                    </select>
                  </div>
                </div>

                <div className="jbs-field-group">
                  <span className="jbs-label">Burndown metric</span>
                  <p className="jbs-hint">What unit to use on the burndown and velocity charts.</p>
                  <div className="jbs-radio-group">
                    <label className={"jbs-radio"+(config.burndownMetric==="storyPoints"?" active":"")}>
                      <input type="radio" checked={config.burndownMetric==="storyPoints"}
                        onChange={()=>set("burndownMetric","storyPoints")}/>
                      Story points
                    </label>
                    <label className={"jbs-radio"+(config.burndownMetric==="issueCount"?" active":"")}>
                      <input type="radio" checked={config.burndownMetric==="issueCount"}
                        onChange={()=>set("burndownMetric","issueCount")}/>
                      Issue count
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══ ESTIMATION ══ */}
          {activeTab==="estimation" && (
            <div className="jbs-section">
              <div className="jbs-section-head">
                <div className="jbs-section-title">Story Point Estimation</div>
                <div className="jbs-section-desc">
                  Choose the estimation scale shown in issue cards and dropdowns.
                </div>
              </div>

              <div className="jbs-card">
                <div className="jbs-field-group">
                  <span className="jbs-label">Estimation scale</span>
                  <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:8}}>
                    {[
                      {k:"fibonacci", label:"Fibonacci",  desc:"Industry standard — 1, 2, 3, 5, 8, 13, 21, 34"},
                      {k:"linear",    label:"Linear",      desc:"Simple 1–10 scale"},
                      {k:"tshirt",    label:"T-shirt",     desc:"XS=1, S=2, M=3, L=5, XL=8"},
                      {k:"powers",    label:"Powers of 2", desc:"1, 2, 4, 8, 16, 32"},
                    ].map(opt=>(
                      <label key={opt.k}
                        className={"jbs-scale-option"+(config.spScale===opt.k?" active":"")}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <input type="radio" name="spScale" checked={config.spScale===opt.k} onChange={()=>set("spScale",opt.k)}/>
                          <div>
                            <div className="jbs-scale-name">{opt.label}</div>
                            <div className="jbs-scale-desc">{opt.desc}</div>
                          </div>
                        </div>
                        <div className="jbs-scale-chips">
                          {STORY_POINT_SCALE[opt.k].map(v=>(
                            <span key={v} className="jbs-sp-chip">{v}</span>
                          ))}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="jbs-field-group">
                  <label className="jbs-label" htmlFor={"jira-board-settings-show-story-points-on-board-cards"}>Show story points on board cards</label>
                  <div className="jbs-toggle-row">
                    <label className="jbs-toggle" aria-label="Show story points on board cards">
                      <input type="checkbox" checked={!!config.showSP}
                        onChange={e=>set("showSP",e.target.checked)} id={"jira-board-settings-show-story-points-on-board-cards"}/>
                      <span className="jbs-toggle-slider"/>
                    </label>
                    <span className="jbs-toggle-label">
                      {config.showSP ? "Shown on cards" : "Hidden"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══ DISPLAY ══ */}
          {activeTab==="display" && (
            <div className="jbs-section">
              <div className="jbs-section-head">
                <div className="jbs-section-title">Cards & Display</div>
                <div className="jbs-section-desc">
                  Control how issues look on the board and how the backlog is organised.
                </div>
              </div>

              <div className="jbs-card">
                <div className="jbs-field-group">
                  <span className="jbs-label">Card colour coding</span>
                  <p className="jbs-hint">Adds a coloured left border to cards based on the selected attribute.</p>
                  <div className="jbs-radio-group">
                    {[
                      {v:"none",     l:"None"},
                      {v:"priority", l:"Priority"},
                      {v:"type",     l:"Issue type"},
                      {v:"epic",     l:"Epic"},
                      {v:"assignee", l:"Assignee"},
                    ].map(o=>(
                      <label key={o.v} className={"jbs-radio"+(config.cardColor===o.v?" active":"")}>
                        <input type="radio" checked={config.cardColor===o.v}
                          onChange={()=>set("cardColor",o.v)}/>
                        {o.l}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="jbs-field-group">
                  <label className="jbs-label" htmlFor={"jira-board-settings-show-sub-tasks-on-board"}>Show sub-tasks on board</label>
                  <div className="jbs-toggle-row">
                    <label className="jbs-toggle" aria-label="Show sub-tasks on board">
                      <input type="checkbox" checked={!!config.showSubtasks}
                        onChange={e=>set("showSubtasks",e.target.checked)} id={"jira-board-settings-show-sub-tasks-on-board"}/>
                      <span className="jbs-toggle-slider"/>
                    </label>
                    <span className="jbs-toggle-label">
                      {config.showSubtasks ? "Sub-tasks shown as cards" : "Parent issues only"}
                    </span>
                  </div>
                </div>

                <div className="jbs-field-group">
                  <label className="jbs-label" htmlFor={"jira-board-settings-group-backlog-by"}>Group backlog by</label>
                  <select className="jbs-select" value={config.backlogGroupBy||"none"}
                    onChange={e=>set("backlogGroupBy",e.target.value)} id={"jira-board-settings-group-backlog-by"}>
                    <option value="none">No grouping</option>
                    <option value="epic">Epic</option>
                    <option value="type">Issue Type</option>
                    <option value="priority">Priority</option>
                    <option value="assignee">Assignee</option>
                  </select>
                </div>

                <div className="jbs-field-group">
                  <label className="jbs-label" htmlFor={"jira-board-settings-auto-archive-done-issues-after"}>Auto-archive Done issues after</label>
                  <select className="jbs-select" value={config.archiveDays||0}
                    onChange={e=>set("archiveDays",Number(e.target.value))} id={"jira-board-settings-auto-archive-done-issues-after"}>
                    <option value={0}>Never</option>
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ══ ISSUE TYPES ══ */}
          {activeTab==="types" && (
            <div className="jbs-section">
              <div className="jbs-section-head">
                <div className="jbs-section-title">Issue Types</div>
                <div className="jbs-section-desc">
                  Enable or disable issue types for this board. Disabled types are hidden
                  from filters, creation dropdowns, and the backlog.
                </div>
              </div>

              <div className="jbs-card">
                {Object.entries(TYPE_META).map(([k,v])=>{
                  const isActive = !(config.disabledTypes||[]).includes(k);
                  return (
                    <div key={k} className="jbs-type-row">
                      <div className="jbs-type-info">
                        <span style={{fontSize:22}}>{v.icon}</span>
                        <div>
                          <div className="jbs-type-name" style={{color:v.color}}>{v.label}</div>
                          <div className="jbs-type-desc">
                            {{
                              STORY:"A user-facing feature or requirement",
                              BUG:"A defect or unexpected behaviour",
                              TASK:"A piece of technical or internal work",
                              SUBTASK:"A child of another issue",
                              EPIC:"A large body of work spanning multiple sprints",
                            }[k]}
                          </div>
                        </div>
                      </div>
                      <label className="jbs-toggle" aria-label={v.label}>
                        <input type="checkbox" checked={isActive}
                          onChange={()=>{
                            const dis=config.disabledTypes||[];
                            set("disabledTypes",
                              isActive ? [...dis,k] : dis.filter(x=>x!==k)
                            );
                          }}/>
                        <span className="jbs-toggle-slider"/>
                      </label>
                    </div>
                  );
                })}
              </div>

              <div className="jbs-info-box" style={{marginTop:12}}>
                Existing issues of a disabled type are not deleted — they just won't
                appear on this board or in creation dropdowns.
              </div>
            </div>
          )}

          {/* ══ WORKFLOW RULES ══ */}
          {activeTab==="workflow" && (
            <div className="jbs-section">
              <div className="jbs-section-head">
                <div className="jbs-section-title">Workflow Rules</div>
                <div className="jbs-section-desc">
                  Enforce quality gates and process rules when moving issues between statuses.
                </div>
              </div>

              <div className="jbs-card">
                {[
                  {
                    k:"requireEstimate", icon:"🎯",
                    title:"Require story point estimate before In Progress",
                    desc:"Issues without a story point value cannot be dragged to In Progress.",
                  },
                  {
                    k:"requireAssignee", icon:"👤",
                    title:"Require assignee before In Progress",
                    desc:"Issues must have an assignee to move to In Progress.",
                  },
                  {
                    k:"blockAfterWip", icon:"🚫",
                    title:"Block drag when WIP limit is reached",
                    desc:"Hard block — issues cannot be dragged into a full column. Without this, a warning is shown but drag succeeds.",
                  },
                  {
                    k:"autoCloseSprint", icon:"✅",
                    title:"Auto-complete sprint when all issues are Done",
                    desc:"Automatically marks the sprint as Completed when every issue reaches Done status.",
                  },
                ].map(rule=>(
                  <div key={rule.k} className="jbs-rule-row">
                    <div className="jbs-rule-icon">{rule.icon}</div>
                    <div className="jbs-rule-text">
                      <div className="jbs-rule-title">{rule.title}</div>
                      <div className="jbs-rule-desc">{rule.desc}</div>
                    </div>
                    <label className="jbs-toggle" aria-label={rule.title}>
                      <input type="checkbox" checked={!!config[rule.k]}
                        onChange={e=>set(rule.k,e.target.checked)}/>
                      <span className="jbs-toggle-slider"/>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══ STATUS MAPPING ══ */}
          {activeTab==="statuses" && (
            <div className="jbs-section">
              <div className="jbs-section-head">
                <div className="jbs-section-title">Status Mapping</div>
                <div className="jbs-section-desc">
                  Map each board column to the underlying task status stored in the database.
                  This lets you rename columns without changing the backend status values.
                </div>
              </div>

              <div className="jbs-card">
                <div className="jbs-status-map-header">
                  <span>Board column</span>
                  <span>→</span>
                  <span>Database status</span>
                </div>
                {config.columns.map((col,i)=>(
                  <div key={col.id||i} className="jbs-status-map-row">
                    <div className="jbs-status-col-pill"
                      style={{borderColor:col.color,color:col.color}}>
                      <span className="jbs-preview-dot" style={{background:col.color}}/>
                      {col.label}
                    </div>
                    <span style={{color:"var(--gray-400)"}}>→</span>
                    <select className="jbs-select"
                      value={col.id}
                      onChange={e=>updateCol(i,"id",e.target.value)}>
                      <option value="TODO">TODO</option>
                      <option value="IN_PROGRESS">IN_PROGRESS</option>
                      <option value="IN_REVIEW">IN_REVIEW</option>
                      <option value="DONE">DONE</option>
                      <option value="BLOCKED">BLOCKED</option>
                      <option value="CANCELLED">CANCELLED</option>
                      <option value={col.id}>{col.id} (custom)</option>
                    </select>
                  </div>
                ))}
              </div>

              <div className="jbs-info-box" style={{marginTop:12}}>
                Custom status values (e.g. BLOCKED) will be stored on the task record.
                Make sure your backend accepts these status strings.
              </div>
            </div>
          )}

          {/* ══ PERMISSIONS ══ */}
          {activeTab==="permissions" && (
            <div className="jbs-section">
              <div className="jbs-section-head">
                <div className="jbs-section-title">Board Permissions</div>
                <div className="jbs-section-desc">
                  Control what team members can do on this board.
                </div>
              </div>

              <div className="jbs-card">
                {[
                  {k:"permCreateIssues",  title:"Create issues",     desc:"Who can create new issues on the board",     def:"Everyone"},
                  {k:"permEditIssues",    title:"Edit issues",       desc:"Who can edit issue details",                 def:"Everyone"},
                  {k:"permDeleteIssues",  title:"Delete issues",     desc:"Who can delete issues",                      def:"Admins only"},
                  {k:"permManageSprints", title:"Manage sprints",    desc:"Who can create, start and complete sprints", def:"Admins & managers"},
                  {k:"permEditConfig",    title:"Edit board config",  desc:"Who can change board settings",              def:"Admins only"},
                ].map(p=>(
                  <div key={p.k} className="jbs-perm-row">
                    <div className="jbs-perm-text">
                      <div className="jbs-perm-title">{p.title}</div>
                      <div className="jbs-perm-desc">{p.desc}</div>
                    </div>
                    <select className="jbs-select" style={{maxWidth:200}}
                      value={config[p.k]||p.def}
                      onChange={e=>set(p.k,e.target.value)}>
                      <option value="Everyone">Everyone</option>
                      <option value="Members only">Members only</option>
                      <option value="Admins & managers">Admins & managers</option>
                      <option value="Admins only">Admins only</option>
                    </select>
                  </div>
                ))}
              </div>

              <div className="jbs-info-box" style={{marginTop:12}}>
                Permission enforcement requires the backend RBAC system.
                These settings are stored and respected by the Prowosma API.
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
