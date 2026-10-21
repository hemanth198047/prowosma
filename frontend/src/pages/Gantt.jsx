import { useState, useEffect, useRef, useCallback } from "react";
import { unwrapList } from "../api/client";
import { getProjects } from "../api/projects";
import { getGoals, updateGoal } from "../api/goals";
import client from "../api/client";
import PageHeader from "../components/PageHeader";

import "../styles/pages/gantt.css";
const ZOOM_LEVELS = {
  day:     { label: "Day",     dayWidth: 50 },
  week:    { label: "Week",    dayWidth: 20 },
  month:   { label: "Month",   dayWidth:  8 },
  quarter: { label: "Quarter", dayWidth:  3 },
};

const STATUS_COLOR = {
  TODO: "var(--brand-500)", IN_PROGRESS: "var(--warning)", DONE: "var(--success)",
};
const STATUS_LABEL = {
  TODO: "To Do", IN_PROGRESS: "In Progress", DONE: "Done",
};

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function daysBetween(a, b) { return Math.round((startOfDay(b)-startOfDay(a))/86400000); }
function fmtDate(d, fmt) {
  const x   = new Date(d);
  const day = x.getDate();
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][x.getMonth()];
  if (fmt === "MMM")   return mon;
  if (fmt === "Q")     return `Q${Math.ceil((x.getMonth()+1)/3)} ${x.getFullYear()}`;
  return `${day} ${mon}`;
}

// ── Dependency arrows overlay ─────────────────────────────────
function DependencyArrows({ items, ROW_H, dayWidth, timeStart }) {
  if (!items || items.length === 0) return null;
  const arrows = [];
  items.forEach((item, toIdx) => {
    if (!item.blockedByTaskIds?.length) return;
    item.blockedByTaskIds.forEach((fromId) => {
      const fromIdx = items.findIndex((i) => i.id === fromId);
      if (fromIdx < 0) return;
      const from    = items[fromIdx];
      const fromDue = from.dueDate ? new Date(from.dueDate) : null;
      const toDue   = item.dueDate ? new Date(item.dueDate) : null;
      const toStart = item.startDate ? new Date(item.startDate) : toDue ? addDays(toDue,-3) : null;
      if (!fromDue || !toStart) return;
      const x1 = (daysBetween(timeStart, fromDue)  + 1) * dayWidth;
      const y1 = fromIdx * ROW_H + ROW_H / 2;
      const x2 = daysBetween(timeStart, toStart) * dayWidth;
      const y2 = toIdx   * ROW_H + ROW_H / 2;
      arrows.push({ x1, y1, x2, y2, key: `${fromId}-${item.id}` });
    });
  });
  if (!arrows.length) return null;
  const maxW = Math.max(...arrows.map(a => Math.max(a.x1, a.x2))) + 20;
  const maxH = Math.max(...arrows.map(a => Math.max(a.y1, a.y2))) + 10;
  return (
    <svg style={{ position:"absolute", top:0, left:0, width:maxW, height:maxH, pointerEvents:"none", zIndex:2 }}>
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="var(--danger)" />
        </marker>
      </defs>
      {arrows.map(({ x1, y1, x2, y2, key }) => {
        const mx = (x1 + x2) / 2;
        return (
          <path key={key}
            d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
            fill="none" stroke="var(--danger)" strokeWidth="1.5"
            strokeDasharray="4 2" markerEnd="url(#arrowhead)"
          />
        );
      })}
    </svg>
  );
}

// ── Main chart panel ──────────────────────────────────────────
const ROW_H = 36;

function GanttPanel({ items, zoom, dragging, dragOffset, resizing, resizeOffset,
                      onBarMouseDown, onResizeMouseDown, showDeps, label }) {
  const { dayWidth } = ZOOM_LEVELS[zoom];
  const today      = startOfDay(new Date());
  const timeStart  = addDays(today, -30);
  const totalDays  = zoom === "quarter" ? 365 : 150;
  const totalWidth = totalDays * dayWidth;
  const todayLeft  = daysBetween(timeStart, today) * dayWidth;

  // Date header columns
  const dateCols = [];
  if (zoom === "quarter") {
    let cur = new Date(timeStart), day = 0;
    while (day < totalDays) {
      const qStart  = new Date(cur.getFullYear(), Math.floor(cur.getMonth()/3)*3, 1);
      const qEnd    = new Date(cur.getFullYear(), Math.floor(cur.getMonth()/3)*3+3, 0);
      const qDays   = Math.min(daysBetween(qStart, qEnd)+1, totalDays - day);
      dateCols.push({ day, label: fmtDate(qStart, "Q"), span: qDays });
      cur = new Date(cur.getFullYear(), Math.floor(cur.getMonth()/3)*3+3, 1);
      day += qDays;
    }
  } else if (zoom === "month") {
    let cur = new Date(timeStart), day = 0;
    while (day < totalDays) {
      const dim = new Date(cur.getFullYear(), cur.getMonth()+1, 0).getDate();
      dateCols.push({ day, label: fmtDate(cur, "MMM"), span: Math.min(dim, totalDays-day) });
      cur = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
      day += dim;
    }
  } else {
    const step = zoom === "day" ? 1 : 7;
    for (let i = 0; i < totalDays; i += step)
      dateCols.push({ day: i, label: fmtDate(addDays(timeStart, i), "D MMM"), span: step });
  }

  function barGeometry(item) {
    const due   = item.dueDate   ? new Date(item.dueDate)   : null;
    const start = item.startDate ? new Date(item.startDate) : due ? addDays(due,-3) : null;
    if (!due || !start) return null;
    let s = daysBetween(timeStart, start);
    let e = daysBetween(timeStart, due);
    if (dragging?.taskId === item.id)  { s += dragOffset; e += dragOffset; }
    if (resizing?.taskId === item.id)  { e += resizeOffset; }
    const w  = Math.max((e - s) * dayWidth, dayWidth);
    const isMilestone = w <= dayWidth * 1.5;
    return {
      left:        s * dayWidth,
      width:       isMilestone ? 0 : w,
      color:       item.color || STATUS_COLOR[item.status] || "var(--brand-500)",
      isMilestone,
      endLeft:     e * dayWidth,
      progress:    typeof item.progress === "number" ? item.progress : null,
    };
  }

  if (items.length === 0) {
    return (
      <div className="empty-state" style={{ padding:"32px 0" }}>
        <div style={{ fontSize:"40px", marginBottom:"10px" }}>📅</div>
        <p style={{ fontWeight:600 }}>{label}</p>
      </div>
    );
  }

  return (
    <div className="gantt-container">
      {/* Left panel */}
      <div className="gantt-left">
        <div className="gantt-left-header">
          <span>Name</span>
          <span>Status</span>
        </div>
        {items.map((item) => {
          const barColor   = item.color || STATUS_COLOR[item.status] || "var(--brand-500)";
          const isHeader   = item.isProjectHeader;
          const isGoal     = item.isGoal;
          const isChild    = item.isGoalStep || item.isTask;
          return (
            <div key={item.id} className="gantt-left-row"
              style={{
                background:  (isGoal || isHeader) ? "var(--gray-50)" : undefined,
                borderLeft:  (isGoal || isHeader) ? `3px solid ${barColor}` : isChild ? "3px solid transparent" : undefined,
                paddingLeft: isChild ? "28px" : "12px",
                borderBottom:isHeader ? "1px solid var(--border)" : undefined,
              }}
            >
              <div className="gantt-task-name" title={item.title}>
                {isHeader && <span style={{ fontSize:"13px", marginRight:"6px" }}>📁</span>}
                {isGoal   && <span style={{ fontSize:"13px", marginRight:"6px" }}>🎯</span>}
                {isChild  && <span style={{ fontSize:"10px", color:"var(--gray-300)", marginRight:"4px" }}>↳</span>}
                {!isGoal && !isHeader && !isChild && (
                  <div className="gantt-proj-dot" style={{ background: barColor }} />
                )}
                <div style={{ display:"flex", flexDirection:"column", overflow:"hidden", flex:1 }}>
                  <span style={{
                    fontSize:   (isGoal || isHeader) ? "13px" : "12px",
                    fontWeight: (isGoal || isHeader) ? 700 : 500,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                    color: (isGoal || isHeader) ? "var(--gray-800)" : "var(--gray-700)",
                  }}>{item.title}</span>
                  {item.subtitle && !isHeader && (
                    <span style={{ fontSize:"10px", color:"var(--gray-400)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {item.subtitle}
                    </span>
                  )}
                </div>
              </div>
              <span className="gantt-status-badge"
                style={{ background: barColor+"22", color: barColor, flexShrink:0 }}>
                {item.statusLabel || STATUS_LABEL[item.status] || item.status}
              </span>
            </div>
          );
        })}
      </div>

      {/* Right panel */}
      <div className="gantt-right">
        <div className="gantt-header" style={{ width: totalWidth }}>
          {dateCols.map((col, i) => (
            <div key={i} className="gantt-date-col"
              style={{ width: col.span * dayWidth, flexShrink:0 }}>
              {col.label}
            </div>
          ))}
        </div>
        <div style={{ position:"relative", width: totalWidth }}>
          <div className="gantt-today-line" style={{ left: todayLeft }} />

          {/* Alternating column shading */}
          {zoom === "day" && Array.from({ length: totalDays }).map((_, i) => (
            <div key={i} style={{
              position:"absolute", top:0, bottom:0,
              left: i*dayWidth, width: dayWidth,
              background: i%2===0 ? "transparent" : "rgba(0,0,0,0.02)",
              pointerEvents:"none",
            }} />
          ))}

          {/* Dependency arrows */}
          {showDeps && (
            <DependencyArrows
              items={items} ROW_H={ROW_H}
              dayWidth={dayWidth} timeStart={timeStart}
            />
          )}

          {/* Task bars */}
          {items.map((item) => {
            const geo = barGeometry(item);
            return (
              <div key={item.id} className="gantt-row" style={{ width: totalWidth, height: ROW_H }}>
                {geo && (
                  <>
                    {geo.isMilestone ? (
                      /* Milestone diamond */
                      <div className="gantt-milestone"
                        style={{ left: geo.endLeft - 8, top: ROW_H/2 - 8 }}
                        title={`Milestone: ${item.title}`}
                      />
                    ) : (
                      /* Normal bar */
                      <div className="gantt-bar"
                        style={{
                          left: geo.left, width: geo.width,
                          background: geo.color,
                          cursor: dragging?.taskId === item.id ? "grabbing" : "grab",
                          opacity: item.status === "DONE" ? 0.75 : 1,
                        }}
                        onMouseDown={item.isProjectHeader ? undefined : (e) => onBarMouseDown(e, item)}
                        title={item.title}
                      >
                        {/* Progress fill */}
                        {geo.progress !== null && geo.progress > 0 && (
                          <div className="gantt-bar-progress"
                            style={{ width: `${geo.progress}%` }}
                          />
                        )}
                        {geo.width > 40 && (
                          <span className="gantt-bar-label">{item.title}</span>
                        )}
                        {/* Resize handle — right edge */}
                        {!item.isProjectHeader && (
                          <div className="gantt-resize-handle"
                            onMouseDown={(e) => { e.stopPropagation(); onResizeMouseDown(e, item); }}
                            title="Drag to resize" role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ((e) => { e.stopPropagation(); onResizeMouseDown(e, item); })?.(e); } }}
                          />
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
export default function Gantt() {
  const [tasks, setTasks]         = useState([]);
  const [projects, setProjects]   = useState([]);
  const [goals, setGoals]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [zoom, setZoom]           = useState("week");
  const [activeTab, setActiveTab] = useState("tasks");
  const [filterProject, setFilterProject] = useState("ALL");
  const [showDeps, setShowDeps]   = useState(true);

  const [dragging, setDragging]     = useState(null);
  const [dragOffset, setDragOffset] = useState(0);
  const dragStateRef = useRef({ offset:0, active:false });

  const [resizing, setResizing]       = useState(null);
  const [resizeOffset, setResizeOffset] = useState(0);
  const resizeStateRef = useRef({ offset:0, active:false });

  const [tooltip, setTooltip] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [taskRes, projRes, goalRes] = await Promise.all([
        client.get("/tasks/gantt"), getProjects(), getGoals().catch(() => ({ data: [] })),
      ]);
      setTasks(unwrapList(taskRes));
      setProjects(unwrapList(projRes));
      setGoals(unwrapList(goalRes));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern
    load();
  }, [load]);

  // ── Build task items ─────────────────────────────────────────
  const filteredRaw = tasks.filter(
    (t) => t.dueDate && (filterProject === "ALL" || t.projectId === filterProject)
  );
  const projectsWithTasks = projects.filter((p) =>
    filteredRaw.some((t) => t.projectId === p.id)
  );
  const taskItems = filterProject !== "ALL"
    ? filteredRaw.map((t) => ({
        ...t, color: STATUS_COLOR[t.status] || "var(--brand-500)",
        subtitle: projects.find((p) => p.id === t.projectId)?.name,
        statusLabel: STATUS_LABEL[t.status] || t.status, isTask: true,
      }))
    : projectsWithTasks.flatMap((proj) => {
        const pts = filteredRaw.filter((t) => t.projectId === proj.id)
          .map((t) => ({
            ...t, color: STATUS_COLOR[t.status] || "var(--brand-500)",
            subtitle: proj.name,
            statusLabel: STATUS_LABEL[t.status] || t.status, isTask: true,
          }));
        return [
          { id:`proj_header_${proj.id}`, title:proj.name,
            status: proj.status||"ACTIVE", dueDate: proj.dueDate||null, startDate:null,
            isProjectHeader:true, color: proj.color||"var(--brand-500)", statusLabel: proj.status||"Active" },
          ...pts,
        ];
      });

  // ── Build goal items ─────────────────────────────────────────
  const goalItems = goals.filter((g) => g.targetDate).flatMap((g) => [
    { id:`goal_${g.id}`, title:g.title,
      status: g.status==="ACHIEVED"?"DONE":"IN_PROGRESS",
      dueDate: g.targetDate, startDate:null, isGoal:true, goalId:g.id, goalData:g,
      color: g.status==="ACHIEVED"?"var(--success)":"var(--warning)",
      statusLabel: g.status==="ACHIEVED"?"Achieved":"Active",
      progress: g.progress||0,
    },
    ...(g.subGoals||[]).flatMap((sg) =>
      (sg.steps||[]).map((step) => ({
        id:`step_${g.id}_${sg.id}_${step.id}`, title:step.title,
        status: step.completed?"DONE":"TODO",
        dueDate:g.targetDate, startDate:null, isGoalStep:true, goalId:g.id, goalData:g,
        color: step.completed?"var(--success)":"var(--purple)",
        subtitle:`${g.title} › ${sg.title}`,
        statusLabel: step.completed?"Done":"Pending",
      }))
    ),
  ]);

  const items = activeTab === "tasks" ? taskItems : goalItems;

  // ── Drag (move bar) ──────────────────────────────────────────
  const onBarMouseDown = (e, item) => {
    e.preventDefault(); e.stopPropagation();
    const { dayWidth } = ZOOM_LEVELS[zoom];
    const startX    = e.clientX;
    const origDue   = item.dueDate   ? new Date(item.dueDate)   : null;
    const origStart = item.startDate ? new Date(item.startDate) : null;
    dragStateRef.current = { offset:0, active:true };
    setDragging({ taskId:item.id, startX, origStart, origDue });
    setDragOffset(0);

    const onMove = (ev) => {
      if (!dragStateRef.current.active) return;
      const days = Math.round((ev.clientX - startX) / dayWidth);
      dragStateRef.current.offset = days;
      setDragOffset(days);
      if (origDue) setTooltip({
        text: `📅 Due: ${addDays(origDue,days).toLocaleDateString()}`,
        x: ev.clientX, y: ev.clientY,
      });
    };
    const onUp = async () => {
      dragStateRef.current.active = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const offset = dragStateRef.current.offset;
      setDragging(null); setDragOffset(0); setTooltip(null);
      if (offset !== 0 && origDue) {
        try {
          if (item.isGoal || item.isGoalStep) {
            await updateGoal(item.goalId, { ...item.goalData, targetDate: addDays(origDue,offset).toISOString() });
          } else {
            const newStart = origStart ? addDays(origStart,offset) : null;
            await client.put(`/tasks/${item.id}/dates`, {
              dueDate:   addDays(origDue,offset).toISOString().slice(0,19),
              startDate: newStart ? newStart.toISOString().slice(0,19) : null,
            });
          }
          load();
        } catch (err) { console.error(err); load(); }
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ── Resize (extend/shrink bar right edge) ────────────────────
  const onResizeMouseDown = (e, item) => {
    e.preventDefault(); e.stopPropagation();
    const { dayWidth } = ZOOM_LEVELS[zoom];
    const startX   = e.clientX;
    const origDue  = item.dueDate ? new Date(item.dueDate) : null;
    resizeStateRef.current = { offset:0, active:true };
    setResizing({ taskId:item.id });
    setResizeOffset(0);

    const onMove = (ev) => {
      if (!resizeStateRef.current.active) return;
      const days = Math.round((ev.clientX - startX) / dayWidth);
      resizeStateRef.current.offset = days;
      setResizeOffset(days);
      if (origDue) setTooltip({
        text: `📅 Due: ${addDays(origDue,days).toLocaleDateString()}`,
        x: ev.clientX, y: ev.clientY,
      });
    };
    const onUp = async () => {
      resizeStateRef.current.active = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const offset = resizeStateRef.current.offset;
      setResizing(null); setResizeOffset(0); setTooltip(null);
      if (offset !== 0 && origDue) {
        try {
          const origStart = item.startDate ? new Date(item.startDate) : null;
          await client.put(`/tasks/${item.id}/dates`, {
            dueDate:   addDays(origDue,offset).toISOString().slice(0,19),
            startDate: origStart ? origStart.toISOString().slice(0,19) : null,
          });
          load();
        } catch (err) { console.error(err); load(); }
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const doneCount    = items.filter(i => i.status==="DONE" && !i.isProjectHeader).length;
  const totalCount   = items.filter(i => !i.isProjectHeader).length;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 160px)", userSelect:"none" }}>
      <PageHeader
        icon="📅"
        title="Gantt Chart"
        description="Timeline view of project tasks and goals — drag bars to reschedule, drag edge to resize"
        action={<button className="btn-secondary" style={{ fontSize:"12px" }} onClick={load}>🔄 Refresh</button>}
      />

      {/* ── Toolbar ── */}
      <div style={{ display:"flex", alignItems:"center", gap:"16px",
        padding:"12px 0", borderBottom:"1px solid var(--border)", marginBottom:"16px", flexWrap:"wrap" }}>

        <div className="tab-bar" style={{ marginBottom:0 }}>
          <button className={"tab-btn"+(activeTab==="tasks"?" tab-active":"")}
            onClick={() => setActiveTab("tasks")}>📁 Project Tasks</button>
          <button className={"tab-btn"+(activeTab==="goals"?" tab-active":"")}
            onClick={() => setActiveTab("goals")}>🎯 Goals & Steps</button>
        </div>

        {activeTab === "tasks" && (
          <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)}
            style={{ fontSize:"12px", padding:"6px 12px" }}>
            <option value="ALL">All Projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        {/* Zoom */}
        <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
          <span style={{ fontSize:"12px", color:"var(--gray-500)", fontWeight:600 }}>Zoom:</span>
          <div className="gantt-zoom-btns">
            {Object.entries(ZOOM_LEVELS).map(([key, val]) => (
              <button key={key}
                className={"gantt-zoom-btn"+(zoom===key?" active":"")}
                onClick={() => setZoom(key)}>{val.label}</button>
            ))}
          </div>
        </div>

        {/* Deps toggle */}
        <button
          className={`btn-secondary ${showDeps ? "btn-active" : ""}`}
          style={{ fontSize:"11px", padding:"5px 10px" }}
          onClick={() => setShowDeps(d => !d)}
        >
          🔗 Dependencies
        </button>

        {/* Progress stat */}
        {totalCount > 0 && (
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:"10px" }}>
            <span style={{ fontSize:"12px", color:"var(--gray-500)" }}>
              <strong style={{ color:"var(--success)" }}>{doneCount}</strong>/{totalCount} done
            </span>
            <div style={{ width:"80px", height:"6px", background:"var(--gray-200)", borderRadius:"3px" }}>
              <div style={{ width:`${totalCount?Math.round(doneCount*100/totalCount):0}%`,
                height:"100%", background:"var(--success)", borderRadius:"3px", transition:"width 0.3s" }} />
            </div>
          </div>
        )}

        {/* Legend */}
        <div style={{ display:"flex", alignItems:"center", gap:"12px", flexWrap:"wrap" }}>
          {activeTab === "tasks"
            ? Object.entries(STATUS_COLOR).map(([s, c]) => (
                <div key={s} className="gantt-legend-item">
                  <div className="gantt-legend-dot" style={{ background:c }} />
                  <span>{STATUS_LABEL[s]}</span>
                </div>
              ))
            : <>
                <div className="gantt-legend-item">
                  <div className="gantt-legend-dot" style={{ background:"var(--warning)" }} /><span>Active Goal</span>
                </div>
                <div className="gantt-legend-item">
                  <div className="gantt-legend-dot" style={{ background:"var(--success)" }} /><span>Achieved</span>
                </div>
                <div className="gantt-legend-item">
                  <div className="gantt-legend-dot" style={{ background:"var(--purple)" }} /><span>Step</span>
                </div>
              </>
          }
          <div className="gantt-legend-item">
            <div style={{ width:"2px", height:"14px", background:"var(--danger)", borderRadius:"1px" }} />
            <span>Today</span>
          </div>
          <div className="gantt-legend-item">
            <div className="gantt-milestone-legend" />
            <span>Milestone</span>
          </div>
        </div>
      </div>

      {/* ── Chart ── */}
      {loading ? (
        <div className="empty-state">Loading Gantt chart…</div>
      ) : (
        <GanttPanel
          items={items}
          zoom={zoom}
          dragging={dragging}
          dragOffset={dragOffset}
          resizing={resizing}
          resizeOffset={resizeOffset}
          onBarMouseDown={onBarMouseDown}
          onResizeMouseDown={onResizeMouseDown}
          showDeps={showDeps}
          label={activeTab==="tasks"
            ? "No tasks with due dates. Add due dates to tasks to see them here."
            : "No goals with target dates. Add target dates to goals to see them here."}
        />
      )}

      {tooltip && (
        <div className="gantt-tooltip" style={{ left:tooltip.x+12, top:tooltip.y-30 }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}