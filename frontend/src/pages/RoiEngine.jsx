import { useState, useEffect } from "react";
import { unwrapList } from "../api/client";
import PageHeader from "../components/PageHeader";
import client from "../api/client";
import { getProjects } from "../api/projects";
import { useToast } from "../components/ToastContext";
import {
  BarChart, Bar, XAxis, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";

// ROI Engine API — backed by RoiController at /api/roi
const getPortfolioRoi = ()          => client.get("/roi/calculate");
const getProjectRoi   = (id)        => client.get("/roi/calculate", { params: { projectId: id } });
const addRevenue      = (id, d)     => client.post("/roi", { ...d, projectId: id, type: "BENEFIT" });
const updateRoiSettings=(id,d)      => client.post("/roi", { ...d, projectId: id });

const HEALTH_META = {
  EXCELLENT:   { label:"Excellent ROI",   color:"#10b981", icon:"🚀" },
  GOOD:        { label:"Good ROI",        color:"#6366f1", icon:"✅" },
  BREAK_EVEN:  { label:"Break Even",      color:"#f59e0b", icon:"⚖️" },
  NEGATIVE:    { label:"Negative ROI",    color:"#ef4444", icon:"⚠️" },
};

function ProjectRoiCard({ project, onUpdate }) {
  const [roi,       setRoi]       = useState(null);
  const [showAdd,   setShowAdd]   = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [revForm,   setRevForm]   = useState({description:"",amount:"",type:"DIRECT"});
  const [roiForm,   setRoiForm]   = useState({expectedRevenue:"",laborCost:"",roiCategory:"EFFICIENCY"});
  const { show:toast } = useToast();

  useEffect(()=>{
    getProjectRoi(project.id).then(r=>setRoi(r.data)).catch(()=>{});
  },[project.id]);

  const handleAddRevenue = async () => {
    if (!revForm.amount) return;
    await addRevenue(project.id, {...revForm, amount:Number(revForm.amount)});
    const r = await getProjectRoi(project.id);
    setRoi(r.data);
    setShowAdd(false);
    setRevForm({description:"",amount:"",type:"DIRECT"});
    toast("Revenue logged","success");
    onUpdate();
  };

  const handleSaveSettings = async () => {
    await updateRoiSettings(project.id, {
      expectedRevenue: Number(roiForm.expectedRevenue)||undefined,
      laborCost:       Number(roiForm.laborCost)||undefined,
      roiCategory:     roiForm.roiCategory,
    });
    const r = await getProjectRoi(project.id);
    setRoi(r.data);
    setShowSettings(false);
    toast("ROI settings saved","success");
    onUpdate();
  };

  if (!roi) return (
    <div className="roi-card">
      <div className="roi-card-name">{project.name}</div>
      <div style={{fontSize:"12px",color:"var(--gray-400)"}}>Loading ROI data…</div>
    </div>
  );

  const hm = HEALTH_META[roi.roiHealth] || HEALTH_META.BREAK_EVEN;
  const roiPct = roi.roi || 0;
  const roiColor = roiPct > 0 ? "#10b981" : "#ef4444";

  return (
    <div className="roi-card">
      <div className="roi-card-header">
        <div>
          <div className="roi-card-name">{roi.projectName}</div>
          {roi.category && <div className="roi-card-category">{roi.category}</div>}
        </div>
        <span className="roi-health-chip" style={{color:hm.color,background:`${hm.color}18`}}>
          {hm.icon} {hm.label}
        </span>
      </div>

      {/* Key metrics */}
      <div className="roi-metrics">
        <div className="roi-metric">
          <div className="roi-metric-num" style={{color:roiColor}}>{roiPct}%</div>
          <div className="roi-metric-label">ROI</div>
        </div>
        <div className="roi-metric">
          <div className="roi-metric-num">${(roi.totalInvestment||0).toLocaleString()}</div>
          <div className="roi-metric-label">Investment</div>
        </div>
        <div className="roi-metric">
          <div className="roi-metric-num" style={{color:"#10b981"}}>
            ${(roi.actualRevenue||0).toLocaleString()}
          </div>
          <div className="roi-metric-label">Revenue</div>
        </div>
        <div className="roi-metric">
          <div className="roi-metric-num">
            {roi.paybackMonths && roi.paybackMonths !== "N/A" ? `${roi.paybackMonths} mo` : "—"}
          </div>
          <div className="roi-metric-label">Payback</div>
        </div>
      </div>

      {/* Progress to target */}
      {roi.expectedRevenue > 0 && (
        <div style={{marginBottom:"10px"}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:"11px",color:"var(--gray-400)",marginBottom:"4px"}}>
            <span>vs target ${(roi.expectedRevenue||0).toLocaleString()}</span>
            <span>{Math.round((roi.actualRevenue/roi.expectedRevenue)*100)}%</span>
          </div>
          <div className="kpi-progress-bar">
            <div className="kpi-progress-fill"
              style={{width:`${Math.min(100,Math.round((roi.actualRevenue/roi.expectedRevenue)*100))}%`,
                background:roiColor}} />
          </div>
        </div>
      )}

      {/* Revenue log */}
      {(roi.revenueLog||[]).length > 0 && (
        <div className="roi-revenue-log">
          {roi.revenueLog.slice(0,3).map(r=>(
            <div key={r.id} className="roi-revenue-row">
              <span className="roi-rev-type">{r.type}</span>
              <span className="roi-rev-desc">{r.description}</span>
              <span className="roi-rev-amount">+${r.amount?.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="roi-card-actions">
        <button className="btn-secondary" style={{fontSize:"11px"}}
          onClick={()=>setShowSettings(v=>!v)}>⚙️ Settings</button>
        <button className="btn-primary" style={{fontSize:"11px"}}
          onClick={()=>setShowAdd(v=>!v)}>+ Revenue</button>
      </div>

      {showAdd && (
        <div className="roi-add-form">
          <div className="form-row">
            <div className="form-group" style={{flex:2}}><label htmlFor={"roi-engine-description"}>Description</label>
              <input value={revForm.description} onChange={e=>setRevForm(f=>({...f,description:e.target.value}))}
                placeholder="e.g. Q3 licence renewal" id={"roi-engine-description"} /></div>
            <div className="form-group"><label htmlFor={"roi-engine-amount"}>Amount ($)</label>
              <input type="number" value={revForm.amount} onChange={e=>setRevForm(f=>({...f,amount:e.target.value}))} id={"roi-engine-amount"} /></div>
            <div className="form-group"><label htmlFor={"roi-engine-type"}>Type</label>
              <select value={revForm.type} onChange={e=>setRevForm(f=>({...f,type:e.target.value}))} id={"roi-engine-type"}>
                <option value="DIRECT">Direct</option>
                <option value="INDIRECT">Indirect</option>
                <option value="COST_SAVING">Cost Saving</option>
              </select></div>
          </div>
          <div className="form-actions">
            <button className="btn-secondary" onClick={()=>setShowAdd(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleAddRevenue}>Add</button>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="roi-add-form">
          <div className="form-row">
            <div className="form-group"><label htmlFor={"roi-engine-expected-revenue"}>Expected Revenue ($)</label>
              <input type="number" value={roiForm.expectedRevenue}
                onChange={e=>setRoiForm(f=>({...f,expectedRevenue:e.target.value}))}
                placeholder={roi.expectedRevenue||0} id={"roi-engine-expected-revenue"} /></div>
            <div className="form-group"><label htmlFor={"roi-engine-labour-cost"}>Labour Cost ($)</label>
              <input type="number" value={roiForm.laborCost}
                onChange={e=>setRoiForm(f=>({...f,laborCost:e.target.value}))}
                placeholder={roi.laborCost||0} id={"roi-engine-labour-cost"} /></div>
            <div className="form-group"><label htmlFor={"roi-engine-category"}>Category</label>
              <select value={roiForm.roiCategory} onChange={e=>setRoiForm(f=>({...f,roiCategory:e.target.value}))} id={"roi-engine-category"}>
                <option value="COST_REDUCTION">Cost Reduction</option>
                <option value="REVENUE_GROWTH">Revenue Growth</option>
                <option value="EFFICIENCY">Efficiency</option>
                <option value="COMPLIANCE">Compliance</option>
                <option value="STRATEGIC">Strategic</option>
              </select></div>
          </div>
          <div className="form-actions">
            <button className="btn-secondary" onClick={()=>setShowSettings(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleSaveSettings}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RoiEngine() {
  const [projects,  setProjects]  = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const { show:toast } = useToast();

  useEffect(()=>{
    getProjects().then(r=>setProjects(unwrapList(r))).catch(()=>toast("Failed to load projects", "error"));
    // Was unwrapList(r) — /roi/calculate returns the portfolio ROI summary
    // object directly, not a list; this panel has likely always shown
    // blank ROI figures.
    getPortfolioRoi().then(r=>setPortfolio(r.data)).catch(()=>toast("Failed to load ROI summary", "error"));
  },[toast]);

  const refreshPortfolio = () => {
    getPortfolioRoi().then(r=>setPortfolio(r.data)).catch(()=>toast("Failed to load ROI summary", "error"));
  };

  const portfolioRoiColor = portfolio?.portfolioRoi >= 0 ? "#10b981" : "#ef4444";
  const chartData = portfolio?.breakdown?.map(b=>({
    name: b.name?.slice(0,12)||"?",
    roi:  Number(b.roi)||0,
    health: b.health,
  })) || [];

  return (
    <div>
      <PageHeader icon="💰" title="ROI Engine"
        description="Track return on investment, revenue, and payback period across all projects" />

      {/* Portfolio summary */}
      {portfolio && (
        <div className="roi-portfolio-banner">
          <div className="roi-portfolio-stat">
            <div className="roi-portfolio-num" style={{color:portfolioRoiColor}}>
              {portfolio.portfolioRoi != null ? portfolio.portfolioRoi + '%' : '—'}
            </div>
            <div className="roi-portfolio-label">Portfolio ROI</div>
          </div>
          <div className="roi-portfolio-stat">
            <div className="roi-portfolio-num">${(portfolio.totalInvestment||0).toLocaleString()}</div>
            <div className="roi-portfolio-label">Total Investment</div>
          </div>
          <div className="roi-portfolio-stat">
            <div className="roi-portfolio-num" style={{color:"#10b981"}}>
              ${(portfolio.totalRevenue||0).toLocaleString()}
            </div>
            <div className="roi-portfolio-label">Total Revenue</div>
          </div>
          <div className="roi-portfolio-stat">
            <div className="roi-portfolio-num" style={{color:"#6366f1"}}>
              {(portfolio.positiveRoiProjects ?? '0')}/{portfolio.totalProjects ?? '0'}
            </div>
            <div className="roi-portfolio-label">Positive ROI</div>
          </div>

          {chartData.length > 1 && (
            <div className="roi-portfolio-chart">
              <ResponsiveContainer width="100%" height={80}>
                <BarChart data={chartData} margin={{top:0,right:0,bottom:0,left:0}}>
                  <XAxis dataKey="name" tick={{fontSize:9}} />
                  <Tooltip formatter={v=>[`${v}%`,"ROI"]} />
                  <ReferenceLine y={0} stroke="var(--gray-300)" />
                  <Bar dataKey="roi" radius={[3,3,0,0]}>
                    {chartData.map((d,i)=>(
                      <Cell key={i} fill={d.roi>=0?"#10b981":"#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Project ROI cards */}
      <div className="roi-projects-grid">
        {projects.map(p=>(
          <ProjectRoiCard key={p.id} project={p} onUpdate={refreshPortfolio} />
        ))}
        {projects.length===0 && (
          <div className="empty-state">No projects found. Create projects to track ROI.</div>
        )}
      </div>
    </div>
  );
}
