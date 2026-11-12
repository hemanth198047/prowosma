import { useState, useEffect, useCallback } from "react";
import { unwrapList } from "../api/client";
import PageHeader from "../components/PageHeader";
import client from "../api/client";
import { useToast } from "../components/ToastContext";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer } from "recharts";

const api = {
  metrics:  (days) => client.get(`/deployments/metrics?days=${days}`),
  list:     (days, env, svc) => client.get(`/deployments?days=${days}${env?`&environment=${env}`:""}${svc?`&service=${svc}`:""}`),
  webhook:  (d)    => client.post("/deployments/webhook", d),
};

const STATUS_META = {
  SUCCESS:  { color:"var(--success)", bg:"rgba(16,185,129,.1)",  label:"Success"  },
  FAILED:   { color:"var(--danger)", bg:"rgba(239,68,68,.1)",   label:"Failed"   },
  ROLLBACK: { color:"var(--warning)", bg:"rgba(245,158,11,.1)",  label:"⏮ Rollback" },
};

const DORA_META = {
  ELITE:  { color:"var(--success)", desc:"Multiple deploys per day" },
  HIGH:   { color:"var(--brand-500)", desc:"Between once per day and once per week" },
  MEDIUM: { color:"var(--warning)", desc:"Between once per week and once per month" },
  LOW:    { color:"var(--danger)", desc:"Less than once per month" },
};

function DoraGauge({ tier }) {
  const tiers = ["LOW","MEDIUM","HIGH","ELITE"];
  return (
    <div className="dep-dora-gauge">
      {tiers.map(t => {
        const m = DORA_META[t];
        const active = t === tier;
        return (
          <div key={t} className={`dep-dora-segment${active?" active":""}`}
            style={{background:active?m.color:"var(--gray-100)",
              color:active?"#fff":"var(--gray-400)"}}>
            {t}
          </div>
        );
      })}
    </div>
  );
}

export default function DeploymentAnalytics() {
  const [metrics,  setMetrics]  = useState(null);
  const [deploys,  setDeploys]  = useState([]);
  const [days,     setDays]     = useState(30);
  const [env,      setEnv]      = useState("");
  const [svc,      setSvc]      = useState("");
  const [showAdd,  setShowAdd]  = useState(false);
  const [form, setForm] = useState({
    environment:"production", status:"SUCCESS", service:"app",
    version:"", commitSha:"", pipeline:"github-actions", durationSec:120, deployedBy:""
  });
  const { show:toast } = useToast();

  const load = useCallback(() => {
    api.metrics(days).then(r => setMetrics(r.data || {})).catch(()=>{});
    api.list(days, env, svc).then(r => setDeploys(unwrapList(r))).catch(()=>{});
  }, [days, env, svc]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    await api.webhook(form);
    setShowAdd(false);
    setForm({environment:"production",status:"SUCCESS",service:"app",version:"",commitSha:"",pipeline:"github-actions",durationSec:120,deployedBy:""});
    load(); toast("Deployment logged","success");
  };

  return (
    <div>
      <PageHeader icon="🚀" title="Deployment Analytics"
        description="DORA metrics, deployment frequency, and failure rate tracking"
        action={<button className="btn-primary" onClick={()=>setShowAdd(v=>!v)}>
          + Log Deployment
        </button>} />

      {/* Manual log form */}
      {showAdd && (
        <div className="dep-add-form">
          <div className="form-row">
            <div className="form-group"><label htmlFor={"deployment-analytics-environment"}>Environment</label>
              <select value={form.environment} onChange={e=>setForm(f=>({...f,environment:e.target.value}))} id={"deployment-analytics-environment"}>
                {["production","staging","beta","development"].map(e=><option key={e}>{e}</option>)}
              </select></div>
            <div className="form-group"><label htmlFor={"deployment-analytics-status"}>Status</label>
              <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} id={"deployment-analytics-status"}>
                <option value="SUCCESS">Success</option>
                <option value="FAILED">Failed</option>
                <option value="ROLLBACK">Rollback</option>
              </select></div>
            <div className="form-group"><label htmlFor={"deployment-analytics-service"}>Service</label>
              <input value={form.service} onChange={e=>setForm(f=>({...f,service:e.target.value}))} placeholder="app" id={"deployment-analytics-service"} /></div>
            <div className="form-group"><label htmlFor={"deployment-analytics-version"}>Version</label>
              <input value={form.version} onChange={e=>setForm(f=>({...f,version:e.target.value}))} placeholder="v1.2.3" id={"deployment-analytics-version"} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label htmlFor={"deployment-analytics-pipeline"}>Pipeline</label>
              <select value={form.pipeline} onChange={e=>setForm(f=>({...f,pipeline:e.target.value}))} id={"deployment-analytics-pipeline"}>
                {["github-actions","gitlab-ci","jenkins","circleci","bitbucket-pipelines","other"].map(p=><option key={p}>{p}</option>)}
              </select></div>
            <div className="form-group"><label htmlFor={"deployment-analytics-duration-sec"}>Duration (sec)</label>
              <input type="number" value={form.durationSec} onChange={e=>setForm(f=>({...f,durationSec:Number(e.target.value)}))} id={"deployment-analytics-duration-sec"} /></div>
            <div className="form-group"><label htmlFor={"deployment-analytics-commit-sha"}>Commit SHA</label>
              <input value={form.commitSha} onChange={e=>setForm(f=>({...f,commitSha:e.target.value}))} placeholder="abc1234" id={"deployment-analytics-commit-sha"} /></div>
            <div className="form-group"><label htmlFor={"deployment-analytics-deployed-by"}>Deployed By</label>
              <input value={form.deployedBy} onChange={e=>setForm(f=>({...f,deployedBy:e.target.value}))} placeholder="ci-bot or name" id={"deployment-analytics-deployed-by"} /></div>
          </div>
          <div className="form-actions">
            <button className="btn-secondary" onClick={()=>setShowAdd(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleAdd}>Log Deployment</button>
          </div>
        </div>
      )}

      {/* Period filter */}
      <div className="intg-filter-bar">
        {[7,14,30,60,90].map(d=>(
          <button key={d} className={`sprint-filter-btn${days===d?" active":""}`}
            onClick={()=>setDays(d)}>Last {d}d</button>
        ))}
        <select aria-label="Filter by environment" value={env} onChange={e=>setEnv(e.target.value)} style={{maxWidth:160, paddingRight:"28px"}}>
          <option value="">All environments</option>
          {["production","staging","beta","development"].map(e=><option key={e}>{e}</option>)}
        </select>
        <input value={svc} onChange={e=>setSvc(e.target.value)} placeholder="Filter by service…" style={{maxWidth:160}} />
      </div>

      {metrics && (
        <>
          {/* DORA performance tier */}
          <div className="dep-dora-card">
            <div className="dep-dora-title">DORA Performance Tier</div>
            <DoraGauge tier={metrics.doraPerformance} />
            <div className="dep-dora-desc" style={{color:DORA_META[metrics.doraPerformance]?.color}}>
              {DORA_META[metrics.doraPerformance]?.desc}
            </div>
          </div>

          {/* Key metrics */}
          <div className="dep-metrics-grid">
            {[
              {icon:"🚀",label:"Total Deployments",value:metrics.totalDeployments ?? 0,color:"var(--brand-500)"},
              {icon:"⚡",label:"Deploy Frequency",value:`${(metrics.deployFrequency ?? 0).toFixed(2)}/day`,color:"var(--success)"},
              {icon:"💥",label:"Change Failure Rate",value:`${(metrics.changeFailureRate ?? 0).toFixed(1)}%`,
                color:(metrics.changeFailureRate??0)>15?"var(--danger)":"var(--success)"},
              {icon:"✅",label:"Success",value:metrics.successCount ?? 0,color:"var(--success)"},
              {icon:"❌",label:"Failed",value:metrics.failedCount ?? 0,color:"var(--danger)"},
              {icon:"⏮",label:"Rollbacks",value:metrics.rollbackCount ?? 0,color:"var(--warning)"},
              {icon:"⏱",label:"Avg Duration",value:metrics.avgDurationSec ? `${Math.round(metrics.avgDurationSec/60)} min` : "0 min",color:"var(--gray-700)"},
            ].map(m=>(
              <div key={m.label} className="dep-metric-card">
                <div className="dep-metric-icon">{m.icon}</div>
                <div className="dep-metric-num" style={{color:m.color}}>{m.value}</div>
                <div className="dep-metric-label">{m.label}</div>
              </div>
            ))}
          </div>

          {/* Daily trend chart */}
          {(metrics.dailyTrend||[]).length > 0 && (
            <div className="dep-chart-card">
              <div className="dep-chart-title">Daily Deployment Trend</div>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={metrics.dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{fontSize:10}} tickFormatter={d=>d.slice(5)} />
                  <YAxis tick={{fontSize:10}} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="var(--brand-500)" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* By environment + by service */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px",marginBottom:"14px"}}>
            <div className="dep-chart-card">
              <div className="dep-chart-title">By Environment</div>
              {Object.entries(metrics.byEnvironment||{}).map(([k,v])=>(
                <div key={k} className="dep-breakdown-row">
                  <span className="dep-breakdown-key">{k}</span>
                  <div className="dep-breakdown-bar-wrap">
                    <div className="dep-breakdown-bar" style={{
                      width:`${Math.round((v/Math.max(1,metrics.totalDeployments))*100)}%`}} />
                  </div>
                  <span className="dep-breakdown-val">{v}</span>
                </div>
              ))}
            </div>
            <div className="dep-chart-card">
              <div className="dep-chart-title">By Service</div>
              {Object.entries(metrics.byService||{}).map(([k,v])=>(
                <div key={k} className="dep-breakdown-row">
                  <span className="dep-breakdown-key">{k}</span>
                  <div className="dep-breakdown-bar-wrap">
                    <div className="dep-breakdown-bar" style={{
                      width:`${Math.round((v/Math.max(1,metrics.totalDeployments))*100)}%`,
                      background:"var(--success)"}} />
                  </div>
                  <span className="dep-breakdown-val">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Deployment log */}
      <div className="dep-chart-card">
        <div className="dep-chart-title">Deployment Log</div>
        {deploys.length === 0 ? (
          <div className="empty-state">No deployments in this period. Log one above or connect your CI/CD webhook to <code>POST /api/deployments/webhook</code></div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
            {deploys.map(d => {
              const sm = STATUS_META[d.status] || STATUS_META.SUCCESS;
              return (
                <div key={d.id} className="dep-log-row">
                  <span className="dep-log-status"
                    style={{background:sm.bg,color:sm.color}}>{sm.label}</span>
                  <span className="dep-log-env">{d.environment}</span>
                  <span className="dep-log-svc">{d.service}</span>
                  {d.version && <span className="dep-log-ver">{d.version}</span>}
                  <span className="dep-log-time">
                    {new Date(d.timestamp).toLocaleString([],{dateStyle:"short",timeStyle:"short"})}
                  </span>
                  {d.durationSec > 0 && (
                    <span className="dep-log-dur">{Math.round(d.durationSec/60)}min</span>
                  )}
                  <span className="dep-log-by">{d.deployedBy}</span>
                  {d.commitSha && (
                    <code className="dep-log-sha">{d.commitSha.slice(0,7)}</code>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
