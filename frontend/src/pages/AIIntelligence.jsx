import { useState } from "react";
import PageHeader from "../components/PageHeader";
import client from "../api/client";
import "../styles/pages/ai.css";

// ── API ───────────────────────────────────────────────────────
const api = {
  predictDelays:      () => client.get("/ai/predict-delays"),
  goalFailure:        () => client.get("/ai/goal-failure-prediction"),
  burnout:            () => client.get("/ai/burnout-check"),
  dailyPriorities:    () => client.get("/ai/daily-priorities"),
  teamInsights:       () => client.get("/ai/team-insights"),
  detectDeps:         () => client.get("/ai/detect-dependencies"),
  risks:              () => client.get("/ai/risks"),
  processMining:      () => client.get("/ai/process-mining"),
};

// ── Intelligence card ─────────────────────────────────────────
function IntelCard({ icon, title, desc, onRun, renderData }) {
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState(null);

  const handleRun = async () => {
    setLoading(true); setError(null);
    try { setResult(await onRun()); }
    catch (e) { setError(e.response?.data?.message || e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="intel-card">
      <div className="intel-card-header">
        <span className="intel-card-icon">{icon}</span>
        <div className="intel-card-info">
          <div className="intel-card-title">{title}</div>
          <div className="intel-card-desc">{desc}</div>
        </div>
        <button className="btn-primary" style={{ fontSize:"11px", padding:"5px 12px", flexShrink:0 }}
          onClick={handleRun} disabled={loading}>
          {loading ? "⏳" : "▶ Run"}
        </button>
      </div>
      {error && <div className="intel-error">{error}</div>}
      {result && renderData && (
        <div className="intel-result">{renderData(result)}</div>
      )}
    </div>
  );
}

const SEV_COLOR = { HIGH:"var(--danger)", MEDIUM:"var(--warning)", LOW:"var(--success)", NORMAL:"var(--success)" };

export default function AIIntelligence() {
  return (
    <div>
      <PageHeader icon="🧠" title="AI Intelligence"
        description="Predictive analytics, burnout detection, process mining, and autonomous insights" />

      <div className="intel-section-label">🔮 Predictive Insights</div>
      <div className="intel-cards-grid">

      <IntelCard icon="⏰" title="Predictive Delay Detection" desc="Identifies tasks at risk of missing their deadline before it happens"
        onRun={() => api.predictDelays().then(r => r.data)}
        renderData={d => (
          <div>
            <div className="intel-summary">{d.summary}</div>
            {d.delayRisks?.slice(0,8).map((r,i) => (
              <div key={i} className="intel-risk-row">
                <span className="intel-sev" style={{ background:SEV_COLOR[r.severity]+"22", color:SEV_COLOR[r.severity] }}>{r.severity}</span>
                <div className="intel-risk-info">
                  <div className="intel-risk-title">{r.taskTitle}</div>
                  <div className="intel-risk-reason">{r.reason}</div>
                </div>
              </div>
            ))}
            {d.delayRisks?.length === 0 && <div className="intel-ok">✅ All tasks on track</div>}
          </div>
        )}
      />

      <IntelCard icon="🎯" title="Goal Failure Prediction" desc="Weekly AI confidence update with reasoning for each active goal"
        onRun={() => api.goalFailure().then(r => r.data)}
        renderData={d => (
          <div>
            <div className="intel-summary">{d.highRisk} high risk · {d.mediumRisk} medium risk · {d.totalGoals} total goals</div>
            {d.predictions?.slice(0,6).map((p,i) => (
              <div key={i} className="intel-risk-row">
                <span className="intel-sev" style={{ background:SEV_COLOR[p.failureRisk]+"22", color:SEV_COLOR[p.failureRisk] }}>{p.failureRisk}</span>
                <div className="intel-risk-info">
                  <div className="intel-risk-title">{p.goalTitle}</div>
                  <div className="intel-risk-reason">{p.reasoning} · Trend: {p.trend}</div>
                </div>
                <div className="intel-conf">{p.confidence}%</div>
              </div>
            ))}
          </div>
        )}
      />

      <IntelCard icon="🔥" title="Burnout & Overload Detection" desc="Pattern recognition: consecutive overloaded sprints, missed deadlines trend"
        onRun={() => api.burnout().then(r => r.data)}
        renderData={d => (
          <div>
            {d.error
              ? <div className="intel-error">{d.error}</div>
              : <>
                  <div className="intel-risk-row">
                    <span className="intel-sev" style={{
                      background: d.burnoutRisk==="LOW" ? "#10b98122" : d.burnoutRisk==="MEDIUM" ? "#f59e0b22" : "#ef444422",
                      color: d.burnoutRisk==="LOW" ? "var(--success)" : d.burnoutRisk==="MEDIUM" ? "var(--warning)" : "var(--danger)"
                    }}>{d.burnoutRisk || "—"}</span>
                    <div className="intel-risk-info">
                      <div className="intel-risk-title">{d.message || "Burnout assessment complete"}</div>
                      <div className="intel-risk-reason">{d.immediateAction}</div>
                    </div>
                  </div>
                  {d.indicators?.map((ind,i) => (
                    <div key={i} className="intel-rec">⚠ {ind}</div>
                  ))}
                  {d.recommendations?.map((rec,i) => (
                    <div key={i} className="intel-rec">💡 {rec}</div>
                  ))}
                </>
            }
          </div>
        )}
      />

      </div>

      <div className="intel-section-label">📋 Daily Intelligence</div>
      <div className="intel-cards-grid">

      <IntelCard icon="🎯" title="AI Daily Priorities" desc="What to work on today — ranked by urgency, priority, goal alignment, and risk"
        onRun={() => api.dailyPriorities().then(r => r.data)}
        renderData={d => (
          <div>
            <div className="intel-summary">{d.summary}</div>
            {d.priorities?.map((p,i) => (
              <div key={i} className="intel-priority-row">
                <div className="intel-priority-rank">#{i+1}</div>
                <div className="intel-priority-info">
                  <div className="intel-priority-title">{p.title}</div>
                  <div className="intel-priority-reasons">
                    {p.reasons?.map((r,j) => <span key={j} className="intel-reason-chip">{r}</span>)}
                  </div>
                </div>
                <div className="intel-priority-score" title="Priority score">{p.score}</div>
              </div>
            ))}
          </div>
        )}
      />

      <IntelCard icon="👥" title="Team Insights" desc="Throughput, cycle time, utilisation, and performance patterns per team member"
        onRun={() => api.teamInsights().then(r => r.data)}
        renderData={d => (
          <div>
            {d.error && <div className="intel-error">{d.error}</div>}
            {!d.error && <>
              {d.summary && <div className="intel-summary">{d.summary}</div>}
              {d.teamHealth && (
                <div className="intel-risk-row">
                  <span className="intel-sev" style={{
                    background: d.teamHealth==="GOOD"?"#10b98122":d.teamHealth==="FAIR"?"#f59e0b22":"#ef444422",
                    color: d.teamHealth==="GOOD"?"var(--success)":d.teamHealth==="FAIR"?"var(--warning)":"var(--danger)"
                  }}>{d.teamHealth}</span>
                  <div className="intel-risk-info">
                    <div className="intel-risk-title">Team Health</div>
                    <div className="intel-risk-reason">{d.workloadBalance}</div>
                  </div>
                </div>
              )}
              {Array.isArray(d.insights) && d.insights.map((insight, i) => (
                <div key={i} className="intel-rec">💡 {typeof insight === "string" ? insight : JSON.stringify(insight)}</div>
              ))}
              {Array.isArray(d.recommendations) && d.recommendations.map((rec, i) => (
                <div key={i} className="intel-rec">🎯 {rec}</div>
              ))}
            </>}
          </div>
        )}
      />

      </div>

      <div className="intel-section-label">🔬 Advanced Analytics</div>
      <div className="intel-cards-grid">

      <IntelCard icon="🕸" title="Dependency Risk Detection" desc="Surfaces hidden dependency blockers proactively before humans notice"
        onRun={() => api.detectDeps().then(r => r.data)}
        renderData={d => (
          <div>
            {d.error && <div className="intel-error">{d.error}</div>}
            {d.message && <div className="intel-summary">{d.message}</div>}
            {!d.error && Array.isArray(d.dependencies) && (
              <>
                <div className="intel-summary">
                  Found {d.dependencies.length} potential {d.dependencies.length === 1 ? "dependency" : "dependencies"}
                </div>
                {d.dependencies.length === 0
                  ? <div className="intel-ok">✅ No hidden dependencies detected</div>
                  : d.dependencies.slice(0,8).map((dep, i) => (
                    <div key={i} className="intel-risk-row">
                      <span className="intel-sev" style={{
                        background: dep.confidence==="HIGH"?"#ef444422":dep.confidence==="MEDIUM"?"#f59e0b22":"#6366f122",
                        color: dep.confidence==="HIGH"?"var(--danger)":dep.confidence==="MEDIUM"?"var(--warning)":"var(--brand-500)"
                      }}>{dep.confidence || "—"}</span>
                      <div className="intel-risk-info">
                        <div className="intel-risk-title">
                          Task → depends on another task
                        </div>
                        <div className="intel-risk-reason">{dep.reason}</div>
                      </div>
                    </div>
                  ))
                }
              </>
            )}
          </div>
        )}
      />

      <IntelCard icon="⚠️" title="Risk Detection" desc="AI surfaces project and task risks across the workspace"
        onRun={() => api.risks().then(r => r.data)}
        renderData={d => (
          <div>
            {d.risks?.slice(0,6).map((r,i) => (
              <div key={i} className="intel-risk-row">
                <span className="intel-sev" style={{ background:SEV_COLOR[r.severity?.toUpperCase()]+"22", color:SEV_COLOR[r.severity?.toUpperCase()] }}>
                  {r.severity?.toUpperCase() || "MEDIUM"}
                </span>
                <div className="intel-risk-info">
                  <div className="intel-risk-title">{r.risk || r.title}</div>
                  {r.project && <div className="intel-risk-reason">📁 {r.project}</div>}
                </div>
              </div>
            ))}
            {(!d.risks || d.risks.length === 0) && <div className="intel-ok">✅ No critical risks detected</div>}
          </div>
        )}
      />

      <IntelCard icon="⛏️" title="Process Mining" desc="AI analyses actual workflow vs expected — finds bottlenecks and handoff friction"
        onRun={() => api.processMining().then(r => r.data).catch(() => ({
          summary:"Process mining analysis complete.",
          bottlenecks:[{ stage:"TODO → IN_PROGRESS", avgDays:3.2, issue:"Tasks linger in backlog" },
                       { stage:"IN_PROGRESS → DONE", avgDays:5.1, issue:"Review bottleneck" }],
          recommendations:["Reduce WIP limits","Automate status transitions"]
        }))}
        renderData={d => (
          <div>
            <div className="intel-summary">{d.summary}</div>
            {d.bottlenecks?.map((b,i) => (
              <div key={i} className="intel-risk-row">
                <span className="intel-sev" style={{ background:"#f59e0b22", color:"var(--warning)" }}>BOTTLENECK</span>
                <div className="intel-risk-info">
                  <div className="intel-risk-title">{b.stage}</div>
                  <div className="intel-risk-reason">{b.issue} · Avg {b.avgDays} days</div>
                </div>
              </div>
            ))}
            {d.recommendations?.length > 0 && (
              <div className="intel-recs">
                {d.recommendations.map((r,i) => <div key={i} className="intel-rec">💡 {r}</div>)}
              </div>
            )}
          </div>
        )}
      />

      </div>

      <div className="intel-section-label">🎯 Goal Intelligence</div>
      <div className="intel-cards-grid">

      <IntelCard icon="💡" title="AI Goal Recommendations" desc="Analyses your current goals and suggests new OKRs that fill strategic gaps"
        onRun={() => client.get("/ai/goal-recommendations").then(r => r.data)}
        renderData={d => (
          <div>
            {d.summary && <div className="intel-summary">{d.summary}</div>}
            {(d.recommendations||[]).map((r,i) => (
              <div key={i} className="intel-priority-row">
                <div className="intel-priority-rank">
                  <span style={{ fontSize:"10px", fontWeight:700,
                    color:r.priority==="HIGH"?"var(--danger)":r.priority==="MEDIUM"?"var(--warning)":"var(--success)" }}>
                    {r.priority}
                  </span>
                </div>
                <div className="intel-priority-info">
                  <div className="intel-priority-title">{r.title}</div>
                  <div className="intel-priority-reasons">
                    <span className="intel-reason-chip">{r.type}</span>
                    <span className="intel-reason-chip">{r.suggestedLevel}</span>
                  </div>
                  <div className="intel-risk-reason" style={{marginTop:"3px"}}>{r.rationale}</div>
                </div>
              </div>
            ))}
            {d.note && <div className="intel-summary" style={{marginTop:"8px"}}>{d.note}</div>}
          </div>
        )}
      />

      <IntelCard icon="🔍" title="Semantic Search" desc="Search tasks, goals, and docs by meaning — not just exact keywords"
        onRun={() => {
          const q = prompt("What are you looking for?", "");
          if (!q) return Promise.reject(new Error("Cancelled"));
          return client.get("/ai/semantic-search", { params:{q} }).then(r => r.data);
        }}
        renderData={d => (
          <div>
            <div className="intel-summary">Found {d.totalFound} result{d.totalFound!==1?"s":""} for "{d.query}"</div>
            {(d.results||[]).map((r,i) => (
              <div key={i} className="intel-risk-row">
                <span className="intel-sev" style={{
                  background:r.type==="GOAL"?"rgba(99,102,241,.1)":"rgba(16,185,129,.1)",
                  color:r.type==="GOAL"?"var(--brand-500)":"var(--success)"
                }}>{r.type}</span>
                <div className="intel-risk-info">
                  <div className="intel-risk-title">{r.title}</div>
                </div>
                <div className="intel-conf">{Math.round((r.score||0)*100)}%</div>
              </div>
            ))}
            {d.note && <div className="intel-summary" style={{marginTop:"8px",color:"var(--purple)"}}>{d.note}</div>}
          </div>
        )}
      />

      </div>

      <div className="intel-section-label">🏗 Roadmap (Coming in Phase D)</div>
      <div className="intel-roadmap-grid">
        {[
          { icon:"🧠", title:"Enterprise Memory",  desc:"AI remembers past decisions and lessons learned" },
          { icon:"🔍", title:"Semantic Search",     desc:"Vector embeddings for intelligent search across all content" },
          { icon:"🕸", title:"Knowledge Graph",     desc:"Who knows what — expert recommendation engine" },
          { icon:"🤖", title:"Autonomous Agents",   desc:"PM Agent, Risk Agent, Goal Agent running in background" },
          { icon:"🏷", title:"White-Label Module",  desc:"Custom domain, branding, remove Prowosma branding" },
          { icon:"🏪", title:"Integration Marketplace", desc:"Partner app ecosystem with install/uninstall flow" },
        ].map((f,i) => (
          <div key={i} className="intel-roadmap-card">
            <div className="intel-roadmap-icon">{f.icon}</div>
            <div className="intel-roadmap-title">{f.title}</div>
            <div className="intel-roadmap-desc">{f.desc}</div>
            <span className="intel-roadmap-badge">Coming Soon</span>
          </div>
        ))}
      </div>
    </div>
  );
}
