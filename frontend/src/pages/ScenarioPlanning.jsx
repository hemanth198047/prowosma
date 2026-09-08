import { useState, useEffect, useCallback } from "react";
import { unwrapList } from "../api/client";
import PageHeader from "../components/PageHeader";
import client from "../api/client";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import { getProjects } from "../api/projects";
import { getTeamMembers } from "../api/team";

// ── API ────────────────────────────────────────────────────────
const api = {
  list:     ()       => client.get("/scenarios"),
  get:      (id)     => client.get(`/scenarios/${id}`),
  create:   (d)      => client.post("/scenarios", d),
  update:   (id, d)  => client.put(`/scenarios/${id}`, d),
  simulate: (id)     => client.post(`/scenarios/${id}/simulate`),
  preview:  (d)      => client.post("/scenarios/preview", d),
  delete:   (id)     => client.delete(`/scenarios/${id}`),
  compare:  (a, b)   => client.get(`/scenarios/compare?a=${a}&b=${b}`),
};

// ── Constants ──────────────────────────────────────────────────
const SCENARIO_TYPES = [
  { value:"TEAM_CHANGE",     label:"👥 Team Change",       icon:"👥",
    desc:"Simulate losing or adding team members and the impact on delivery" },
  { value:"DEADLINE_SHIFT",  label:"📅 Deadline Shift",    icon:"📅",
    desc:"Compress or extend project timelines and see confidence projections" },
  { value:"SCOPE_CHANGE",    label:"📦 Scope Change",      icon:"📦",
    desc:"Add or remove story points and see sprint/delivery impact" },
  { value:"BUDGET_CUT",      label:"💰 Budget Cut",        icon:"💰",
    desc:"Model budget reduction scenarios and projected burn rate" },
  { value:"VELOCITY_CHANGE", label:"⚡ Velocity Change",   icon:"⚡",
    desc:"Simulate team slowdown (illness, onboarding, tech debt) or speedup" },
  { value:"COMBINED",        label:"🔀 Combined",          icon:"🔀",
    desc:"Mix multiple changes together for complex what-if analysis" },
];

const RISK_META = {
  LOW:      { color:"#10b981", bg:"rgba(16,185,129,.1)",  label:"Low Risk"     },
  MEDIUM:   { color:"#f59e0b", bg:"rgba(245,158,11,.1)",  label:"Medium Risk"  },
  HIGH:     { color:"#ef4444", bg:"rgba(239,68,68,.1)",   label:"High Risk"    },
  CRITICAL: { color:"#7c3aed", bg:"rgba(124,58,237,.1)",  label:"Critical Risk"},
};

// ── Helpers ────────────────────────────────────────────────────
const defaultInputs = () => ({
  teamSizeDelta: 0,
  removedMemberEmails: [],
  addedMemberSkills: [],
  deadlineShiftDays: 0,
  linkedProjectId: "",
  sprintVelocityChange: 0,
  deprioritisedProjectIds: [],
  prioritisedProjectIds: [],
  budgetCutPercent: 0,
  scopeAddedPoints: 0,
  scopeRemovedPoints: 0,
});

// ── Risk gauge ─────────────────────────────────────────────────
function RiskGauge({ score, level }) {
  const rm = RISK_META[level] || RISK_META.LOW;
  const circumference = 2 * Math.PI * 40;
  const dashOffset = circumference * (1 - score / 100);
  return (
    <div className="sc-gauge">
      <svg width={100} height={100} viewBox="0 0 100 100">
        <circle cx={50} cy={50} r={40} fill="none" stroke="var(--gray-100)" strokeWidth={10} />
        <circle cx={50} cy={50} r={40} fill="none" stroke={rm.color} strokeWidth={10}
          strokeDasharray={circumference} strokeDashoffset={dashOffset}
          strokeLinecap="round" transform="rotate(-90 50 50)"
          style={{transition:"stroke-dashoffset .6s ease"}} />
        <text x={50} y={47} textAnchor="middle" fontSize={18} fontWeight={800} fill={rm.color}>{score}</text>
        <text x={50} y={62} textAnchor="middle" fontSize={9} fill="var(--gray-400)">/ 100</text>
      </svg>
      <div className="sc-gauge-label" style={{color:rm.color}}>{rm.label}</div>
    </div>
  );
}

// ── Metric card ────────────────────────────────────────────────
function MetricCard({ icon, label, value, sub, color = "var(--gray-800)", delta }) {
  return (
    <div className="sc-metric-card">
      <div className="sc-metric-icon">{icon}</div>
      <div className="sc-metric-body">
        <div className="sc-metric-value" style={{color}}>{value}</div>
        <div className="sc-metric-label">{label}</div>
        {sub   && <div className="sc-metric-sub">{sub}</div>}
        {delta !== undefined && delta !== 0 && (
          <div className="sc-metric-delta" style={{color: delta > 0 ? "#ef4444" : "#10b981"}}>
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Results panel ──────────────────────────────────────────────
function SimulationResults({ results, aiNarrative, scenarioName }) {
  if (!results) return null;
  const rm = RISK_META[results.deliveryRiskLevel] || RISK_META.LOW;

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString([], {day:"numeric",month:"short",year:"numeric"}) : "—";
  const delayLabel = results.estimatedDelayDays > 0
    ? `+${results.estimatedDelayDays}d late`
    : results.estimatedDelayDays < 0
    ? `${Math.abs(results.estimatedDelayDays)}d early`
    : "On time";
  const delayColor = results.estimatedDelayDays > 0 ? "#ef4444"
    : results.estimatedDelayDays < 0 ? "#10b981" : "#6b7280";

  return (
    <div className="sc-results">
      {/* Header banner */}
      <div className="sc-results-banner" style={{background:rm.bg, borderColor:rm.color}}>
        <RiskGauge score={results.deliveryRiskScore} level={results.deliveryRiskLevel} />
        <div className="sc-results-summary">
          <div className="sc-results-title">Simulation: {scenarioName}</div>
          <div className="sc-results-subtitle" style={{color:rm.color}}>{rm.label}</div>
          <div className="sc-results-confidence">
            <span style={{fontWeight:800,fontSize:"24px",color:rm.color}}>
              {results.deliveryConfidence}%
            </span>
            <span style={{fontSize:"13px",color:"var(--gray-500)",marginLeft:"6px"}}>delivery confidence</span>
          </div>
        </div>
      </div>

      {/* Key metrics grid */}
      <div className="sc-metrics-grid">
        <MetricCard icon="📅" label="Projected Completion"
          value={fmtDate(results.projectedCompletionDate)}
          sub={`Baseline: ${fmtDate(results.baselineCompletionDate)}`}
          color={results.estimatedDelayDays > 0 ? "#ef4444" : "#10b981"} />
        <MetricCard icon="⏱" label="Delay Estimate"
          value={delayLabel} color={delayColor}
          sub={`${results.sprintsToCompletion} sprints needed`} />
        <MetricCard icon="⚡" label="Sprint Velocity"
          value={`${results.sprintVelocityProjected} pts`}
          sub="After scenario changes"
          delta={results.sprintVelocityProjected > 0 ? undefined : undefined} />
        <MetricCard icon="🎯" label="Goals at Risk"
          value={results.goalsAtRisk}
          color={results.goalsAtRisk > 0 ? "#ef4444" : "#10b981"}
          sub={`Confidence Δ ${results.goalConfidenceImpact > 0 ? "+" : ""}${results.goalConfidenceImpact} pts`} />
        <MetricCard icon="👥" label="Team Load"
          value={`${results.teamLoadChange > 0 ? "+" : ""}${results.teamLoadChange}%`}
          color={results.teamLoadChange > 20 ? "#ef4444" : results.teamLoadChange > 0 ? "#f59e0b" : "#10b981"}
          sub={results.burnoutRisk ? "⚠️ Burnout risk" : "Within capacity"} />
        <MetricCard icon="💰" label="Budget Variance"
          value={results.budgetVariance < 0 ? `−$${Math.abs(results.budgetVariance).toLocaleString()}` : "No change"}
          color={results.budgetVariance < -1000 ? "#ef4444" : "var(--gray-700)"}
          sub={`Burn: $${(results.projectedBurnRate||0).toLocaleString()}/mo`} />
      </div>

      {/* AI Narrative */}
      {aiNarrative && (
        <div className="sc-ai-narrative">
          <div className="sc-ai-label">🤖 AI Executive Narrative</div>
          <div className="sc-ai-text">{aiNarrative}</div>
        </div>
      )}

      {/* Warnings */}
      {results.warnings?.length > 0 && (
        <div className="sc-section">
          <div className="sc-section-label">⚠️ Warnings</div>
          {results.warnings.map((w,i) => (
            <div key={i} className="sc-warning-row">
              <span className="sc-warning-dot" />
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Recommendations */}
      {results.recommendations?.length > 0 && (
        <div className="sc-section">
          <div className="sc-section-label">💡 Recommendations</div>
          {results.recommendations.map((r,i) => (
            <div key={i} className="sc-rec-row">
              <span className="sc-rec-num">{i+1}</span>
              {r}
            </div>
          ))}
        </div>
      )}

      {/* Affected Goals */}
      {results.affectedGoals?.length > 0 && (
        <div className="sc-section">
          <div className="sc-section-label">🎯 Goal Impact Detail</div>
          {results.affectedGoals.map((g,i) => (
            <div key={i} className="sc-goal-impact-row">
              <span className="sc-goal-impact-title">{g.title}</span>
              <div className="sc-goal-impact-bars">
                <div className="sc-goal-impact-bar-wrap">
                  <div className="sc-goal-impact-bar sc-goal-bar-before"
                    style={{width:`${g.currentConf}%`}} />
                  <span className="sc-goal-bar-label">{g.currentConf}%</span>
                </div>
                <span className="sc-goal-arrow">→</span>
                <div className="sc-goal-impact-bar-wrap">
                  <div className="sc-goal-impact-bar"
                    style={{width:`${g.projectedConf}%`,
                      background: g.atRisk ? "#ef4444" : "#6366f1"}} />
                  <span className="sc-goal-bar-label"
                    style={{color: g.atRisk ? "#ef4444" : "#10b981"}}>
                    {g.projectedConf}%
                  </span>
                </div>
                {g.atRisk && <span className="sc-goal-at-risk">⚠️ At Risk</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Member impacts */}
      {results.memberImpacts?.length > 0 && (
        <div className="sc-section">
          <div className="sc-section-label">👤 Member Impact</div>
          {results.memberImpacts.map((m,i) => (
            <div key={i} className="sc-member-impact-row">
              <span className="sc-member-impact-email">{m.email}</span>
              <span className={`sc-impact-badge sc-impact-${(m.impact||"LOW").toLowerCase()}`}>
                {m.impact}
              </span>
              <span className="sc-member-impact-note">{m.note}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Scenario input form ────────────────────────────────────────
function ScenarioBuilder({ scenario, projects, members, onChange, onSimulate, simulating }) {
  const [inp, setInp] = useState(scenario.inputs || defaultInputs());
  const [memberInput, setMemberInput] = useState("");
  const set = (k, v) => { const n = {...inp,[k]:v}; setInp(n); onChange(n); };

  const addRemovedMember = () => {
    if (!memberInput.trim()) return;
    const n = [...(inp.removedMemberEmails||[]), memberInput.trim()];
    set("removedMemberEmails", n); setMemberInput("");
  };
  const removeRemovedMember = (e) =>
    set("removedMemberEmails", inp.removedMemberEmails.filter(x=>x!==e));

  const type = scenario.type || "COMBINED";
  const showTeam     = ["TEAM_CHANGE","COMBINED"].includes(type);
  const showDeadline = ["DEADLINE_SHIFT","COMBINED"].includes(type);
  const showScope    = ["SCOPE_CHANGE","COMBINED"].includes(type);
  const showBudget   = ["BUDGET_CUT","COMBINED"].includes(type);
  const showVelocity = ["VELOCITY_CHANGE","COMBINED"].includes(type);

  return (
    <div className="sc-builder">
      {/* Team Change */}
      {showTeam && (
        <div className="sc-builder-section">
          <div className="sc-builder-section-title">👥 Team Changes</div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor={"scenario-planning-net-team-size-change"}>Net Team Size Change</label>
              <div className="sc-slider-wrap">
                <input type="range" min={-10} max={10} value={inp.teamSizeDelta}
                  onChange={e=>set("teamSizeDelta",Number(e.target.value))} id={"scenario-planning-net-team-size-change"} />
                <span className="sc-slider-val"
                  style={{color:inp.teamSizeDelta<0?"#ef4444":inp.teamSizeDelta>0?"#10b981":"var(--gray-500)"}}>
                  {inp.teamSizeDelta>0?"+":""}{inp.teamSizeDelta} members
                </span>
              </div>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor={"scenario-planning-members-leaving-emails"}>Members leaving (emails)</label>
            <div className="sc-tag-input-row">
              <select value={memberInput} onChange={e=>setMemberInput(e.target.value)}
                className="sc-member-select" id={"scenario-planning-members-leaving-emails"}>
                <option value="">— pick a member —</option>
                {members.map(m=><option key={m.id} value={m.email}>{m.name} ({m.email})</option>)}
              </select>
              <button className="btn-secondary" style={{fontSize:"11px"}} onClick={addRemovedMember}>
                Add
              </button>
            </div>
            <div className="sc-tag-chips">
              {(inp.removedMemberEmails||[]).map(e=>(
                <span key={e} className="sc-tag-chip sc-chip-red">
                  {e} <button onClick={()=>removeRemovedMember(e)}>×</button>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Deadline Shift */}
      {showDeadline && (
        <div className="sc-builder-section">
          <div className="sc-builder-section-title">📅 Deadline Shift</div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor={"scenario-planning-shift-deadline-by-days"}>Shift deadline by (days)</label>
              <div className="sc-slider-wrap">
                <input type="range" min={-90} max={180} step={1} value={inp.deadlineShiftDays}
                  onChange={e=>set("deadlineShiftDays",Number(e.target.value))} id={"scenario-planning-shift-deadline-by-days"} />
                <span className="sc-slider-val"
                  style={{color:inp.deadlineShiftDays<0?"#ef4444":inp.deadlineShiftDays>0?"#10b981":"var(--gray-500)"}}>
                  {inp.deadlineShiftDays>0?"+":""}{inp.deadlineShiftDays}d
                </span>
              </div>
              <div className="admin-field-help">
                Negative = compress deadline · Positive = extend deadline
              </div>
            </div>
            <div className="form-group">
              <label htmlFor={"scenario-planning-linked-project-optional"}>Linked Project (optional)</label>
              <select value={inp.linkedProjectId}
                onChange={e=>set("linkedProjectId",e.target.value)} id={"scenario-planning-linked-project-optional"}>
                <option value="">All active projects</option>
                {projects.filter(p=>p.status!=="DONE").map(p=>(
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Velocity Change */}
      {showVelocity && (
        <div className="sc-builder-section">
          <div className="sc-builder-section-title">⚡ Velocity Change</div>
          <div className="form-group">
            <label htmlFor={"scenario-planning-sprint-velocity-change"}>Sprint velocity change (%)</label>
            <div className="sc-slider-wrap">
              <input type="range" min={-80} max={50} value={inp.sprintVelocityChange}
                onChange={e=>set("sprintVelocityChange",Number(e.target.value))} id={"scenario-planning-sprint-velocity-change"} />
              <span className="sc-slider-val"
                style={{color:inp.sprintVelocityChange<0?"#ef4444":inp.sprintVelocityChange>0?"#10b981":"var(--gray-500)"}}>
                {inp.sprintVelocityChange>0?"+":""}{inp.sprintVelocityChange}%
              </span>
            </div>
            <div className="admin-field-help">
              Examples: −30% = tech debt sprint · −50% = major incident · +20% = new tooling
            </div>
          </div>
        </div>
      )}

      {/* Scope Change */}
      {showScope && (
        <div className="sc-builder-section">
          <div className="sc-builder-section-title">📦 Scope Changes</div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor={"scenario-planning-story-points-added-to-backlog"}>Story points ADDED to backlog</label>
              <div className="sc-slider-wrap">
                <input type="range" min={0} max={200} step={5} value={inp.scopeAddedPoints}
                  onChange={e=>set("scopeAddedPoints",Number(e.target.value))} id={"scenario-planning-story-points-added-to-backlog"} />
                <span className="sc-slider-val" style={{color:inp.scopeAddedPoints>0?"#ef4444":"var(--gray-500)"}}>
                  +{inp.scopeAddedPoints} pts
                </span>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor={"scenario-planning-story-points-removed-from-backlog"}>Story points REMOVED from backlog</label>
              <div className="sc-slider-wrap">
                <input type="range" min={0} max={200} step={5} value={inp.scopeRemovedPoints}
                  onChange={e=>set("scopeRemovedPoints",Number(e.target.value))} id={"scenario-planning-story-points-removed-from-backlog"} />
                <span className="sc-slider-val" style={{color:inp.scopeRemovedPoints>0?"#10b981":"var(--gray-500)"}}>
                  −{inp.scopeRemovedPoints} pts
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Budget Cut */}
      {showBudget && (
        <div className="sc-builder-section">
          <div className="sc-builder-section-title">💰 Budget Reduction</div>
          <div className="form-group">
            <label htmlFor={"scenario-planning-budget-cut"}>Budget cut (%)</label>
            <div className="sc-slider-wrap">
              <input type="range" min={0} max={80} step={5} value={inp.budgetCutPercent}
                onChange={e=>set("budgetCutPercent",Number(e.target.value))} id={"scenario-planning-budget-cut"} />
              <span className="sc-slider-val"
                style={{color:inp.budgetCutPercent>0?"#ef4444":"var(--gray-500)"}}>
                {inp.budgetCutPercent}% cut
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="sc-builder-actions">
        <button className="btn-primary sc-simulate-btn" onClick={onSimulate} disabled={simulating}>
          {simulating ? "⏳ Simulating…" : "▶ Run Simulation"}
        </button>
      </div>
    </div>
  );
}

// ── Comparison view ────────────────────────────────────────────
function CompareRow({ label, aVal, bVal, better = "lower" }) {
  const aNum = parseFloat(aVal) || 0;
  const bNum = parseFloat(bVal) || 0;
  const aWins = better === "lower" ? aNum <= bNum : aNum >= bNum;
  return (
    <tr className="sc-cmp-row">
      <td className="sc-cmp-label">{label}</td>
      <td className={`sc-cmp-val ${aWins && aNum!==bNum ? "sc-cmp-winner":""}`}>{aVal}</td>
      <td className={`sc-cmp-val ${!aWins && aNum!==bNum ? "sc-cmp-winner":""}`}>{bVal}</td>
    </tr>
  );
}

function CompareView({ scenarios }) {
  const [selA, setSelA] = useState("");
  const [selB, setSelB] = useState("");
  const simulated = scenarios.filter(s => s.status === "SIMULATED");

  const sA = simulated.find(s=>s.id===selA);
  const sB = simulated.find(s=>s.id===selB);

  return (
    <div className="sc-compare">
      <div className="form-row" style={{marginBottom:"16px"}}>
        <div className="form-group">
          <label htmlFor={"scenario-planning-scenario-a"}>Scenario A</label>
          <select value={selA} onChange={e=>setSelA(e.target.value)} id={"scenario-planning-scenario-a"}>
            <option value="">— select —</option>
            {simulated.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor={"scenario-planning-scenario-b"}>Scenario B</label>
          <select value={selB} onChange={e=>setSelB(e.target.value)} id={"scenario-planning-scenario-b"}>
            <option value="">— select —</option>
            {simulated.filter(s=>s.id!==selA).map(s=>(
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {sA && sB && sA.results && sB.results ? (
        <div>
          <table className="sc-cmp-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th style={{color:"#6366f1"}}>{sA.name}</th>
                <th style={{color:"#10b981"}}>{sB.name}</th>
              </tr>
            </thead>
            <tbody>
              <CompareRow label="Delivery Risk Score"
                aVal={sA.results.deliveryRiskScore}
                bVal={sB.results.deliveryRiskScore} better="lower" />
              <CompareRow label="Risk Level"
                aVal={sA.results.deliveryRiskLevel}
                bVal={sB.results.deliveryRiskLevel} better="lower" />
              <CompareRow label="Delivery Confidence"
                aVal={`${sA.results.deliveryConfidence}%`}
                bVal={`${sB.results.deliveryConfidence}%`} better="higher" />
              <CompareRow label="Estimated Delay"
                aVal={`${sA.results.estimatedDelayDays}d`}
                bVal={`${sB.results.estimatedDelayDays}d`} better="lower" />
              <CompareRow label="Sprints to Complete"
                aVal={sA.results.sprintsToCompletion}
                bVal={sB.results.sprintsToCompletion} better="lower" />
              <CompareRow label="Sprint Velocity"
                aVal={`${sA.results.sprintVelocityProjected} pts`}
                bVal={`${sB.results.sprintVelocityProjected} pts`} better="higher" />
              <CompareRow label="Team Load Change"
                aVal={`${sA.results.teamLoadChange}%`}
                bVal={`${sB.results.teamLoadChange}%`} better="lower" />
              <CompareRow label="Goals at Risk"
                aVal={sA.results.goalsAtRisk}
                bVal={sB.results.goalsAtRisk} better="lower" />
              <CompareRow label="Goal Confidence Δ"
                aVal={`${sA.results.goalConfidenceImpact > 0 ? "+" : ""}${sA.results.goalConfidenceImpact}`}
                bVal={`${sB.results.goalConfidenceImpact > 0 ? "+" : ""}${sB.results.goalConfidenceImpact}`}
                better="higher" />
              <CompareRow label="Burnout Risk"
                aVal={sA.results.burnoutRisk ? "Yes ⚠️" : "No ✓"}
                bVal={sB.results.burnoutRisk ? "Yes ⚠️" : "No ✓"} better="lower" />
            </tbody>
          </table>

          <div className="sc-cmp-narratives">
            <div className="sc-cmp-narrative-col">
              <div className="sc-cmp-narrative-title" style={{color:"#6366f1"}}>{sA.name}</div>
              <div className="sc-cmp-narrative-text">{sA.aiNarrative || "No narrative"}</div>
            </div>
            <div className="sc-cmp-narrative-col">
              <div className="sc-cmp-narrative-title" style={{color:"#10b981"}}>{sB.name}</div>
              <div className="sc-cmp-narrative-text">{sB.aiNarrative || "No narrative"}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-state">Select two simulated scenarios above to compare them side by side.</div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────
export default function ScenarioPlanning() {
  const [tab,       setTab]       = useState("scenarios");
  const [scenarios, setScenarios] = useState([]);
  const [projects,  setProjects]  = useState([]);
  const [members,   setMembers]   = useState([]);
  const [activeId,  setActiveId]  = useState(null);
  const [editing,   setEditing]   = useState(null);   // scenario being edited/built
  const [liveInputs,setLiveInputs]= useState(null);
  const [liveResult,setLiveResult]= useState(null);
  const [simulating,setSimulating]= useState(false);
  const [previewing,setPreviewing]= useState(false);
  const { show:toast } = useToast();
  const confirm = useConfirm();

  const load = useCallback(() => {
    api.list().then(r=>setScenarios(unwrapList(r))).catch(()=>{});
  }, []);

  useEffect(() => {
    load();
    getProjects().then(r=>setProjects(unwrapList(r))).catch(()=>{});
    getTeamMembers().then(r=>setMembers(unwrapList(r))).catch(()=>{});
  }, [load]);

  const activeScenario = scenarios.find(s=>s.id===activeId) || editing;

  const startNew = (type) => {
    setEditing({
      name:        `${SCENARIO_TYPES.find(t=>t.value===type)?.label || "New Scenario"} — ${new Date().toLocaleDateString()}`,
      description: "",
      type,
      inputs:      defaultInputs(),
      status:      "DRAFT",
    });
    setLiveResult(null);
    setActiveId(null);
    setTab("builder");
  };

  const saveScenario = async () => {
    if (!editing?.name?.trim()) return;
    const updated = { ...editing, inputs: liveInputs || editing.inputs };
    if (editing.id) {
      await api.update(editing.id, updated);
    } else {
      const r = await api.create(updated);
      // Was unwrapList(r) — create returns the new Scenario object
      // directly, not a list.
      setEditing(r.data);
    }
    load();
    toast("Scenario saved","success");
  };

  const runPreview = async () => {
    if (!editing) return;
    setPreviewing(true);
    try {
      const sc = { ...editing, inputs: liveInputs || editing.inputs };
      const r = await api.preview(sc);
      // Was unwrapList(r) — /scenarios/preview returns the simulation
      // result object directly; the live preview has likely always shown
      // nothing.
      setLiveResult(r.data);
    } catch { toast("Preview failed","error"); }
    finally { setPreviewing(false); }
  };

  const runSavedSimulation = async (id) => {
    setSimulating(true);
    try {
      const r = await api.simulate(id);
      setScenarios(prev => prev.map(s=>s.id===id ? r.data : s));
      setActiveId(id);
      setTab("results");
      toast("Simulation complete","success");
    } catch { toast("Simulation failed","error"); }
    finally { setSimulating(false); }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({title:"Delete this scenario?",danger:true});
    if (!ok) return;
    await api.delete(id);
    load();
    if (activeId===id) setActiveId(null);
    toast("Deleted","success");
  };

  const simulated = scenarios.filter(s=>s.status==="SIMULATED");

  return (
    <div>
      <PageHeader icon="🔮" title="Scenario Planning"
        description="Model what-if changes and simulate their impact on delivery, goals, and team health"
        action={
          <div style={{display:"flex",gap:"8px"}}>
            {tab==="builder" && editing && (
              <>
                <button className="btn-secondary" onClick={saveScenario}>💾 Save</button>
                <button className="btn-primary" onClick={runPreview} disabled={previewing}>
                  {previewing ? "⏳" : "👁 Preview"}
                </button>
              </>
            )}
          </div>
        }
      />

      {/* Tab bar */}
      <div className="admin-tab-bar">
        {[
          ["scenarios",  "📋 Scenarios"],
          ["builder",    "🔨 Builder"],
          ["results",    `📊 Results${simulated.length>0?` (${simulated.length})`:""}`],
          ["compare",    "⚖️ Compare"],
        ].map(([t,l])=>(
          <button key={t} className={`admin-tab-btn${tab===t?" active":""}`}
            onClick={()=>setTab(t)}>{l}</button>
        ))}
      </div>

      {/* ── SCENARIOS LIST ── */}
      {tab==="scenarios" && (
        <div>
          {/* Type cards */}
          <div className="sc-section-label">Choose a scenario type to start</div>
          <div className="sc-type-grid">
            {SCENARIO_TYPES.map(t=>(
              <button key={t.value} className="sc-type-card" onClick={()=>startNew(t.value)}>
                <div className="sc-type-icon">{t.icon}</div>
                <div className="sc-type-name">{t.label.split(" ").slice(1).join(" ")}</div>
                <div className="sc-type-desc">{t.desc}</div>
              </button>
            ))}
          </div>

          {/* Saved scenarios */}
          {scenarios.length > 0 && (
            <>
              <div className="sc-section-label" style={{marginTop:"24px"}}>
                Saved Scenarios ({scenarios.length})
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                {scenarios.map(s=>{
                  const rm = s.results ? RISK_META[s.results.deliveryRiskLevel] || RISK_META.LOW : null;
                  const typeMeta = SCENARIO_TYPES.find(t=>t.value===s.type);
                  return (
                    <div key={s.id} className="sc-saved-card">
                      <div className="sc-saved-icon">{typeMeta?.icon||"🔮"}</div>
                      <div className="sc-saved-body">
                        <div className="sc-saved-name">{s.name}</div>
                        <div className="sc-saved-meta">
                          {typeMeta?.label.split(" ").slice(1).join(" ")} ·
                          {s.status === "SIMULATED"
                            ? <span style={{color:"#10b981"}}> Simulated</span>
                            : <span style={{color:"#6b7280"}}> Draft</span>}
                          {s.simulatedAt && ` · ${new Date(s.simulatedAt).toLocaleDateString()}`}
                        </div>
                      </div>
                      {rm && (
                        <span className="sc-risk-pill" style={{background:rm.bg,color:rm.color}}>
                          {rm.label}
                        </span>
                      )}
                      <div style={{display:"flex",gap:"6px"}}>
                        <button className="btn-secondary" style={{fontSize:"11px"}}
                          onClick={()=>{ setEditing(s); setLiveInputs(s.inputs); setLiveResult(null); setTab("builder"); }}>
                          ✏️ Edit
                        </button>
                        {s.id && (
                          <button className="btn-primary" style={{fontSize:"11px"}}
                            disabled={simulating}
                            onClick={async()=>{ await saveScenario(); await runSavedSimulation(s.id); }}>
                            ▶ Run
                          </button>
                        )}
                        {s.status==="SIMULATED" && (
                          <button className="btn-secondary" style={{fontSize:"11px"}}
                            onClick={()=>{ setActiveId(s.id); setTab("results"); }}>
                            📊 View
                          </button>
                        )}
                        <button className="btn-icon" onClick={()=>handleDelete(s.id)}>🗑️</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {scenarios.length===0 && (
            <div className="empty-state" style={{marginTop:"24px"}}>
              No scenarios yet. Pick a type above to build your first what-if simulation.
            </div>
          )}
        </div>
      )}

      {/* ── BUILDER ── */}
      {tab==="builder" && (
        <div className="sc-builder-layout">
          {!editing ? (
            <div className="empty-state">
              Select a scenario type from the Scenarios tab to start building.
            </div>
          ) : (
            <>
              <div className="sc-builder-left">
                <div className="form-row" style={{marginBottom:"12px"}}>
                  <div className="form-group" style={{flex:2}}>
                    <label htmlFor={"scenario-planning-scenario-name"}>Scenario Name</label>
                    <input value={editing.name}
                      onChange={e=>setEditing(s=>({...s,name:e.target.value}))} id={"scenario-planning-scenario-name"} />
                  </div>
                  <div className="form-group">
                    <label htmlFor={"scenario-planning-type"}>Type</label>
                    <select value={editing.type}
                      onChange={e=>setEditing(s=>({...s,type:e.target.value}))} id={"scenario-planning-type"}>
                      {SCENARIO_TYPES.map(t=>(
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <ScenarioBuilder
                  scenario={editing}
                  projects={projects}
                  members={members}
                  onChange={(inputs) => setLiveInputs(inputs)}
                  onSimulate={async () => {
                    await saveScenario();
                    if (editing.id) await runSavedSimulation(editing.id);
                    else toast("Save the scenario first, then run simulation","error");
                  }}
                  simulating={simulating||previewing}
                />
              </div>

              <div className="sc-builder-right">
                {liveResult ? (
                  <SimulationResults
                    results={liveResult.results}
                    aiNarrative={liveResult.aiNarrative}
                    scenarioName={editing.name} />
                ) : (
                  <div className="sc-preview-placeholder">
                    <div className="sc-preview-icon">🔮</div>
                    <div className="sc-preview-hint">
                      Adjust the sliders and click <strong>👁 Preview</strong> to see a live simulation,
                      or <strong>💾 Save</strong> then <strong>▶ Run Simulation</strong> to persist results.
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── RESULTS ── */}
      {tab==="results" && (
        <div>
          {simulated.length===0 ? (
            <div className="empty-state">No simulated scenarios yet. Run a simulation from the Builder.</div>
          ) : (
            <>
              <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"16px"}}>
                {simulated.map(s=>(
                  <button key={s.id}
                    className={`sprint-filter-btn${activeId===s.id?" active":""}`}
                    onClick={()=>setActiveId(s.id)}>
                    {SCENARIO_TYPES.find(t=>t.value===s.type)?.icon} {s.name}
                  </button>
                ))}
              </div>
              {activeScenario?.results && (
                <SimulationResults
                  results={activeScenario.results}
                  aiNarrative={activeScenario.aiNarrative}
                  scenarioName={activeScenario.name} />
              )}
            </>
          )}
        </div>
      )}

      {/* ── COMPARE ── */}
      {tab==="compare" && <CompareView scenarios={scenarios} />}
    </div>
  );
}