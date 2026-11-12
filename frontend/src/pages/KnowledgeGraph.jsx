import { useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import PageHeader from "../components/PageHeader";
import client, { unwrapList } from "../api/client";

const api = {
  docs:     (wsId) => wsId ? client.get(`/docs?workspaceId=${wsId}`) : Promise.resolve({ data: { data: [] } }),
  tasks:    () => client.get("/tasks"),
  goals:    () => client.get("/goals"),
  projects: () => client.get("/projects"),
};

// NOTE: color values here are real hex, not var(--token) -- this file
// builds transparent variants by string-concatenating a 2-digit alpha
// suffix straight onto the color (e.g. m.color+"22" -> "#3b82f622", a
// valid 8-digit hex-with-alpha). A CSS var() reference can't support
// that concatenation ("var(--success)22" isn't a color), so these stay
// literal hex here even though the same hues are tokens elsewhere.
const META = {
  project: { color:"#3b82f6", bg:"rgba(59,130,246,0.08)", icon:"📁", label:"Project", radius:18 },
  goal:    { color:"#1E8E5A", bg:"rgba(16,185,129,0.08)", icon:"🎯", label:"Goal",    radius:15 },
  task:    { color:"#C17D22", bg:"rgba(245,158,11,0.08)",  icon:"✅", label:"Task",    radius:12 },
  doc:     { color:"#5B5FEE", bg:"rgba(99,102,241,0.08)",  icon:"📝", label:"Doc",     radius:13 },
};

// Same reasoning as META above -- literal hex, not tokens, because of
// the +"NN" alpha-suffix concatenation used wherever these render.
const EDGE_COLORS = {
  IN_PROJECT:"#3b82f6", LINKED_TO:"#1E8E5A", CHILD_OF:"#5B5FEE",
  BACKLINK:"#C17D22", RELATED:"#94a3b8", DEPENDS_ON:"#7C5CBF", CONTRIBUTES_TO:"#0ea5e9",
};

function buildGraph(docs, tasks, goals, projects) {
  const nodes = [], edges = [];
  projects.slice(0,30).forEach(p => nodes.push({ id:"proj_"+p.id, type:"project", label:p.name||"Project", entityId:p.id, status:p.status, progress:p.progress||0 }));
  goals.slice(0,30).forEach(g => nodes.push({ id:"goal_"+g.id, type:"goal", label:g.title||"Goal", entityId:g.id, linkedProjectId:g.linkedProjectId||null, progress:g.progress||0 }));
  docs.slice(0,30).forEach(d => nodes.push({ id:"doc_"+d.id, type:"doc", label:d.title||"Doc", entityId:d.id }));
  tasks.slice(0,30).forEach(t => nodes.push({ id:"task_"+t.id, type:"task", label:t.title||"Task", entityId:t.id, projectId:t.projectId||null, status:t.status, priority:t.priority }));

  // Task → Project
  tasks.forEach(t => { if (t.projectId && nodes.find(n=>n.id==="proj_"+t.projectId)) edges.push({ from:"task_"+t.id, to:"proj_"+t.projectId, type:"IN_PROJECT" }); });
  // Goal → Project (via goal.linkedProjectId if present)
  goals.forEach(g => { if (g.linkedProjectId && nodes.find(n=>n.id==="proj_"+g.linkedProjectId)) edges.push({ from:"goal_"+g.id, to:"proj_"+g.linkedProjectId, type:"LINKED_TO" }); });
  // Project → Goal (via project.linkedGoalId — the primary source of these connections)
  projects.forEach(p => { if (p.linkedGoalId && nodes.find(n=>n.id==="goal_"+p.linkedGoalId)) edges.push({ from:"proj_"+p.id, to:"goal_"+p.linkedGoalId, type:"LINKED_TO" }); });
  // Goal → parent Goal
  goals.forEach(g => { if (g.parentGoalId && nodes.find(n=>n.id==="goal_"+g.parentGoalId)) edges.push({ from:"goal_"+g.id, to:"goal_"+g.parentGoalId, type:"CHILD_OF" }); });
  // Goal prerequisite chains
  goals.forEach(g => { (g.prerequisiteGoalIds||[]).forEach(pid => { if (nodes.find(n=>n.id==="goal_"+pid)) edges.push({ from:"goal_"+g.id, to:"goal_"+pid, type:"DEPENDS_ON" }); }); });
  // Task → Goal (via task.goalId if present)
  tasks.forEach(t => { if (t.goalId && nodes.find(n=>n.id==="goal_"+t.goalId)) edges.push({ from:"task_"+t.id, to:"goal_"+t.goalId, type:"CONTRIBUTES_TO" }); });
  // Doc links
  docs.forEach(d => { (d.autoLinkedDocIds||[]).forEach(lid => { if (nodes.find(n=>n.id==="doc_"+lid)) edges.push({ from:"doc_"+d.id, to:"doc_"+lid, type:"RELATED" }); }); });
  // Deduplicate edges
  const edgeKeys = new Set();
  return { nodes, edges: edges.filter(e => { const k=e.from+">"+e.to+">"+e.type; if (edgeKeys.has(k)) return false; edgeKeys.add(k); return true; }) };

}

// Splits nodes into their connected components (groups reachable from
// each other via edges — undirected for this purpose). A workspace
// with many separate projects, each with their own tasks and nobody
// cross-linked, is many small components, not one big graph.
// Splits nodes into their connected components (groups reachable from
// each other via edges — undirected for this purpose). A workspace
// with many separate projects, each with their own tasks and nobody
// cross-linked, is many small components, not one big graph.
function connectedComponents(nodes, edges) {
  const adj = new Map();
  nodes.forEach(n => adj.set(n.id, []));
  edges.forEach(e => {
    if (adj.has(e.from) && adj.has(e.to)) {
      adj.get(e.from).push(e.to);
      adj.get(e.to).push(e.from);
    }
  });
  const visited = new Set(), components = [];
  nodes.forEach(n => {
    if (visited.has(n.id)) return;
    const ids = [], stack = [n.id];
    visited.add(n.id);
    while (stack.length) {
      const cur = stack.pop();
      ids.push(cur);
      (adj.get(cur) || []).forEach(nb => {
        if (!visited.has(nb)) { visited.add(nb); stack.push(nb); }
      });
    }
    components.push(nodes.filter(nd => ids.includes(nd.id)));
  });
  return components;
}

// Minimum center-to-center distance enforced between ANY two nodes in a
// layout, connected or not — chosen to comfortably fit a truncated
// 18-character label (see the node render below) below a node without
// touching its neighbor. Previously nodes were placed to fit a
// pre-guessed box (a fixed circle radius, or a fixed cell size), which
// meant the box's size — not how much room the nodes actually needed —
// decided the spacing, and small/cramped boxes produced literally
// touching labels ("Personal Project 3Personal Project 3" in adjacent
// nodes' labels, no gap at all). Layout is now sized the other way
// around: figure out how much room this many nodes need at a safe
// minimum spacing, THEN size the box to that — never the reverse.
// Raised from 95: labels went from an 18-char to a 30-char truncation
// limit (see the node render below), so they're visually wider now —
// spacing needs to keep pace or longer labels start crowding each other
// again even though the nodes themselves aren't actually overlapping.
const MIN_SPACING = 140;

// Lays out one connected component's nodes and returns not just their
// positions but the {width, height} box they actually ended up needing
// — callers (clusteredLayout) use that real size to place components
// next to each other, rather than guessing a size upfront.
function forceLayout(nodes, edges) {
  if (!nodes.length) return { pos: {}, width: 200, height: 200 };
  const n = nodes.length;
  const pos = {};

  if (n <= 10) {
    // Small components: place on a circle sized so consecutive nodes
    // are at least MIN_SPACING apart along the circumference — not a
    // fraction of some outer box, which is what let radius shrink below
    // what the labels needed whenever the box itself was small.
    const r = n === 1 ? 0 : Math.max(60, (n * MIN_SPACING) / (2 * Math.PI));
    nodes.forEach((node, i) => {
      const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
      pos[node.id] = { x: r * Math.cos(angle), y: r * Math.sin(angle) };
    });
    const extent = r + 60;
    nodes.forEach(node => { pos[node.id].x += extent; pos[node.id].y += extent; });
    return { pos, width: extent * 2, height: extent * 2 };
  }

  // Larger components: the same repel/attract/center-pull simulation as
  // before, in a canvas sized to the node count (not a fixed 900x500),
  // followed by a hard minimum-spacing relaxation pass — this is what
  // actually *guarantees* no pair ends up closer than MIN_SPACING,
  // regardless of how the simulation itself converges. Tuning the
  // simulation's own force constants can reduce crowding but can't
  // promise zero overlap the way an explicit "push apart if too close"
  // pass afterward can.
  const side = Math.max(320, MIN_SPACING * Math.sqrt(n) * 1.25);
  const W = side, H = side;
  nodes.forEach((node, i) => {
    const angle = (i / n) * 2 * Math.PI;
    pos[node.id] = { x: W/2 + Math.min(W,H)*0.35*Math.cos(angle), y: H/2 + Math.min(W,H)*0.35*Math.sin(angle) };
  });
  const k = Math.max(MIN_SPACING * 0.6, Math.sqrt((W*H)/Math.max(1,n))*0.65);
  for (let iter = 0; iter < 100; iter++) {
    const disp = {};
    nodes.forEach(nd => { disp[nd.id] = {x:0,y:0}; });
    for (let i = 0; i < n; i++) for (let j = i+1; j < n; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = pos[a.id].x-pos[b.id].x, dy = pos[a.id].y-pos[b.id].y;
      const dist = Math.max(1, Math.sqrt(dx*dx+dy*dy)), f = (k*k)/dist;
      disp[a.id].x += (dx/dist)*f; disp[a.id].y += (dy/dist)*f;
      disp[b.id].x -= (dx/dist)*f; disp[b.id].y -= (dy/dist)*f;
    }
    edges.forEach(e => {
      if (!pos[e.from]||!pos[e.to]) return;
      const dx = pos[e.to].x-pos[e.from].x, dy = pos[e.to].y-pos[e.from].y;
      const dist = Math.max(1, Math.sqrt(dx*dx+dy*dy)), f = (dist*dist)/k;
      disp[e.from].x += (dx/dist)*f; disp[e.from].y += (dy/dist)*f;
      disp[e.to].x -= (dx/dist)*f; disp[e.to].y -= (dy/dist)*f;
    });
    nodes.forEach(nd => {
      disp[nd.id].x += (W/2-pos[nd.id].x)*0.05;
      disp[nd.id].y += (H/2-pos[nd.id].y)*0.05;
    });
    const temp = k*Math.max(0.1, 1-iter/100);
    nodes.forEach(nd => {
      const d = disp[nd.id], len = Math.max(1, Math.sqrt(d.x*d.x+d.y*d.y)), move = Math.min(len,temp);
      pos[nd.id].x += (d.x/len)*move;
      pos[nd.id].y += (d.y/len)*move;
    });
  }

  // Hard minimum-spacing relaxation — several passes since separating
  // one pair can push another pair back together; this converges
  // quickly in practice for the node counts a knowledge graph realistically has.
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < n; i++) for (let j = i+1; j < n; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = pos[a.id].x-pos[b.id].x, dy = pos[a.id].y-pos[b.id].y;
      const dist = Math.sqrt(dx*dx+dy*dy);
      if (dist < MIN_SPACING) {
        const safeDist = Math.max(dist, 0.01);
        const push = (MIN_SPACING - safeDist) / 2;
        const ux = dist > 0.01 ? dx/safeDist : 1, uy = dist > 0.01 ? dy/safeDist : 0;
        pos[a.id].x += ux*push; pos[a.id].y += uy*push;
        pos[b.id].x -= ux*push; pos[b.id].y -= uy*push;
      }
    }
  }

  // Re-measure the actual bounding box after relaxation (nodes may have
  // been pushed outside the original W/H guess) and normalize to
  // positive coordinates with a comfortable margin for label text.
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  nodes.forEach(nd => {
    minX=Math.min(minX,pos[nd.id].x); maxX=Math.max(maxX,pos[nd.id].x);
    minY=Math.min(minY,pos[nd.id].y); maxY=Math.max(maxY,pos[nd.id].y);
  });
  const margin = 55;
  nodes.forEach(nd => { pos[nd.id].x += margin - minX; pos[nd.id].y += margin - minY; });
  return { pos, width: (maxX-minX) + margin*2, height: (maxY-minY) + margin*2 };
}

// Lays out every connected component in its own cell instead of running
// one shared physics simulation where every component's gravity pulls
// toward the same center point. With several separate project clusters
// that's exactly what was making them collide and overlap into each
// other as shown in the screenshots — this gives each its own space,
// sized to what forceLayout says that component actually needs, flowing
// left-to-right and wrapping rows to fit within maxRowWidth.
function clusteredLayout(nodes, edges, maxRowWidth) {
  const components = connectedComponents(nodes, edges)
    .sort((a, b) => b.length - a.length);
  if (!components.length) return { pos: {}, width: maxRowWidth, height: 500 };

  const PAD = 28;
  const pos = {};
  let cursorX = PAD, cursorY = PAD, rowHeight = 0, totalHeight = PAD, totalWidth = maxRowWidth;

  components.forEach(comp => {
    const compEdges = edges.filter(e =>
      comp.find(n => n.id === e.from) && comp.find(n => n.id === e.to));
    const { pos: localPos, width: cw, height: ch } = forceLayout(comp, compEdges);

    if (cursorX + cw > maxRowWidth - PAD && cursorX > PAD) {
      // Wrap to a new row
      cursorX = PAD;
      cursorY += rowHeight + PAD;
      totalHeight = cursorY;
      rowHeight = 0;
    }

    comp.forEach(n => {
      const p = localPos[n.id];
      pos[n.id] = { x: cursorX + (p?.x ?? cw / 2), y: cursorY + (p?.y ?? ch / 2) };
    });

    cursorX += cw + PAD;
    totalWidth = Math.max(totalWidth, cursorX);
    rowHeight = Math.max(rowHeight, ch);
    totalHeight = Math.max(totalHeight, cursorY + rowHeight + PAD);
  });

  return { pos, width: totalWidth, height: Math.max(500, totalHeight) };
}

function StatCard({ icon, label, value, color, onClick }) {
  return (
    <div onClick={onClick} style={{ background:"#fff", border:`1.5px solid ${color}33`, borderRadius:"12px", padding:"14px 16px", cursor:"pointer", transition:"all .15s", display:"flex", alignItems:"center", gap:"12px" }}
      onMouseEnter={e=>e.currentTarget.style.boxShadow=`0 4px 16px ${color}22`}
      onMouseLeave={e=>e.currentTarget.style.boxShadow="none"} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClick)?.(e); } }}>
      <div style={{ width:"40px", height:"40px", borderRadius:"10px", background:`${color}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"20px", flexShrink:0 }}>{icon}</div>
      <div>
        <div style={{ fontSize:"22px", fontWeight:800, color, lineHeight:1 }}>{value}</div>
        <div style={{ fontSize:"11px", color:"var(--gray-500)", fontWeight:600, marginTop:"2px" }}>{label}</div>
      </div>
    </div>
  );
}

function EntityCard({ node, graph, onClick, isSelected }) {
  const m = META[node.type];
  const conns = graph.edges.filter(e=>e.from===node.id||e.to===node.id);
  const connectedTo = conns.map(e => {
    const otherId = e.from===node.id ? e.to : e.from;
    return graph.nodes.find(n=>n.id===otherId);
  }).filter(Boolean);

  return (
    <div onClick={onClick} style={{
      background: isSelected ? m.color+"12" : "#fff",
      border: `1.5px solid ${isSelected ? m.color : "var(--border)"}`,
      borderRadius:"12px", padding:"14px", cursor:"pointer",
      transition:"all .15s", position:"relative",
      boxShadow: isSelected ? `0 4px 16px ${m.color}22` : "var(--elevation-1)",
    }}
      onMouseEnter={e=>{ if(!isSelected){ e.currentTarget.style.borderColor=m.color+"66"; e.currentTarget.style.boxShadow=`0 4px 12px ${m.color}18`; }}}
      onMouseLeave={e=>{ if(!isSelected){ e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.boxShadow="0 1px 3px rgba(0,0,0,.04)"; }}} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClick)?.(e); } }}>
      <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"10px" }}>
        <div style={{ width:"34px", height:"34px", borderRadius:"9px", background:m.color+"18", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"16px", flexShrink:0 }}>{m.icon}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"2px" }}>
            <span style={{ fontSize:"9px", fontWeight:800, padding:"1px 6px", borderRadius:"var(--radius-full)", background:m.color+"18", color:m.color, letterSpacing:".05em", textTransform:"uppercase", flexShrink:0 }}>{node.type}</span>
          </div>
          <div style={{ fontWeight:700, fontSize:"13px", color:"var(--gray-900)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{node.label}</div>
          {node.status && <div style={{ fontSize:"10px", color:"var(--gray-500)", marginTop:"1px" }}>{node.status.replace(/_/g," ")}</div>}
        </div>
      </div>

      {/* Progress bar for projects/goals */}
      {(node.type==="project"||node.type==="goal") && (
        <div style={{ marginBottom:"8px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:"10px", color:"var(--gray-400)", marginBottom:"3px" }}>
            <span>Progress</span><span style={{ fontWeight:700, color:m.color }}>{node.progress||0}%</span>
          </div>
          <div style={{ height:"4px", background:"var(--gray-100)", borderRadius:"99px", overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${node.progress||0}%`, background:m.color, borderRadius:"99px", transition:"width .3s" }} />
          </div>
        </div>
      )}

      {/* Priority badge for tasks */}
      {node.type==="task" && node.priority && (
        <div style={{ marginBottom:"8px" }}>
          <span style={{ fontSize:"10px", fontWeight:700, padding:"2px 8px", borderRadius:"var(--radius-full)", background: node.priority==="HIGH"?"#fee2e2":node.priority==="MEDIUM"?"#fef3c7":"#f0fdf4", color: node.priority==="HIGH"?"var(--danger)":node.priority==="MEDIUM"?"var(--warning)":"var(--success)" }}>
            {node.priority} PRIORITY
          </span>
        </div>
      )}

      {/* Connections */}
      {connectedTo.length > 0 ? (
        <div style={{ borderTop:"1px solid var(--gray-100)", paddingTop:"8px" }}>
          <div style={{ fontSize:"10px", fontWeight:700, color:"var(--gray-400)", marginBottom:"5px", textTransform:"uppercase", letterSpacing:".05em" }}>Connected to</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"4px" }}>
            {connectedTo.slice(0,4).map((c,i) => (
              <span key={i} title={c.label} style={{ fontSize:"10px", padding:"2px 7px", borderRadius:"var(--radius-full)", background:META[c.type]?.color+"18", color:META[c.type]?.color, fontWeight:600 }}>
                {META[c.type]?.icon} {c.label.length > 22 ? c.label.slice(0,22)+"…" : c.label}
              </span>
            ))}
            {connectedTo.length > 4 && <span style={{ fontSize:"10px", color:"var(--gray-400)" }}>+{connectedTo.length-4} more</span>}
          </div>
        </div>
      ) : (
        <div style={{ fontSize:"10px", color:"var(--gray-400)", borderTop:"1px solid var(--gray-100)", paddingTop:"6px" }}>No connections yet</div>
      )}
    </div>
  );
}

export default function KnowledgeGraph() {
  const { activeWorkspace } = useAuth();
  const [graph,    setGraph]    = useState(null);
  const [pos,      setPos]      = useState({});
  const [filter,   setFilter]   = useState("all");
  const [selected, setSelected] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [view,     setView]     = useState("graph"); // "graph" | "cards"
  const [canvasW,  setCanvasW]  = useState(900);
  const [canvasH,  setCanvasH]  = useState(500);
  const TARGET_ROW_WIDTH = 900; // preferred width before wrapping to a new row of clusters

  useEffect(()=>{
    const wsId = activeWorkspace?.id;
    Promise.all([
      api.docs(wsId).catch(()=>({ data:{ data:[] } })),
      api.tasks().catch(()=>({ data:{ data:[] } })),
      api.goals().catch(()=>({ data:{ data:[] } })),
      api.projects().catch(()=>({ data:{ data:[] } })),
    ]).then(([dr,tr,gr,pr])=>{
      const g = buildGraph(unwrapList(dr), unwrapList(tr), unwrapList(gr), unwrapList(pr));
      setGraph(g);
      // Lay out only nodes that actually have a relationship to show — a
      // node with zero edges has nothing to visualize in a *relationship*
      // graph, and previously still took part in the physics simulation
      // anyway: repelled by every other node, pulled only weakly toward
      // center, with nothing pulling it anywhere in particular. That's
      // exactly what was scattering isolated tasks/goals into empty
      // corners — worse the more of them there were. They're still fully
      // visible, just in Cards view (a plain grid, no physics, no
      // scattering) instead of as directionless dots here. See the
      // isolated-items note rendered near the graph controls below.
      const connectedIds = new Set();
      g.edges.forEach(e => { connectedIds.add(e.from); connectedIds.add(e.to); });
      const connectedNodes = g.nodes.filter(n => connectedIds.has(n.id));
      // Each connected component (e.g. one project and its tasks) gets
      // its own cell rather than every component's layout competing for
      // the same shared center — see clusteredLayout's own comment for
      // why. The canvas grows to fit however many rows of clusters that
      // takes; the panel scrolls internally (see the graph <div> below)
      // so growth doesn't also expand the page itself indefinitely.
      const { pos: clusteredPos, width: dynamicW, height: dynamicH } =
        clusteredLayout(connectedNodes, g.edges, TARGET_ROW_WIDTH);
      setCanvasW(dynamicW);
      setCanvasH(dynamicH);
      setPos(clusteredPos);
    }).catch(()=>{}).finally(()=>setLoading(false));
  },[activeWorkspace?.id]);

  if (loading) return (
    <div>
      <PageHeader icon="🕸" title="Knowledge Graph" />
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", padding:"60px", color:"var(--gray-400)", gap:"12px" }}>
        <div style={{ width:"24px", height:"24px", border:"3px solid var(--border)", borderTopColor:"var(--brand-500)", borderRadius:"50%", animation:"spin .7s linear infinite" }} />
        Building knowledge graph…
      </div>
    </div>
  );

  const counts = { project:0, goal:0, task:0, doc:0 };
  graph?.nodes?.forEach(n => { if (counts[n.type]!==undefined) counts[n.type]++; });
  const totalConns = graph?.edges?.length || 0;

  if (!graph || graph.nodes.length === 0) return (
    <div>
      <PageHeader icon="🕸" title="Knowledge Graph" description="Visual map of relationships between docs, tasks, goals, and projects" />
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"12px", marginBottom:"24px" }}>
        {Object.entries(META).map(([type,m])=>(
          <StatCard key={type} icon={m.icon} label={m.label+"s"} value={0} color={m.color} />
        ))}
      </div>
      <div style={{ textAlign:"center", padding:"48px", background:"#fff", borderRadius:"16px", border:"1px solid var(--border)" }}>
        <div style={{ fontSize:"48px", marginBottom:"12px" }}>🕸</div>
        <div style={{ fontWeight:800, fontSize:"18px", color:"var(--gray-800)", marginBottom:"8px" }}>No data yet</div>
        <div style={{ fontSize:"13px", color:"var(--gray-500)" }}>Create projects, goals, docs, and tasks to build your knowledge graph.</div>
      </div>
    </div>
  );

  // filteredNodes: everything matching the type filter, isolated items
  // included — this is what Cards view shows (a plain grid has no
  // scattering problem, so there's no reason to hide anything there).
  // graphNodes/graphEdges: the connected-only subset the SVG graph
  // actually renders (see the layout comment in the data-loading effect
  // above for why isolated nodes are excluded there specifically).
  const filteredNodes = filter==="all" ? graph.nodes : graph.nodes.filter(n=>n.type===filter);
  const isolatedCount = graph.nodes.length - Object.keys(pos).length;
  const graphNodes = filteredNodes.filter(n => pos[n.id]);
  const graphEdges = graph.edges.filter(e=>graphNodes.find(n=>n.id===e.from)&&graphNodes.find(n=>n.id===e.to));

  return (
    <div>
      <PageHeader icon="🕸" title="Knowledge Graph" description="Visual map of relationships between docs, tasks, goals, and projects" />

      {/* Stats row */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:"10px", marginBottom:"16px" }}>
        {/* StatCard also concatenates its color prop with an alpha suffix
            internally (see StatCard above) — literal hex here too, same
            reasoning as META/EDGE_COLORS. */}
        <StatCard icon="📁" label="Projects" value={counts.project} color="#3b82f6" onClick={()=>setFilter(filter==="project"?"all":"project")} />
        <StatCard icon="🎯" label="Goals" value={counts.goal} color="#1E8E5A" onClick={()=>setFilter(filter==="goal"?"all":"goal")} />
        <StatCard icon="✅" label="Tasks" value={counts.task} color="#C17D22" onClick={()=>setFilter(filter==="task"?"all":"task")} />
        <StatCard icon="📝" label="Docs" value={counts.doc} color="#5B5FEE" onClick={()=>setFilter(filter==="doc"?"all":"doc")} />
        <StatCard icon="🔗" label="Connections" value={totalConns} color="#7C5CBF" onClick={()=>{}} />
      </div>

      {/* Controls */}
      <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"12px", flexWrap:"wrap" }}>
        <div style={{ display:"flex", gap:"4px", background:"var(--gray-100)", borderRadius:"10px", padding:"3px" }}>
          {["graph","cards"].map(v=>(
            <button key={v} onClick={()=>setView(v)} style={{ padding:"5px 14px", borderRadius:"7px", border:"none", cursor:"pointer", fontSize:"12px", fontWeight:700, background:view===v?"var(--surface-1)":"transparent", color:view===v?"var(--gray-800)":"var(--gray-500)", boxShadow:view===v?"var(--elevation-1)":"none", transition:"all .15s" }}>
              {v==="graph"?"Graph":"Cards"}
            </button>
          ))}
        </div>
        <div style={{ display:"flex", gap:"4px", flexWrap:"wrap" }}>
          {["all","project","goal","task","doc"].map(f=>(
            <button key={f} onClick={()=>{setFilter(f);setSelected(null);}} style={{ padding:"5px 12px", borderRadius:"8px", border:`1.5px solid ${f==="all"?"var(--border)":META[f]?.color+"44"}`, background:filter===f?(f==="all"?"var(--gray-800)":META[f]?.color):"#fff", color:filter===f?"#fff":(f==="all"?"var(--gray-700)":META[f]?.color), fontSize:"11px", fontWeight:700, cursor:"pointer", transition:"all .15s" }}>
              {f==="all" ? "All" : `${META[f]?.icon} ${f}s`}
              {f!=="all" && <span style={{ marginLeft:"5px", background:filter===f?"rgba(255,255,255,.25)":META[f]?.color+"22", borderRadius:"var(--radius-full)", padding:"0 5px", fontSize:"10px" }}>{counts[f]}</span>}
            </button>
          ))}
        </div>
        <div style={{ marginLeft:"auto", fontSize:"11px", color:"var(--gray-400)", background:"var(--gray-50)", padding:"5px 12px", borderRadius:"8px", border:"1px solid var(--border)" }}>
          {view==="graph"
            ? <><b style={{ color:"var(--gray-700)" }}>{graphNodes.length}</b> nodes · <b style={{ color:"var(--gray-700)" }}>{graphEdges.length}</b> connections</>
            : <><b style={{ color:"var(--gray-700)" }}>{filteredNodes.length}</b> items</>}
        </div>
      </div>

      {/* Items with no relationships yet aren't shown as scattered,
          unanchored dots in the graph below — nothing pulls them toward
          any particular place there, which is exactly what was littering
          the corners. They're still fully visible in Cards view (a plain
          grid, not a physics simulation), one click away. */}
      {view==="graph" && isolatedCount > 0 && (
        <div style={{ display:"flex", alignItems:"center", gap:"6px", fontSize:"11px", color:"var(--gray-400)", marginBottom:"10px" }}>
          <span>{isolatedCount} item{isolatedCount===1?"":"s"} with no connections yet aren't shown here.</span>
          <button onClick={()=>setView("cards")} style={{ background:"none", border:"none", color:"var(--brand-500)", fontWeight:700, cursor:"pointer", fontSize:"11px", padding:0 }}>
            View in Cards →
          </button>
        </div>
      )}

      {/* Graph view */}
      {view==="graph" && (
        <div style={{ display:"grid", gridTemplateColumns:selected?"1fr 320px":"1fr", gap:"12px", alignItems:"start" }}>
          {/* SVG graph — a real scrollable canvas (both directions),
              like a workflow/diagram tool (n8n, Miro, etc.), rather than
              shrinking everything to fit the panel. Rendering the SVG at
              its actual pixel size (width/height, not width="100%" +
              viewBox — that combination scales content DOWN to fit the
              container, which is what was cramming nodes and labels
              together as the graph grew rather than actually giving them
              room) keeps nodes and labels at one fixed, readable size no
              matter how large the graph gets; the surrounding panel
              scrolls to reveal more of it instead. */}
          <div style={{ background:"var(--surface-1)", border:"1px solid var(--border)", borderRadius:"16px", overflow:"hidden", boxShadow:"var(--elevation-1)" }}>
            <div style={{ maxHeight:"70vh", maxWidth:"100%", overflow:"auto" }}>
            <svg width={canvasW} height={canvasH} viewBox={`0 0 ${canvasW} ${canvasH}`} style={{ display:"block" }}>
              <defs>
                {Object.entries(EDGE_COLORS).map(([type,color])=>(
                  <marker key={type} id={`arrow-${type}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill={color+"88"} />
                  </marker>
                ))}
              </defs>
              {/* Edges */}
              {graphEdges.map((e,i)=>{
                const fp=pos[e.from],tp=pos[e.to];
                if(!fp||!tp) return null;
                const color=EDGE_COLORS[e.type]||"var(--gray-400)";
                return (
                  <g key={i}>
                    <line x1={fp.x} y1={fp.y} x2={tp.x} y2={tp.y}
                      stroke={color+"55"} strokeWidth={2}
                      markerEnd={`url(#arrow-${e.type})`} />
                  </g>
                );
              })}
              {/* Nodes */}
              {graphNodes.map(n=>{
                const p=pos[n.id];
                if(!p) return null;
                const m=META[n.type]||META.doc;
                const isSel=selected?.id===n.id;
                const r=m.radius+(isSel?5:0);
                // 18 characters was cutting labels off right before the
                // part that actually told tasks apart — task titles here
                // commonly start with their project's name ("Personal
                // Project 2 Task 1", "Personal Project 2 Task 2", …), so
                // truncating at 18 left every task under the same project
                // showing the identical "Personal Project 2" with no way
                // to tell them apart. Longer limit, an ellipsis so it's
                // obvious text was cut, and a native hover tooltip (title)
                // with the full name either way.
                const fullLabel = n.label;
                const truncated = fullLabel.length > 30 ? fullLabel.slice(0, 30) + "…" : fullLabel;
                return (
                  <g key={n.id} style={{cursor:"pointer"}} onClick={()=>setSelected(isSel?null:n)}>
                    <title>{fullLabel}</title>
                    {isSel && <circle cx={p.x} cy={p.y} r={r+6} fill={m.color+"22"} />}
                    <circle cx={p.x} cy={p.y} r={r} fill={m.color} opacity={isSel?1:0.88} stroke={isSel?"#fff":"rgba(255,255,255,0.4)"} strokeWidth={isSel?3:1.5} />
                    <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize={r>14?11:9} fill="#fff" fontWeight={800}>
                      {m.icon}
                    </text>
                    <text x={p.x} y={p.y+r+13} textAnchor="middle" fontSize={10} fill={isSel?m.color:"var(--gray-700)"} fontWeight={isSel?800:600}>
                      {truncated}
                    </text>
                  </g>
                );
              })}
            </svg>
            </div>
            {/* Legend — deliberately outside the scrollable area above, so
                it stays put as a fixed reference while a tall graph
                scrolls underneath it. */}
            <div style={{ display:"flex", gap:"16px", padding:"10px 16px", borderTop:"1px solid var(--gray-100)", background:"var(--gray-50)", flexWrap:"wrap", alignItems:"center" }}>
              {Object.entries(META).map(([type,m])=>(
                <span key={type} style={{ display:"flex", alignItems:"center", gap:"5px", fontSize:"11px", color:"var(--gray-600)" }}>
                  <span style={{ width:"10px", height:"10px", borderRadius:"50%", background:m.color, display:"inline-block" }} />
                  {m.label}s ({counts[type]})
                </span>
              ))}
              <span style={{ marginLeft:"auto", fontSize:"11px", color:"var(--gray-400)" }}>Click a node to see details</span>
            </div>
          </div>

          {/* Detail panel */}
          {selected && (
            <div style={{ background:"var(--surface-1)", border:"1px solid var(--border)", borderRadius:"16px", overflow:"hidden", boxShadow:"var(--elevation-2)" }}>
              {/* Header */}
              <div style={{ background:`${META[selected.type]?.color}10`, padding:"16px", borderBottom:"1px solid var(--gray-100)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                    <div style={{ width:"42px", height:"42px", borderRadius:"10px", background:META[selected.type]?.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"22px" }}>{META[selected.type]?.icon}</div>
                    <div>
                      <div style={{ fontWeight:800, fontSize:"14px", color:"var(--gray-900)" }}>{selected.label}</div>
                      <div style={{ fontSize:"10px", fontWeight:700, color:META[selected.type]?.color, textTransform:"uppercase", letterSpacing:".06em", marginTop:"2px" }}>{selected.type}</div>
                    </div>
                  </div>
                  <button onClick={()=>setSelected(null)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:"18px", color:"var(--gray-400)", padding:"2px 6px", borderRadius:"6px" }}>✕</button>
                </div>
                {selected.status && <div style={{ marginTop:"8px", display:"inline-flex", fontSize:"11px", fontWeight:700, padding:"3px 10px", borderRadius:"var(--radius-full)", background:META[selected.type]?.color+"22", color:META[selected.type]?.color }}>{selected.status.replace(/_/g," ")}</div>}
                {(selected.progress!==undefined && (selected.type==="project"||selected.type==="goal")) && (
                  <div style={{ marginTop:"10px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:"11px", color:"var(--gray-500)", marginBottom:"4px" }}>
                      <span>Progress</span><b style={{ color:META[selected.type]?.color }}>{selected.progress}%</b>
                    </div>
                    <div style={{ height:"6px", background:"var(--gray-100)", borderRadius:"99px", overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${selected.progress}%`, background:META[selected.type]?.color, borderRadius:"99px" }} />
                    </div>
                  </div>
                )}
              </div>

              {/* Connections */}
              <div style={{ padding:"14px" }}>
                <div style={{ fontSize:"11px", fontWeight:800, color:"var(--gray-400)", textTransform:"uppercase", letterSpacing:".06em", marginBottom:"10px" }}>
                  Connections ({graph.edges.filter(e=>e.from===selected.id||e.to===selected.id).length})
                </div>
                {graph.edges.filter(e=>e.from===selected.id||e.to===selected.id).length===0
                  ? <div style={{ fontSize:"12px", color:"var(--gray-400)", textAlign:"center", padding:"16px 0" }}>No connections found</div>
                  : graph.edges.filter(e=>e.from===selected.id||e.to===selected.id).map((e,i)=>{
                      const otherId=e.from===selected.id?e.to:e.from;
                      const other=graph.nodes.find(n=>n.id===otherId);
                      if(!other) return null;
                      const om=META[other.type]||META.doc;
                      return (
                        <div key={i} onClick={()=>setSelected(other)} style={{ display:"flex", alignItems:"center", gap:"8px", padding:"8px 10px", borderRadius:"8px", cursor:"pointer", transition:"background .12s", marginBottom:"4px" }}
                          onMouseEnter={e=>e.currentTarget.style.background="var(--gray-50)"}
                          onMouseLeave={e=>e.currentTarget.style.background="transparent"} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (()=>setSelected(other))?.(e); } }}>
                          <div style={{ width:"28px", height:"28px", borderRadius:"7px", background:om.color+"18", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"14px", flexShrink:0 }}>{om.icon}</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:"12px", fontWeight:700, color:"var(--gray-800)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{other.label}</div>
                            <div style={{ fontSize:"10px", color:"var(--gray-400)" }}>{e.type.replace(/_/g," ")}</div>
                          </div>
                          <span style={{ fontSize:"9px", fontWeight:700, padding:"2px 7px", borderRadius:"var(--radius-full)", background:EDGE_COLORS[e.type]+"22", color:EDGE_COLORS[e.type], flexShrink:0, whiteSpace:"nowrap" }}>{e.type.replace(/_/g," ")}</span>
                        </div>
                      );
                    })
                }
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cards view */}
      {view==="cards" && (
        <div>
          {["project","goal","task","doc"].map(type=>{
            const typeNodes=filteredNodes.filter(n=>n.type===type);
            if(!typeNodes.length) return null;
            const m=META[type];
            return (
              <div key={type} style={{ marginBottom:"24px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"10px" }}>
                  <span style={{ fontSize:"18px" }}>{m.icon}</span>
                  <span style={{ fontWeight:800, fontSize:"14px", color:"var(--gray-800)" }}>{m.label}s</span>
                  <span style={{ fontSize:"11px", color:m.color, background:m.color+"18", padding:"2px 8px", borderRadius:"var(--radius-full)", fontWeight:700 }}>{typeNodes.length}</span>
                  <div style={{ flex:1, height:"1px", background:"var(--gray-100)", marginLeft:"4px" }} />
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:"10px" }}>
                  {typeNodes.map(n=>(
                    <EntityCard key={n.id} node={n} graph={graph} isSelected={selected?.id===n.id} onClick={()=>setSelected(selected?.id===n.id?null:n)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
