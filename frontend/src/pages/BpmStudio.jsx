import { unwrapList } from "../api/client";
import { useState, useEffect, useRef, useCallback } from "react";
import PageHeader from "../components/PageHeader";
import client from "../api/client";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";

// ── API ───────────────────────────────────────────────────────────────────────
const api = {
  getProcesses:  ()          => client.get("/bpm/processes"),
  getProcess:    (id)        => client.get(`/bpm/processes/${id}`),
  saveProcess:   (data)      => data.id ? client.put(`/bpm/processes/${data.id}`,data) : client.post("/bpm/processes",data),
  deleteProcess: (id)        => client.delete(`/bpm/processes/${id}`),
  getInstances:  (pid)       => client.get("/bpm/instances", { params: pid?{processId:pid}:{} }),
  startProcess:  (pid, vars) => client.post(`/bpm/processes/${pid}/start`, vars||{}),
  humanDecide:   (id, body)  => client.post(`/bpm/instances/${id}/decide`, body),
  aiOverride:    (id, body)  => client.post(`/bpm/instances/${id}/override`, body),
};

// ── Node type metadata ────────────────────────────────────────────────────────
const NODE_TYPES = [
  { type:"TRIGGER",        label:"Trigger",       icon:"⚡", color:"#1E8E5A", bg:"#ecfdf5", desc:"Entry point — starts the workflow" },
  { type:"AI_STEP",        label:"AI Step",       icon:"🤖", color:"#5B5FEE", bg:"var(--brand-50)", desc:"AI performs a task, optionally reviewed by human" },
  { type:"HUMAN_APPROVAL", label:"Human Review",  icon:"👤", color:"#C17D22", bg:"#fffbeb", desc:"Pauses and waits for a human decision" },
  { type:"CONDITION",      label:"Condition",     icon:"⬡",  color:"#7C5CBF", bg:"#f5f3ff", desc:"Routes flow based on a variable" },
  { type:"ACTION",         label:"Action",        icon:"⚙️", color:"#3b82f6", bg:"#eff6ff", desc:"Runs an automated action" },
  { type:"FORK",           label:"Fork",          icon:"⑂",  color:"#ec4899", bg:"#fdf2f8", desc:"Splits into parallel branches" },
  { type:"END",            label:"End",           icon:"⏹",  color:"#64748b", bg:"var(--gray-50)", desc:"Terminates the workflow" },
];

const STATUS_META = {
  RUNNING:       { label:"Running",        color:"#0ea5e9", bg:"rgba(14,165,233,.1)",  icon:"▶" },
  WAITING_HUMAN: { label:"Needs Review",   color:"#C17D22", bg:"rgba(245,158,11,.1)",  icon:"⏸" },
  WAITING_AI:    { label:"AI Processing",  color:"#5B5FEE", bg:"rgba(99,102,241,.1)",  icon:"🤖" },
  COMPLETED:     { label:"Completed",      color:"#1E8E5A", bg:"rgba(16,185,129,.1)",  icon:"✓" },
  FAILED:        { label:"Failed",         color:"#D64545", bg:"rgba(239,68,68,.1)",   icon:"✕" },
  CANCELLED:     { label:"Cancelled",      color:"#64748b", bg:"rgba(100,116,139,.1)", icon:"—" },
};

// ── Built-in templates ────────────────────────────────────────────────────────
const TEMPLATES = [
  {
    name:"Project Approval",
    description:"AI reviews the project brief, then a manager approves or rejects it.",
    category:"PRODUCT", icon:"📁",
    nodes:[
      {id:"t1",  type:"TRIGGER",        label:"Project Submitted",    x:340,y:40,  config:{}},
      {id:"a1",  type:"AI_STEP",        label:"AI Brief Analysis",    x:340,y:160, config:{prompt:"Analyse this project brief. Identify goals, risks, feasibility, resource needs, and give a recommendation (APPROVE/REJECT) with justification.",requiresHumanReview:true}},
      {id:"h1",  type:"HUMAN_APPROVAL", label:"Manager Decision",     x:340,y:300, config:{approvers:"manager@company.com"}},
      {id:"ac1", type:"ACTION",         label:"Notify Team — Approved",x:180,y:440, config:{actionType:"NOTIFY",title:"Project Approved",message:"Your project has been approved. Proceed to planning."}},
      {id:"ac2", type:"ACTION",         label:"Notify — Rejected",     x:500,y:440, config:{actionType:"NOTIFY",title:"Project Needs Revision",message:"Please revise your project brief based on feedback."}},
      {id:"e1",  type:"END",            label:"Done",                  x:340,y:560, config:{}},
    ],
    transitions:[
      {id:"tr1",fromNodeId:"t1", toNodeId:"a1",  label:""},
      {id:"tr2",fromNodeId:"a1", toNodeId:"h1",  label:"Review ready"},
      {id:"tr3",fromNodeId:"h1", toNodeId:"ac1", label:"Approved"},
      {id:"tr4",fromNodeId:"h1", toNodeId:"ac2", label:"Rejected"},
      {id:"tr5",fromNodeId:"ac1",toNodeId:"e1",  label:""},
      {id:"tr6",fromNodeId:"ac2",toNodeId:"e1",  label:""},
    ],
  },
  {
    name:"Task Escalation",
    description:"Auto-escalate overdue tasks: AI assesses urgency, team lead decides action.",
    category:"PRODUCT", icon:"✅",
    nodes:[
      {id:"t1", type:"TRIGGER",        label:"Task Overdue",        x:340,y:40,  config:{}},
      {id:"a1", type:"AI_STEP",        label:"AI Urgency Assessment",x:340,y:160, config:{prompt:"Assess this overdue task's urgency. Check due date, assignee workload, task priority, and dependencies. Recommend: ESCALATE, REASSIGN, or EXTEND.",requiresHumanReview:false}},
      {id:"c1", type:"CONDITION",      label:"Is Critical?",        x:340,y:300, config:{variable:"priority",value:"HIGH"}},
      {id:"h1", type:"HUMAN_APPROVAL", label:"Team Lead Decision",  x:180,y:440, config:{approvers:"lead@company.com"}},
      {id:"ac1",type:"ACTION",         label:"Send Reminder",       x:500,y:440, config:{actionType:"NOTIFY",title:"Task Reminder",message:"Your task is overdue. Please update status."}},
      {id:"e1", type:"END",            label:"Done",                x:340,y:560, config:{}},
    ],
    transitions:[
      {id:"tr1",fromNodeId:"t1", toNodeId:"a1",  label:""},
      {id:"tr2",fromNodeId:"a1", toNodeId:"c1",  label:"Assessment done"},
      {id:"tr3",fromNodeId:"c1", toNodeId:"h1",  label:"Yes — critical"},
      {id:"tr4",fromNodeId:"c1", toNodeId:"ac1", label:"No — reminder only"},
      {id:"tr5",fromNodeId:"h1", toNodeId:"e1",  label:""},
      {id:"tr6",fromNodeId:"ac1",toNodeId:"e1",  label:""},
    ],
  },
  {
    name:"Goal Review Cycle",
    description:"Quarterly goal review: AI generates report, leadership approves next cycle.",
    category:"PRODUCT", icon:"🎯",
    nodes:[
      {id:"t1", type:"TRIGGER",        label:"Quarter End",           x:340,y:40,  config:{}},
      {id:"a1", type:"AI_STEP",        label:"AI Progress Report",    x:340,y:160, config:{prompt:"Generate a comprehensive goal progress report. Analyse achievements vs targets, identify blockers, highlight wins, and recommend adjustments for next quarter.",requiresHumanReview:true}},
      {id:"h1", type:"HUMAN_APPROVAL", label:"Leadership Review",     x:340,y:300, config:{approvers:"exec@company.com"}},
      {id:"a2", type:"AI_STEP",        label:"AI Next Quarter Plan",  x:180,y:440, config:{prompt:"Based on the approved review and current team capacity, generate a realistic OKR plan for next quarter with 3-5 key results.",requiresHumanReview:true}},
      {id:"ac1",type:"ACTION",         label:"Publish Report",        x:500,y:440, config:{actionType:"NOTIFY",title:"Goal Report Published",message:"The quarterly review has been completed and published."}},
      {id:"e1", type:"END",            label:"Done",                  x:340,y:560, config:{}},
    ],
    transitions:[
      {id:"tr1",fromNodeId:"t1", toNodeId:"a1",  label:""},
      {id:"tr2",fromNodeId:"a1", toNodeId:"h1",  label:"Report ready"},
      {id:"tr3",fromNodeId:"h1", toNodeId:"a2",  label:"Approved — plan next"},
      {id:"tr4",fromNodeId:"h1", toNodeId:"ac1", label:"Noted — publish only"},
      {id:"tr5",fromNodeId:"a2", toNodeId:"e1",  label:""},
      {id:"tr6",fromNodeId:"ac1",toNodeId:"e1",  label:""},
    ],
  },
  {
    name:"New Member Onboarding",
    description:"Automated onboarding: AI creates a personalised plan, manager assigns mentor.",
    category:"HR", icon:"👥",
    nodes:[
      {id:"t1", type:"TRIGGER",        label:"Member Joined",          x:340,y:40,  config:{}},
      {id:"a1", type:"AI_STEP",        label:"AI Onboarding Plan",     x:340,y:160, config:{prompt:"Create a 30-60-90 day onboarding plan for a new team member. Include learning goals, key people to meet, tools to set up, and first week tasks. Tailor to their role.",requiresHumanReview:true}},
      {id:"h1", type:"HUMAN_APPROVAL", label:"Manager Approves Plan",  x:340,y:300, config:{approvers:"manager@company.com"}},
      {id:"ac1",type:"ACTION",         label:"Assign Buddy / Mentor",  x:340,y:440, config:{actionType:"NOTIFY",title:"Onboarding Started",message:"Welcome! Your onboarding plan is ready. Your buddy will reach out today."}},
      {id:"e1", type:"END",            label:"Done",                   x:340,y:560, config:{}},
    ],
    transitions:[
      {id:"tr1",fromNodeId:"t1", toNodeId:"a1",  label:""},
      {id:"tr2",fromNodeId:"a1", toNodeId:"h1",  label:"Plan ready"},
      {id:"tr3",fromNodeId:"h1", toNodeId:"ac1", label:"Approved"},
      {id:"tr4",fromNodeId:"ac1",toNodeId:"e1",  label:""},
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// CANVAS — Visual Workflow Designer
// ═══════════════════════════════════════════════════════════════════════════════
function WorkflowCanvas({ process, onChange }) {
  const [selected,   setSelected]   = useState(null);
  const [connecting, setConnecting] = useState(null);
  const [pan,        setPan]        = useState({x:0,y:0});
  const [panning,    setPanning]    = useState(false);
  const panRef = useRef(null);
  const canvasRef = useRef(null);

  const nodes       = process.nodes       || [];
  const transitions = process.transitions || [];

  const addNode = (type) => {
    const meta = NODE_TYPES.find(n => n.type === type);
    // eslint-disable-next-line react-hooks/purity -- click-triggered handler, not render
    const id = `n_${Date.now()}`;
    onChange({
      ...process,
      // eslint-disable-next-line react-hooks/purity -- same handler, not render
      nodes: [...nodes, { id, type, label:meta.label, x:60+Math.random()*300, y:60+nodes.length*130, config:{} }],
    });
    setSelected(id);
  };

  const deleteNode = (id) => {
    onChange({ ...process, nodes:nodes.filter(n=>n.id!==id), transitions:transitions.filter(t=>t.fromNodeId!==id&&t.toNodeId!==id) });
    setSelected(null);
  };

  const updateNode = (id, patch) =>
    onChange({ ...process, nodes:nodes.map(n=>n.id===id?{...n,...patch}:n) });

  const updateConfig = (id, key, val) =>
    onChange({ ...process, nodes:nodes.map(n=>n.id===id?{...n,config:{...n.config,[key]:val}}:n) });

  const addTransition = (fromId, toId) => {
    if (fromId===toId) return;
    if (transitions.find(t=>t.fromNodeId===fromId&&t.toNodeId===toId)) return;
    // eslint-disable-next-line react-hooks/purity -- click-triggered handler, not render
    onChange({ ...process, transitions:[...transitions,{id:`tr_${Date.now()}`,fromNodeId:fromId,toNodeId:toId,label:""}] });
    setConnecting(null);
  };

  const deleteTransition = (id) =>
    onChange({ ...process, transitions:transitions.filter(t=>t.id!==id) });

  const selectedNode = nodes.find(n=>n.id===selected);
  const selectedMeta = selectedNode ? NODE_TYPES.find(m=>m.type===selectedNode.type) : null;

  // Canvas pan
  const onCanvasMouseDown = (e) => {
    if (e.target === canvasRef.current || e.target.tagName === "svg" || e.target.tagName === "SVG") {
      setPanning(true);
      panRef.current = {x:e.clientX-pan.x, y:e.clientY-pan.y};
      setSelected(null); setConnecting(null);
    }
  };
  const onCanvasMouseMove = useCallback((e) => {
    if (!panning||!panRef.current) return;
    setPan({x:e.clientX-panRef.current.x, y:e.clientY-panRef.current.y});
  }, [panning]);
  const onCanvasMouseUp = () => setPanning(false);

  return (
    <div style={{ display:"flex", height:"100%", minHeight:0, overflow:"hidden" }}>

      {/* LEFT TOOLBOX */}
      <div style={{ width:180, flexShrink:0, borderRight:"1px solid var(--border)", background:"var(--gray-50)",
        display:"flex", flexDirection:"column", gap:0, overflowY:"auto", padding:"12px 10px" }}>
        <div style={{ fontSize:"10px", fontWeight:800, color:"#94a3b8", letterSpacing:".07em",
          textTransform:"uppercase", marginBottom:"10px" }}>Node Types</div>
        {NODE_TYPES.map(m => (
          <button key={m.type} onClick={() => addNode(m.type)} title={m.desc}
            style={{ display:"flex", alignItems:"center", gap:"8px", padding:"8px 10px",
              borderRadius:"8px", border:"1px solid transparent", background:"transparent",
              cursor:"pointer", marginBottom:"3px", textAlign:"left", transition:"all .13s" }}
            onMouseEnter={e=>{ e.currentTarget.style.background=m.bg; e.currentTarget.style.borderColor=m.color+"33"; }}
            onMouseLeave={e=>{ e.currentTarget.style.background="transparent"; e.currentTarget.style.borderColor="transparent"; }}>
            <span style={{ width:28, height:28, borderRadius:"7px", background:m.bg,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:"14px", flexShrink:0, border:`1px solid ${m.color}22` }}>{m.icon}</span>
            <div>
              <div style={{ fontSize:"11px", fontWeight:700, color:"#334155", lineHeight:1.2 }}>{m.label}</div>
              <div style={{ fontSize:"9px", color:"#94a3b8", lineHeight:1.3 }}>{m.desc}</div>
            </div>
          </button>
        ))}
        <div style={{ marginTop:"auto", padding:"10px 6px", fontSize:"10px", color:"#94a3b8",
          borderTop:"1px solid var(--gray-100)", lineHeight:1.6 }}>
          Click to add nodes.<br/>
          Drag nodes to move.<br/>
          Use → Link to connect.
        </div>
      </div>

      {/* MAIN CANVAS */}
      <div ref={canvasRef} style={{ flex:1, position:"relative", overflow:"hidden",
        background:"var(--gray-50)", cursor:panning?"grabbing":"default",
        backgroundImage:"radial-gradient(var(--border) 1px, transparent 1px)",
        backgroundSize:"24px 24px" }}
        onMouseDown={onCanvasMouseDown}
        onMouseMove={onCanvasMouseMove}
        onMouseUp={onCanvasMouseUp}
        onMouseLeave={onCanvasMouseUp} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onCanvasMouseDown)?.(e); } }}>

        <div style={{ position:"absolute", transform:`translate(${pan.x}px,${pan.y}px)`, width:"100%", height:"100%" }}>
          {/* SVG for edges */}
          <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", overflow:"visible", pointerEvents:"none" }}>
            <defs>
              <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="var(--gray-400)" />
              </marker>
              <marker id="arr-active" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="var(--brand-500)" />
              </marker>
            </defs>
            {transitions.map(t => {
              const from = nodes.find(n=>n.id===t.fromNodeId);
              const to   = nodes.find(n=>n.id===t.toNodeId);
              if (!from||!to) return null;
              const x1=from.x+90, y1=from.y+40;
              const x2=to.x+90,   y2=to.y;
              const cx1=x1, cy1=(y1+y2)/2;
              const cx2=x2, cy2=(y1+y2)/2;
              const mx=(x1+x2)/2, my=(y1+y2)/2;
              const isConn = connecting===from.id||connecting===to.id;
              return (
                <g key={t.id} style={{ pointerEvents:"all" }}>
                  <path d={`M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`}
                    fill="none" stroke={isConn?"var(--brand-500)":"var(--gray-300)"} strokeWidth={isConn?2:1.5}
                    markerEnd={isConn?"url(#arr-active)":"url(#arr)"} />
                  {t.label && (
                    <text x={mx} y={my-6} textAnchor="middle" fontSize={9} fill="var(--gray-500)"
                      style={{ background:"white" }}>{t.label}</text>
                  )}
                  {/* Delete edge button */}
                  <circle cx={mx} cy={my} r={7} fill="white" stroke="var(--border)"
                    strokeWidth={1.5} style={{ cursor:"pointer" }}
                    onClick={() => deleteTransition(t.id)} />
                  <text x={mx} y={my+3.5} textAnchor="middle" fontSize={9}
                    fill="var(--gray-400)" style={{ cursor:"pointer", pointerEvents:"none" }}>✕</text>
                </g>
              );
            })}
          </svg>

          {/* Nodes */}
          {nodes.map(node => {
            const meta = NODE_TYPES.find(m=>m.type===node.type)||NODE_TYPES[0];
            const isSel = selected===node.id;
            const isConnSrc = connecting===node.id;
            return (
              <div key={node.id}
                style={{ position:"absolute", left:node.x, top:node.y,
                  width:180, borderRadius:"12px", overflow:"hidden",
                  border:`2px solid ${isSel?meta.color:isConnSrc?"var(--brand-500)":"var(--border)"}`,
                  background:"#fff", boxShadow: isSel?`0 4px 20px ${meta.color}22`:"0 2px 8px rgba(0,0,0,.06)",
                  cursor:"grab", userSelect:"none", zIndex: isSel?10:1,
                  transition:"box-shadow .15s, border-color .15s" }}
                onClick={e=>{ e.stopPropagation(); setSelected(node.id); }}
                onMouseDown={e=>{
                  if (e.button!==0) return;
                  const ox=e.clientX-node.x, oy=e.clientY-node.y;
                  const onMove = ev => updateNode(node.id,{x:ev.clientX-ox-pan.x, y:ev.clientY-oy-pan.y});
                  const onUp   = ()  => { window.removeEventListener("mousemove",onMove); window.removeEventListener("mouseup",onUp); };
                  window.addEventListener("mousemove",onMove); window.addEventListener("mouseup",onUp);
                }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (e=>{ e.stopPropagation(); setSelected(node.id); })?.(e); } }}>
                {/* Header */}
                <div style={{ display:"flex", alignItems:"center", gap:"6px", padding:"7px 10px",
                  background:meta.bg, borderBottom:`1.5px solid ${meta.color}33` }}>
                  <span style={{ fontSize:"14px" }}>{meta.icon}</span>
                  <span style={{ fontSize:"9px", fontWeight:800, color:meta.color,
                    textTransform:"uppercase", letterSpacing:".05em", flex:1 }}>{meta.label}</span>
                  <button onClick={e=>{e.stopPropagation();deleteNode(node.id);}}
                    style={{ background:"none", border:"none", cursor:"pointer",
                      color:"#94a3b8", fontSize:"12px", padding:"0 2px", lineHeight:1 }}
                    title="Delete node">✕</button>
                </div>
                {/* Label */}
                <div style={{ padding:"8px 10px 6px", fontSize:"12px", fontWeight:700,
                  color:"#1e293b", lineHeight:1.3 }}>{node.label}</div>
                {/* Connect button */}
                <div style={{ padding:"0 8px 8px", display:"flex", gap:"4px" }}>
                  <button onClick={e=>{e.stopPropagation();setConnecting(isConnSrc?null:node.id);}}
                    style={{ flex:1, padding:"3px 8px", borderRadius:"6px", border:"none",
                      fontSize:"10px", fontWeight:700, cursor:"pointer", transition:"all .12s",
                      background: isConnSrc?"var(--brand-500)":"var(--gray-100)",
                      color: isConnSrc?"#fff":"var(--gray-500)" }}>
                    {isConnSrc?"✓ Connecting…":"→ Connect"}
                  </button>
                  {connecting && connecting!==node.id && (
                    <button onClick={e=>{e.stopPropagation();addTransition(connecting,node.id);}}
                      style={{ padding:"3px 8px", borderRadius:"6px", border:"1.5px solid var(--brand-500)",
                        background:"var(--brand-50)", color:"#5B5FEE", fontSize:"10px",
                        fontWeight:700, cursor:"pointer" }}>
                      Link here
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {nodes.length===0 && (
            <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
              alignItems:"center", justifyContent:"center", gap:"10px", pointerEvents:"none" }}>
              <div style={{ fontSize:"48px" }}>🔀</div>
              <div style={{ fontWeight:700, fontSize:"16px", color:"#64748b" }}>
                Click a node type on the left to start building
              </div>
              <div style={{ fontSize:"13px", color:"#94a3b8" }}>
                Or load a template from the library
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT — Node Inspector */}
      {selectedNode && (
        <div style={{ width:260, flexShrink:0, borderLeft:"1px solid var(--border)",
          background:"#fff", overflowY:"auto", display:"flex", flexDirection:"column" }}>
          {/* Header */}
          <div style={{ padding:"12px 14px", background:selectedMeta?.bg,
            borderBottom:`2px solid ${selectedMeta?.color}33`,
            display:"flex", alignItems:"center", gap:"8px" }}>
            <span style={{ fontSize:"18px" }}>{selectedMeta?.icon}</span>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, fontSize:"12px", color:selectedMeta?.color,
                textTransform:"uppercase", letterSpacing:".05em" }}>{selectedMeta?.label}</div>
            </div>
            <button onClick={()=>setSelected(null)} style={{ background:"none", border:"none",
              cursor:"pointer", color:"#94a3b8", fontSize:"14px" }}>✕</button>
          </div>

          <div style={{ padding:"12px", flex:1 }}>
            {/* Label */}
            <div style={{ marginBottom:"12px" }}>
              <label style={{ fontSize:"10px", fontWeight:700, color:"#64748b",
                textTransform:"uppercase", letterSpacing:".05em", display:"block", marginBottom:"4px" }} htmlFor={"bpm-studio-label"}>
                Label
              </label>
              <input value={selectedNode.label||""}
                onChange={e=>updateNode(selectedNode.id,{label:e.target.value})}
                style={{ width:"100%", padding:"6px 8px", borderRadius:"7px",
                  border:"1px solid var(--border)", fontSize:"12px", boxSizing:"border-box" }} id={"bpm-studio-label"} />
            </div>

            {/* AI Step config */}
            {selectedNode.type==="AI_STEP" && (
              <>
                <div style={{ marginBottom:"12px" }}>
                  <label style={{ fontSize:"10px", fontWeight:700, color:"#64748b",
                    textTransform:"uppercase", letterSpacing:".05em", display:"block", marginBottom:"4px" }} htmlFor={"bpm-studio-ai-prompt"}>
                    AI Prompt
                  </label>
                  <textarea rows={5} value={selectedNode.config?.prompt||""}
                    onChange={e=>updateConfig(selectedNode.id,"prompt",e.target.value)}
                    placeholder="What should the AI do at this step? Be specific about the output format."
                    style={{ width:"100%", padding:"6px 8px", borderRadius:"7px",
                      border:"1px solid var(--border)", fontSize:"11px", resize:"vertical",
                      lineHeight:1.5, boxSizing:"border-box" }} id={"bpm-studio-ai-prompt"} />
                </div>
                <label style={{ display:"flex", alignItems:"center", gap:"7px",
                  cursor:"pointer", fontSize:"12px", color:"#334155", fontWeight:500 }}>
                  <input type="checkbox" checked={!!selectedNode.config?.requiresHumanReview}
                    onChange={e=>updateConfig(selectedNode.id,"requiresHumanReview",e.target.checked)} />
                  Pause for human review after AI output
                </label>
              </>
            )}

            {/* Human Approval config */}
            {selectedNode.type==="HUMAN_APPROVAL" && (
              <div>
                <label style={{ fontSize:"10px", fontWeight:700, color:"#64748b",
                  textTransform:"uppercase", letterSpacing:".05em", display:"block", marginBottom:"4px" }} htmlFor={"bpm-studio-approvers-email"}>
                  Approvers (email)
                </label>
                <input value={selectedNode.config?.approvers||""}
                  onChange={e=>updateConfig(selectedNode.id,"approvers",e.target.value)}
                  placeholder="manager@company.com"
                  style={{ width:"100%", padding:"6px 8px", borderRadius:"7px",
                    border:"1px solid var(--border)", fontSize:"11px", boxSizing:"border-box" }} id={"bpm-studio-approvers-email"} />
              </div>
            )}

            {/* Condition config */}
            {selectedNode.type==="CONDITION" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                <div>
                  <label style={{ fontSize:"10px", fontWeight:700, color:"#64748b",
                    textTransform:"uppercase", letterSpacing:".05em", display:"block", marginBottom:"4px" }} htmlFor={"bpm-studio-variable-name"}>
                    Variable name
                  </label>
                  <input value={selectedNode.config?.variable||""}
                    onChange={e=>updateConfig(selectedNode.id,"variable",e.target.value)}
                    placeholder="e.g. priority"
                    style={{ width:"100%", padding:"6px 8px", borderRadius:"7px",
                      border:"1px solid var(--border)", fontSize:"11px", boxSizing:"border-box" }} id={"bpm-studio-variable-name"} />
                </div>
                <div>
                  <label style={{ fontSize:"10px", fontWeight:700, color:"#64748b",
                    textTransform:"uppercase", letterSpacing:".05em", display:"block", marginBottom:"4px" }} htmlFor={"bpm-studio-expected-value"}>
                    Expected value
                  </label>
                  <input value={selectedNode.config?.value||""}
                    onChange={e=>updateConfig(selectedNode.id,"value",e.target.value)}
                    placeholder="e.g. HIGH"
                    style={{ width:"100%", padding:"6px 8px", borderRadius:"7px",
                      border:"1px solid var(--border)", fontSize:"11px", boxSizing:"border-box" }} id={"bpm-studio-expected-value"} />
                </div>
              </div>
            )}

            {/* Action config */}
            {selectedNode.type==="ACTION" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                <div>
                  <label style={{ fontSize:"10px", fontWeight:700, color:"#64748b",
                    textTransform:"uppercase", letterSpacing:".05em", display:"block", marginBottom:"4px" }} htmlFor={"bpm-studio-action-type"}>
                    Action type
                  </label>
                  <select value={selectedNode.config?.actionType||"NOTIFY"}
                    onChange={e=>updateConfig(selectedNode.id,"actionType",e.target.value)}
                    style={{ width:"100%", padding:"6px 8px", borderRadius:"7px",
                      border:"1px solid var(--border)", fontSize:"11px", boxSizing:"border-box" }} id={"bpm-studio-action-type"}>
                    <option value="NOTIFY">📢 Send Notification</option>
                    <option value="CREATE_TASK">✅ Create Task</option>
                    <option value="UPDATE_STATUS">🔄 Update Status</option>
                    <option value="SEND_EMAIL">📧 Send Email</option>
                    <option value="WEBHOOK">🔗 Call Webhook</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:"10px", fontWeight:700, color:"#64748b",
                    textTransform:"uppercase", letterSpacing:".05em", display:"block", marginBottom:"4px" }} htmlFor={"bpm-studio-title-subject"}>
                    Title / Subject
                  </label>
                  <input value={selectedNode.config?.title||""}
                    onChange={e=>updateConfig(selectedNode.id,"title",e.target.value)}
                    placeholder="Notification title"
                    style={{ width:"100%", padding:"6px 8px", borderRadius:"7px",
                      border:"1px solid var(--border)", fontSize:"11px", boxSizing:"border-box" }} id={"bpm-studio-title-subject"} />
                </div>
                <div>
                  <label style={{ fontSize:"10px", fontWeight:700, color:"#64748b",
                    textTransform:"uppercase", letterSpacing:".05em", display:"block", marginBottom:"4px" }} htmlFor={"bpm-studio-message-body"}>
                    Message / Body
                  </label>
                  <textarea rows={3} value={selectedNode.config?.message||""}
                    onChange={e=>updateConfig(selectedNode.id,"message",e.target.value)}
                    placeholder="Notification message"
                    style={{ width:"100%", padding:"6px 8px", borderRadius:"7px",
                      border:"1px solid var(--border)", fontSize:"11px", resize:"vertical",
                      lineHeight:1.5, boxSizing:"border-box" }} id={"bpm-studio-message-body"} />
                </div>
              </div>
            )}

            {/* Connections info */}
            <div style={{ marginTop:"16px", padding:"10px", background:"var(--gray-50)",
              borderRadius:"8px", border:"1px solid var(--gray-100)" }}>
              <div style={{ fontSize:"10px", fontWeight:700, color:"#94a3b8",
                textTransform:"uppercase", letterSpacing:".05em", marginBottom:"6px" }}>
                Connections
              </div>
              {[...transitions.filter(t=>t.fromNodeId===selectedNode.id).map(t=>({dir:"→",t})),
                 ...transitions.filter(t=>t.toNodeId===selectedNode.id).map(t=>({dir:"←",t}))
              ].map(({dir,t}) => {
                const other = nodes.find(n=>n.id===(dir==="→"?t.toNodeId:t.fromNodeId));
                const om = other ? NODE_TYPES.find(m=>m.type===other.type) : null;
                return other ? (
                  <div key={t.id} style={{ fontSize:"11px", color:"#334155",
                    display:"flex", alignItems:"center", gap:"5px", marginBottom:"3px" }}>
                    <span style={{ color:om?.color, fontSize:"12px" }}>{om?.icon}</span>
                    <span style={{ color:"#94a3b8" }}>{dir}</span>
                    <span style={{ fontWeight:600 }}>{other.label}</span>
                    {t.label&&<span style={{ color:"#94a3b8", fontSize:"10px" }}>({t.label})</span>}
                  </div>
                ) : null;
              })}
              {transitions.filter(t=>t.fromNodeId===selectedNode.id||t.toNodeId===selectedNode.id).length===0 && (
                <div style={{ fontSize:"11px", color:"#94a3b8" }}>No connections yet. Use → Connect.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INSTANCE VIEWER — Execution Timeline
// ═══════════════════════════════════════════════════════════════════════════════
function InstanceViewer({ instance, onDecide, onOverride, onClose }) {
  const [decision,     setDecision]     = useState("APPROVED");
  const [comment,      setComment]      = useState("");
  const [overrideNode, setOverrideNode] = useState(null);
  const [overrideVal,  setOverrideVal]  = useState("");

  const sm = STATUS_META[instance.status] || STATUS_META.RUNNING;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", minHeight:0 }}>
      {/* Header */}
      <div style={{ padding:"14px 16px", borderBottom:"1px solid var(--border)",
        display:"flex", alignItems:"center", gap:"12px", background:"#fff", flexShrink:0 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:800, fontSize:"15px", color:"#0f172a" }}>
            {instance.processName}
          </div>
          <div style={{ fontSize:"11px", color:"#94a3b8", marginTop:"2px" }}>
            Started by <b>{instance.startedBy}</b> ·{" "}
            {new Date(instance.startedAt).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}
          </div>
        </div>
        <span style={{ padding:"4px 12px", borderRadius:"var(--radius-full)", fontSize:"12px",
          fontWeight:700, background:sm.bg, color:sm.color }}>
          {sm.icon} {sm.label}
        </span>
        <button onClick={onClose} style={{ background:"none", border:"none",
          cursor:"pointer", fontSize:"16px", color:"#94a3b8", padding:"4px" }}>✕</button>
      </div>

      {/* Timeline */}
      <div style={{ flex:1, overflowY:"auto", padding:"16px" }}>
        <div style={{ position:"relative" }}>
          {/* Vertical line */}
          <div style={{ position:"absolute", left:15, top:0, bottom:0,
            width:2, background:"var(--border)", zIndex:0 }} />

          {(instance.history||[]).map((h,i) => {
            const meta = NODE_TYPES.find(m=>m.type===h.nodeType)||NODE_TYPES[0];
            const isWaiting = h.status==="WAITING";
            const isDone    = h.status==="COMPLETED";
            const isFailed  = h.status==="FAILED";
            return (
              <div key={i} style={{ display:"flex", gap:"12px", marginBottom:"16px",
                position:"relative", zIndex:1 }}>
                {/* Dot */}
                <div style={{ width:32, height:32, borderRadius:"50%", flexShrink:0,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:"14px", background: isWaiting?meta.color:isDone?"var(--success)":isFailed?"var(--danger)":"var(--gray-400)",
                  border:"3px solid #fff", boxShadow:"0 0 0 2px "+(isWaiting?meta.color:isDone?"var(--success)":"var(--border)") }}>
                  {isWaiting ? meta.icon : isDone ? "✓" : isFailed ? "✕" : meta.icon}
                </div>

                {/* Body */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"8px",
                    marginBottom:"6px", flexWrap:"wrap" }}>
                    <span style={{ fontWeight:700, fontSize:"13px", color:"#1e293b" }}>
                      {h.nodeLabel}
                    </span>
                    <span style={{ fontSize:"10px", fontWeight:700, padding:"2px 8px",
                      borderRadius:"var(--radius-full)", textTransform:"uppercase", letterSpacing:".04em",
                      background: isWaiting?meta.color+"18":isDone?"#dcfce7":isFailed?"#fee2e2":"var(--gray-100)",
                      color: isWaiting?meta.color:isDone?"#15803d":isFailed?"#b91c1c":"var(--gray-500)" }}>
                      {h.status}
                    </span>
                    {h.completedAt && (
                      <span style={{ fontSize:"10px", color:"#94a3b8" }}>
                        {new Date(h.completedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                      </span>
                    )}
                  </div>

                  {/* AI Output */}
                  {h.aiOutput && (
                    <div style={{ background:"#0F1729",
                      border:"1px solid rgba(99,102,241,.3)", borderRadius:"10px",
                      padding:"12px 14px", marginBottom:"8px", position:"relative" }}>
                      <div style={{ fontSize:"10px", fontWeight:800, color:"#38bdf8",
                        letterSpacing:".05em", textTransform:"uppercase", marginBottom:"6px" }}>
                        🤖 AI Output
                      </div>
                      <div style={{ fontSize:"12px", color:"var(--border)", lineHeight:1.6,
                        whiteSpace:"pre-wrap", maxHeight:"200px", overflowY:"auto" }}>
                        {h.aiOutput}
                      </div>
                      {overrideNode!==h.nodeId && (
                        <button onClick={()=>{setOverrideNode(h.nodeId);setOverrideVal(h.aiOutput||"");}}
                          style={{ marginTop:"8px", padding:"3px 10px", borderRadius:"6px",
                            border:"1px solid rgba(255,255,255,.2)", background:"rgba(255,255,255,.1)",
                            color:"rgba(255,255,255,.8)", fontSize:"10px", fontWeight:700,
                            cursor:"pointer" }}>
                          ✏️ Override
                        </button>
                      )}
                      {overrideNode===h.nodeId && (
                        <div style={{ marginTop:"8px" }}>
                          <textarea rows={4} value={overrideVal} onChange={e=>setOverrideVal(e.target.value)}
                            style={{ width:"100%", padding:"8px", borderRadius:"7px",
                              border:"1px solid rgba(255,255,255,.2)", background:"rgba(255,255,255,.08)",
                              color:"#fff", fontSize:"11px", resize:"vertical",
                              lineHeight:1.5, boxSizing:"border-box" }} />
                          <div style={{ display:"flex", gap:"6px", marginTop:"6px" }}>
                            <button onClick={()=>{onOverride(instance.id,h.nodeId,overrideVal,"Manual correction");setOverrideNode(null);}}
                              style={{ padding:"5px 12px", borderRadius:"6px", border:"none",
                                background:"var(--brand-500)", color:"#fff", fontSize:"11px",
                                fontWeight:700, cursor:"pointer" }}>
                              Apply Override
                            </button>
                            <button onClick={()=>setOverrideNode(null)}
                              style={{ padding:"5px 10px", borderRadius:"6px",
                                border:"1px solid rgba(255,255,255,.2)", background:"transparent",
                                color:"rgba(255,255,255,.7)", fontSize:"11px", cursor:"pointer" }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Human decision record */}
                  {h.humanDecision && (
                    <div style={{ display:"inline-flex", alignItems:"center", gap:"6px",
                      padding:"4px 10px", borderRadius:"var(--radius-full)", fontSize:"11px", fontWeight:700,
                      background: h.humanDecision==="APPROVED"?"#dcfce7":h.humanDecision==="REJECTED"?"#fee2e2":"#fef3c7",
                      color: h.humanDecision==="APPROVED"?"#15803d":h.humanDecision==="REJECTED"?"#b91c1c":"var(--warning)",
                      marginBottom:"4px" }}>
                      {h.humanDecision==="APPROVED"?"✓":h.humanDecision==="REJECTED"?"✕":"✏️"} {h.humanDecision}
                      {h.humanComment && <span style={{ fontWeight:400, opacity:.8 }}> — "{h.humanComment}"</span>}
                      {h.decidedBy && <span style={{ fontWeight:400, opacity:.7 }}> by {h.decidedBy}</span>}
                    </div>
                  )}

                  {/* Waiting for human decision */}
                  {isWaiting && h.nodeType==="HUMAN_APPROVAL" && (
                    <div style={{ background:"#fffbeb", border:"1.5px solid #f59e0b44",
                      borderRadius:"10px", padding:"12px 14px" }}>
                      <div style={{ fontWeight:700, fontSize:"12px", color:"#C17D22",
                        marginBottom:"10px" }}>👤 Your decision is required</div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px",
                        marginBottom:"10px" }}>
                        <div>
                          <label style={{ fontSize:"10px", fontWeight:700, color:"#64748b",
                            display:"block", marginBottom:"3px" }} htmlFor={"bpm-studio-decision"}>Decision</label>
                          <select value={decision} onChange={e=>setDecision(e.target.value)}
                            style={{ width:"100%", padding:"6px 8px", borderRadius:"7px",
                              border:"1px solid var(--border)", fontSize:"12px" }} id={"bpm-studio-decision"}>
                            <option value="APPROVED">✓ Approve</option>
                            <option value="REJECTED">✕ Reject</option>
                            <option value="PROCEED">→ Proceed</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize:"10px", fontWeight:700, color:"#64748b",
                            display:"block", marginBottom:"3px" }} htmlFor={"bpm-studio-comment"}>Comment</label>
                          <input value={comment} onChange={e=>setComment(e.target.value)}
                            placeholder="Optional reason"
                            style={{ width:"100%", padding:"6px 8px", borderRadius:"7px",
                              border:"1px solid var(--border)", fontSize:"12px", boxSizing:"border-box" }} id={"bpm-studio-comment"} />
                        </div>
                      </div>
                      <button onClick={()=>{onDecide(instance.id,h.nodeId,decision,comment);setComment("");}}
                        style={{ padding:"8px 20px", borderRadius:"8px", border:"none",
                          background:"var(--warning)", color:"#fff",
                          fontSize:"12px", fontWeight:800, cursor:"pointer",
                          boxShadow:"var(--elevation-2)" }}>
                        Submit Decision
                      </button>
                    </div>
                  )}

                  {/* Waiting for AI review */}
                  {isWaiting && h.nodeType==="AI_STEP" && (
                    <div style={{ background:"var(--brand-50)", border:"1.5px solid #6366f144",
                      borderRadius:"10px", padding:"10px 14px", display:"flex",
                      alignItems:"center", gap:"10px", flexWrap:"wrap" }}>
                      <span style={{ fontSize:"12px", fontWeight:600, color:"#3732A8", flex:1 }}>
                        👁 Review the AI output above and proceed
                      </span>
                      <div style={{ display:"flex", gap:"6px" }}>
                        <button onClick={()=>onDecide(instance.id,h.nodeId,"APPROVED","Reviewed and accepted")}
                          style={{ padding:"6px 14px", borderRadius:"7px", border:"none",
                            background:"var(--brand-500)", color:"#fff", fontSize:"11px",
                            fontWeight:700, cursor:"pointer" }}>
                          ✓ Accept
                        </button>
                        <button onClick={()=>setOverrideNode(h.nodeId)}
                          style={{ padding:"6px 14px", borderRadius:"7px",
                            border:"1px solid var(--brand-500)", background:"transparent",
                            color:"#5B5FEE", fontSize:"11px", fontWeight:700, cursor:"pointer" }}>
                          ✏️ Override
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Process variables */}
        {Object.keys(instance.variables||{}).length > 0 && (
          <details style={{ marginTop:"8px" }}>
            <summary style={{ fontSize:"11px", fontWeight:700, color:"#64748b",
              cursor:"pointer", padding:"6px 10px", background:"var(--gray-50)",
              borderRadius:"7px", border:"1px solid var(--border)" }}>
              ⚙️ Process Variables ({Object.keys(instance.variables).length})
            </summary>
            <div style={{ background:"var(--gray-50)", borderRadius:"0 0 7px 7px",
              border:"1px solid var(--border)", borderTop:"none", padding:"8px 10px" }}>
              {Object.entries(instance.variables).map(([k,v]) => (
                <div key={k} style={{ display:"flex", gap:"8px", padding:"3px 0",
                  borderBottom:"1px solid var(--gray-100)", fontSize:"11px" }}>
                  <span style={{ fontWeight:700, color:"#334155", flexShrink:0 }}>{k}</span>
                  <span style={{ color:"#64748b", wordBreak:"break-all" }}>{String(v).slice(0,120)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function BpmStudio() {
  const [view,         setView]       = useState("dashboard"); // dashboard | designer | runner
  const [processes,    setProcesses]  = useState([]);
  const [instances,    setInstances]  = useState([]);
  const [editing,      setEditing]    = useState(null);  // process being designed
  const [viewInstance, setViewInstance] = useState(null); // instance being viewed
  const [startingFor,  setStartingFor] = useState(null);  // processId to start
  const [startVars,    setStartVars]  = useState("{}");
  const [loading,      setLoading]    = useState(true);
  const { show:toast } = useToast();
  const confirm        = useConfirm();

  const loadAll = useCallback(() => {
    Promise.all([
      api.getProcesses().then(r => setProcesses(unwrapList(r))),
      api.getInstances().then(r => setInstances(unwrapList(r))),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Poll running instances
  useEffect(() => {
    const running = instances.some(i => i.status==="RUNNING"||i.status==="WAITING_HUMAN"||i.status==="WAITING_AI");
    if (!running) return;
    const id = setInterval(() => {
      api.getInstances().then(r => {
        const fresh = unwrapList(r);
        setInstances(fresh);
        if (viewInstance) {
          const updated = fresh.find(i=>i.id===viewInstance.id);
          if (updated) setViewInstance(updated);
        }
      });
    }, 4000);
    return () => clearInterval(id);
  }, [instances, viewInstance]);

  const handleSave = async () => {
    if (!editing?.name?.trim()) { toast("Process name is required","error"); return; }
    try {
      await api.saveProcess(editing);
      setEditing(null); setView("dashboard");
      loadAll(); toast("Workflow saved ✓","success");
    } catch { toast("Failed to save","error"); }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({title:"Delete this workflow?",message:"All instances will still be visible but the template will be removed.",danger:true});
    if (!ok) return;
    await api.deleteProcess(id); loadAll(); toast("Workflow deleted","success");
  };

  const handleStart = async () => {
    try {
      const vars = JSON.parse(startVars||"{}");
      const inst = await api.startProcess(startingFor, vars);
      setStartingFor(null); setStartVars("{}");
      loadAll(); setViewInstance(inst.data); setView("runner");
      toast("Workflow started ✓","success");
    } catch { toast("Invalid JSON or failed to start","error"); }
  };

  const handleDecide = async (instanceId, nodeId, decision, comment) => {
    try {
      await api.humanDecide(instanceId, {nodeId, decision, comment});
      const fresh = await api.getInstances();
      const all = unwrapList(fresh);
      setInstances(all);
      const updated = all.find(i=>i.id===instanceId);
      if (updated) setViewInstance(updated);
      toast(`Decision submitted: ${decision}`, "success");
    } catch { toast("Failed to submit decision","error"); }
  };

  const handleOverride = async (instanceId, nodeId, value, reason) => {
    try {
      await api.aiOverride(instanceId, {nodeId, overrideValue:value, reason});
      const fresh = await api.getInstances();
      const all = unwrapList(fresh);
      setInstances(all);
      const updated = all.find(i=>i.id===instanceId);
      if (updated) setViewInstance(updated);
      toast("AI output overridden ✓", "success");
    } catch { toast("Failed to override","error"); }
  };

  const newProcess = () => {
    setEditing({ name:"", description:"", category:"PRODUCT", status:"DRAFT", nodes:[], transitions:[] });
    setView("designer");
  };

  const loadTemplate = (tpl) => {
    setEditing({ name:tpl.name, description:tpl.description, category:tpl.category,
      status:"DRAFT", nodes:tpl.nodes.map(n=>({...n})), transitions:tpl.transitions.map(t=>({...t})) });
    setView("designer");
  };

  const pendingDecisions = instances.filter(i=>i.status==="WAITING_HUMAN").length;
  const running          = instances.filter(i=>i.status==="RUNNING").length;
  const completed        = instances.filter(i=>i.status==="COMPLETED").length;

  // ── DESIGNER VIEW ───────────────────────────────────────────────────────────
  if (view==="designer" && editing) return (
    <div style={{ height:"100%", display:"flex", flexDirection:"column", minHeight:0 }}>
      {/* Designer toolbar */}
      <div style={{ display:"flex", alignItems:"center", gap:"10px", padding:"10px 16px",
        background:"#fff", borderBottom:"1px solid var(--border)", flexShrink:0 }}>
        <button onClick={()=>setView("dashboard")}
          style={{ padding:"6px 12px", borderRadius:"8px", border:"1px solid var(--border)",
            background:"var(--gray-50)", fontSize:"12px", fontWeight:600, cursor:"pointer", color:"#334155" }}>
          ← Back
        </button>
        <input value={editing.name||""} onChange={e=>setEditing(p=>({...p,name:e.target.value}))}
          placeholder="Workflow name…"
          style={{ flex:1, maxWidth:280, padding:"7px 12px", borderRadius:"8px",
            border:"1.5px solid var(--border)", fontSize:"14px", fontWeight:700,
            color:"#0f172a", outline:"none" }}
          onFocus={e=>e.target.style.borderColor="var(--brand-500)"}
          onBlur={e=>e.target.style.borderColor="var(--border)"} />
        <input value={editing.description||""} onChange={e=>setEditing(p=>({...p,description:e.target.value}))}
          placeholder="Description…"
          style={{ flex:2, padding:"7px 12px", borderRadius:"8px",
            border:"1px solid var(--border)", fontSize:"12px", color:"#334155", outline:"none" }} />
        <select value={editing.category||"PRODUCT"} onChange={e=>setEditing(p=>({...p,category:e.target.value}))}
          style={{ padding:"7px 10px", borderRadius:"8px", border:"1px solid var(--border)",
            fontSize:"12px", fontWeight:600, color:"#334155" }}>
          {["PRODUCT","HR","FINANCE","IT","LEGAL","CUSTOM"].map(c=>(
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={editing.status||"DRAFT"} onChange={e=>setEditing(p=>({...p,status:e.target.value}))}
          style={{ padding:"7px 10px", borderRadius:"8px", border:"1px solid var(--border)",
            fontSize:"12px", fontWeight:600,
            color: editing.status==="ACTIVE"?"var(--success)":editing.status==="ARCHIVED"?"var(--gray-400)":"var(--warning)" }}>
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <div style={{ marginLeft:"auto", display:"flex", gap:"6px" }}>
          <span style={{ fontSize:"11px", color:"#94a3b8", display:"flex", alignItems:"center" }}>
            {editing.nodes?.length||0} nodes · {editing.transitions?.length||0} edges
          </span>
          <button onClick={handleSave}
            style={{ padding:"8px 20px", borderRadius:"9px", border:"none",
              background:"var(--brand-600)", color:"#fff",
              fontSize:"13px", fontWeight:800, cursor:"pointer",
              boxShadow:"var(--elevation-2)" }}>
            💾 Save
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div style={{ flex:1, minHeight:0, overflow:"hidden" }}>
        <WorkflowCanvas process={editing} onChange={setEditing} />
      </div>
    </div>
  );

  // ── RUNNER VIEW ─────────────────────────────────────────────────────────────
  if (view==="runner" && viewInstance) return (
    <div style={{ height:"100%", display:"flex", flexDirection:"column", minHeight:0 }}>
      <div style={{ padding:"10px 16px", background:"#fff", borderBottom:"1px solid var(--border)",
        flexShrink:0, display:"flex", alignItems:"center", gap:"10px" }}>
        <button onClick={()=>setView("dashboard")}
          style={{ padding:"6px 12px", borderRadius:"8px", border:"1px solid var(--border)",
            background:"var(--gray-50)", fontSize:"12px", fontWeight:600, cursor:"pointer", color:"#334155" }}>
          ← All Runs
        </button>
        <span style={{ fontSize:"14px", fontWeight:700, color:"#1e293b" }}>Execution Detail</span>
      </div>
      <div style={{ flex:1, minHeight:0, overflow:"hidden", padding:"16px" }}>
        <InstanceViewer instance={viewInstance}
          onDecide={handleDecide} onOverride={handleOverride}
          onClose={()=>setView("dashboard")} />
      </div>
    </div>
  );

  // ── DASHBOARD VIEW ──────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader icon="🔀" title="Workflow Studio"
        description="Design, automate, and run business processes with AI steps and human decisions" />

      {/* Stats row */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"12px",
        marginBottom:"20px" }}>
        {[
          { label:"Workflows",     value:processes.length,  icon:"🔀", color:"#5B5FEE" },
          { label:"Active Runs",   value:running,           icon:"▶",  color:"#0ea5e9" },
          { label:"Needs Review",  value:pendingDecisions,  icon:"⏸",  color:"#C17D22" },
          { label:"Completed",     value:completed,         icon:"✓",  color:"#1E8E5A" },
        ].map(s => (
          <div key={s.label} style={{ background:"#fff", border:`1.5px solid ${s.color}22`,
            borderRadius:"12px", padding:"14px 16px", display:"flex", alignItems:"center", gap:"12px",
            boxShadow:"var(--elevation-1)" }}>
            <div style={{ width:40, height:40, borderRadius:"10px", background:`${s.color}18`,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:"18px", flexShrink:0 }}>{s.icon}</div>
            <div>
              <div style={{ fontSize:"22px", fontWeight:800, color:s.color, lineHeight:1 }}>{s.value}</div>
              <div style={{ fontSize:"11px", color:"#64748b", fontWeight:600, marginTop:"2px" }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 380px", gap:"16px", alignItems:"start" }}>

        {/* LEFT — My Workflows */}
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"12px" }}>
            <span style={{ fontWeight:800, fontSize:"15px", color:"#0f172a" }}>My Workflows</span>
            <span style={{ fontSize:"11px", color:"#94a3b8",
              background:"var(--gray-100)", padding:"2px 8px", borderRadius:"var(--radius-full)" }}>
              {processes.length}
            </span>
            <div style={{ marginLeft:"auto", display:"flex", gap:"6px" }}>
              <button onClick={newProcess}
                style={{ padding:"7px 16px", borderRadius:"9px", border:"none",
                  background:"var(--brand-600)", color:"#fff",
                  fontSize:"12px", fontWeight:700, cursor:"pointer",
                  boxShadow:"var(--elevation-2)" }}>
                + New Workflow
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign:"center", padding:"40px", color:"#94a3b8" }}>Loading…</div>
          ) : processes.length===0 ? (
            <div style={{ background:"#fff", border:"1px dashed var(--border)", borderRadius:"16px",
              padding:"48px 24px", textAlign:"center" }}>
              <div style={{ fontSize:"48px", marginBottom:"12px" }}>🔀</div>
              <div style={{ fontWeight:700, fontSize:"16px", color:"#1e293b", marginBottom:"8px" }}>
                No workflows yet
              </div>
              <div style={{ fontSize:"13px", color:"#64748b", marginBottom:"20px" }}>
                Create one from scratch or pick a template from the library →
              </div>
              <button onClick={newProcess}
                style={{ padding:"10px 24px", borderRadius:"9px", border:"none",
                  background:"var(--brand-600)", color:"#fff",
                  fontSize:"13px", fontWeight:700, cursor:"pointer" }}>
                + Create Workflow
              </button>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
              {processes.map(p => {
                const pInstances = instances.filter(i=>i.processId===p.id);
                const pWaiting   = pInstances.filter(i=>i.status==="WAITING_HUMAN").length;
                const pRunning   = pInstances.filter(i=>i.status==="RUNNING").length;
                return (
                  <div key={p.id} style={{ background:"#fff", border:"1px solid var(--border)",
                    borderRadius:"14px", padding:"14px 16px",
                    boxShadow:"var(--elevation-1)", transition:"box-shadow var(--transition-fast)" }}
                    onMouseEnter={e=>e.currentTarget.style.boxShadow="var(--elevation-2)"}
                    onMouseLeave={e=>e.currentTarget.style.boxShadow="var(--elevation-1)"}>
                    <div style={{ display:"flex", alignItems:"flex-start", gap:"12px" }}>
                      <div style={{ width:40, height:40, borderRadius:"10px",
                        background:"rgba(99,102,241,.1)", display:"flex",
                        alignItems:"center", justifyContent:"center", fontSize:"18px", flexShrink:0 }}>
                        🔀
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:"8px",
                          flexWrap:"wrap", marginBottom:"3px" }}>
                          <span style={{ fontWeight:800, fontSize:"14px", color:"#0f172a" }}>
                            {p.name}
                          </span>
                          <span style={{ fontSize:"10px", fontWeight:700, padding:"2px 8px",
                            borderRadius:"var(--radius-full)", textTransform:"uppercase", letterSpacing:".04em",
                            background: p.status==="ACTIVE"?"#dcfce7":p.status==="ARCHIVED"?"var(--gray-100)":"#fef3c7",
                            color: p.status==="ACTIVE"?"#15803d":p.status==="ARCHIVED"?"var(--gray-500)":"var(--warning)" }}>
                            {p.status}
                          </span>
                          <span style={{ fontSize:"10px", color:"#94a3b8",
                            background:"var(--gray-50)", padding:"2px 7px", borderRadius:"var(--radius-full)" }}>
                            {p.category}
                          </span>
                        </div>
                        {p.description && (
                          <div style={{ fontSize:"12px", color:"#64748b",
                            marginBottom:"8px", lineHeight:1.5 }}>{p.description}</div>
                        )}
                        <div style={{ display:"flex", gap:"12px", fontSize:"11px", color:"#94a3b8" }}>
                          <span>🔢 {p.nodes?.length||0} nodes</span>
                          <span>▶ {p.runCount||0} runs</span>
                          {pRunning>0&&<span style={{ color:"#0ea5e9", fontWeight:700 }}>▶ {pRunning} running</span>}
                          {pWaiting>0&&<span style={{ color:"#C17D22", fontWeight:700 }}>⏸ {pWaiting} waiting review</span>}
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:"6px", flexShrink:0 }}>
                        {startingFor===p.id ? (
                          <div style={{ display:"flex", gap:"6px", alignItems:"center" }}>
                            <input value={startVars} onChange={e=>setStartVars(e.target.value)}
                              placeholder='{"key":"value"}'
                              style={{ width:"160px", padding:"5px 8px", borderRadius:"7px",
                                border:"1px solid var(--border)", fontSize:"11px" }} />
                            <button onClick={handleStart}
                              style={{ padding:"6px 12px", borderRadius:"7px", border:"none",
                                background:"var(--success)", color:"#fff", fontSize:"11px",
                                fontWeight:700, cursor:"pointer" }}>
                              ▶ Start
                            </button>
                            <button onClick={()=>setStartingFor(null)}
                              style={{ padding:"6px 10px", borderRadius:"7px",
                                border:"1px solid var(--border)", background:"#fff",
                                fontSize:"11px", cursor:"pointer", color:"#64748b" }}>
                              ✕
                            </button>
                          </div>
                        ) : (
                          <>
                            <button onClick={()=>setStartingFor(p.id)}
                              style={{ padding:"6px 14px", borderRadius:"8px", border:"none",
                                background:"var(--success)", color:"#fff", fontSize:"11px",
                                fontWeight:700, cursor:"pointer" }}>
                              ▶ Run
                            </button>
                            <button onClick={()=>{setEditing({...p});setView("designer");}}
                              style={{ padding:"6px 12px", borderRadius:"8px",
                                border:"1px solid var(--border)", background:"#fff",
                                fontSize:"11px", fontWeight:600, cursor:"pointer", color:"#334155" }}>
                              ✏️ Edit
                            </button>
                            <button onClick={()=>handleDelete(p.id)}
                              style={{ padding:"6px 10px", borderRadius:"8px",
                                border:"1px solid #fee2e2", background:"#fff",
                                fontSize:"11px", cursor:"pointer", color:"#D64545" }}>
                              🗑
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Recent Runs */}
          {instances.length > 0 && (
            <div style={{ marginTop:"24px" }}>
              <div style={{ fontWeight:800, fontSize:"15px", color:"#0f172a", marginBottom:"12px",
                display:"flex", alignItems:"center", gap:"8px" }}>
                Recent Runs
                {pendingDecisions > 0 && (
                  <span style={{ fontSize:"11px", fontWeight:800, padding:"2px 9px",
                    borderRadius:"var(--radius-full)", background:"#fef3c7", color:"#C17D22" }}>
                    {pendingDecisions} needs review
                  </span>
                )}
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
                {instances.slice(0,8).map(inst => {
                  const sm = STATUS_META[inst.status]||STATUS_META.RUNNING;
                  const lastStep = inst.history?.[inst.history.length-1];
                  return (
                    <div key={inst.id}
                      onClick={()=>{ setViewInstance(inst); setView("runner"); }}
                      style={{ background:"#fff", border:`1px solid ${inst.status==="WAITING_HUMAN"?"#f59e0b44":"var(--border)"}`,
                        borderRadius:"10px", padding:"10px 14px", cursor:"pointer",
                        display:"flex", alignItems:"center", gap:"12px",
                        transition:"all .13s" }}
                      onMouseEnter={e=>{ e.currentTarget.style.background="var(--gray-50)"; }}
                      onMouseLeave={e=>{ e.currentTarget.style.background="var(--surface-1)"; }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (()=>{ setViewInstance(inst); setView("runner"); })?.(e); } }}>
                      <span style={{ fontSize:"16px", width:28, textAlign:"center" }}>{sm.icon}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:700, fontSize:"12px", color:"#1e293b" }}>
                          {inst.processName}
                        </div>
                        <div style={{ fontSize:"10px", color:"#94a3b8" }}>
                          {lastStep ? `Step: ${lastStep.nodeLabel}` : "Starting…"} ·{" "}
                          {new Date(inst.startedAt).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}
                        </div>
                      </div>
                      <span style={{ fontSize:"10px", fontWeight:700, padding:"2px 8px",
                        borderRadius:"var(--radius-full)", background:sm.bg, color:sm.color,
                        whiteSpace:"nowrap" }}>
                        {sm.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — Template Library */}
        <div style={{ position:"sticky", top:80 }}>
          <div style={{ fontWeight:800, fontSize:"15px", color:"#0f172a",
            marginBottom:"12px", display:"flex", alignItems:"center", gap:"8px" }}>
            📚 Template Library
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
            {TEMPLATES.map((tpl,i) => (
              <div key={i} style={{ background:"#fff", border:"1px solid var(--border)",
                borderRadius:"12px", padding:"12px 14px",
                transition:"all .15s", cursor:"pointer" }}
                onMouseEnter={e=>{ e.currentTarget.style.borderColor="var(--brand-200)"; e.currentTarget.style.boxShadow="var(--elevation-1)"; }}
                onMouseLeave={e=>{ e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.boxShadow="none"; }}>
                <div style={{ display:"flex", alignItems:"flex-start", gap:"10px",
                  marginBottom:"8px" }}>
                  <span style={{ fontSize:"20px" }}>{tpl.icon}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, fontSize:"13px", color:"#1e293b",
                      marginBottom:"3px" }}>{tpl.name}</div>
                    <div style={{ fontSize:"11px", color:"#64748b",
                      lineHeight:1.5 }}>{tpl.description}</div>
                  </div>
                </div>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <span style={{ fontSize:"10px", color:"#94a3b8" }}>
                    {tpl.nodes.length} nodes · {tpl.transitions.length} edges
                  </span>
                  <button onClick={()=>loadTemplate(tpl)}
                    style={{ padding:"5px 14px", borderRadius:"7px", border:"none",
                      background:"var(--brand-600)", color:"#fff",
                      fontSize:"11px", fontWeight:700, cursor:"pointer" }}>
                    Use Template →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Start vars modal */}
      {startingFor && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.4)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}
          onClick={()=>setStartingFor(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (()=>setStartingFor(null))?.(e); } }}>
          <div style={{ background:"#fff", borderRadius:"16px", padding:"24px",
            width:"460px", boxShadow:"var(--elevation-3)" }}
            onClick={e=>e.stopPropagation()} role="presentation">
            <div style={{ fontWeight:800, fontSize:"16px", color:"#0f172a",
              marginBottom:"6px" }}>▶ Start Workflow</div>
            <div style={{ fontSize:"12px", color:"#64748b", marginBottom:"16px" }}>
              Optionally pass initial variables as JSON. Leave as <code>{"{}"}</code> for defaults.
            </div>
            <label style={{ fontSize:"11px", fontWeight:700, color:"#64748b",
              display:"block", marginBottom:"5px" }} htmlFor={"bpm-studio-initial-variables-json"}>Initial Variables (JSON)</label>
            <textarea rows={5} value={startVars} onChange={e=>setStartVars(e.target.value)}
              style={{ width:"100%", padding:"10px", borderRadius:"9px",
                border:"1.5px solid var(--border)", fontSize:"12px", fontFamily:"monospace",
                resize:"vertical", lineHeight:1.5, boxSizing:"border-box" }} id={"bpm-studio-initial-variables-json"} />
            <div style={{ display:"flex", gap:"8px", marginTop:"14px", justifyContent:"flex-end" }}>
              <button onClick={()=>setStartingFor(null)}
                style={{ padding:"8px 18px", borderRadius:"9px",
                  border:"1px solid var(--border)", background:"#fff", fontSize:"12px",
                  fontWeight:600, cursor:"pointer", color:"#334155" }}>
                Cancel
              </button>
              <button onClick={handleStart}
                style={{ padding:"8px 24px", borderRadius:"9px", border:"none",
                  background:"var(--success)", color:"#fff",
                  fontSize:"12px", fontWeight:800, cursor:"pointer",
                  boxShadow:"var(--elevation-2)" }}>
                ▶ Start Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
