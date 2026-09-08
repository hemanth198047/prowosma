import { useState, useEffect } from "react";
import { unwrapList } from "../api/client";
import {
  DndContext, DragOverlay, closestCorners,
  PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getTasks, updateTask } from "../api/tasks";
import { getProjects } from "../api/projects";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";

import "../styles/pages/kanban.css";
// C-4: WIP limits per column
const COLUMNS = [
  { id:"TODO",        label:"To Do",       color:"#6366f1", bg:"rgba(99,102,241,0.12)", wipLimit:null },
  { id:"IN_PROGRESS", label:"In Progress", color:"#f59e0b", bg:"rgba(217,119,6,0.12)",  wipLimit:5    },
  { id:"DONE",        label:"Done",        color:"#10b981", bg:"rgba(5,150,105,0.12)",  wipLimit:null },
];

const PRIORITY_COLOR = { LOW:"#10b981", MEDIUM:"#f59e0b", HIGH:"#ef4444" };

// C-4: Swimlane grouping options
const SWIMLANE_OPTIONS = [
  { value:"none",      label:"No swimlanes" },
  { value:"project",   label:"By Project" },
  { value:"priority",  label:"By Priority" },
  { value:"assignee",  label:"By Assignee" },
];

function TaskCard({ task, getProjectName, isDragging }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: task.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="kanban-card">
      <div className="kanban-card-title">{task.title}</div>
      {task.description && <div className="kanban-card-desc">{task.description}</div>}
      <div className="kanban-card-meta">
        {task.projectId && <span className="kanban-card-project">📁 {getProjectName(task.projectId)}</span>}
        {task.dueDate && <span className="kanban-card-date">📅 {new Date(task.dueDate).toLocaleDateString()}</span>}
        {task.storyPoints && <span className="kanban-card-points">{task.storyPoints}pt</span>}
      </div>
      <div className="kanban-card-footer">
        <span className="badge"
          style={{ background:PRIORITY_COLOR[task.priority], color:"#fff", fontSize:"10px" }}>
          {task.priority}
        </span>
        {task.tags?.slice(0,2).map(tag => (
          <span key={tag} className="task-tag" style={{ fontSize:"10px" }}>{tag}</span>
        ))}
      </div>
    </div>
  );
}

// C-4: Column with WIP limit indicator
function KanbanColumn({ column, tasks, getProjectName, activeId }) {
  const isOverWip = column.wipLimit && tasks.length > column.wipLimit;
  const isAtWip   = column.wipLimit && tasks.length === column.wipLimit;

  return (
    <div className={`kanban-column${isOverWip ? " kanban-column-over-wip" : ""}`}>
      <div className="kanban-column-header" style={{ borderTop:`3px solid ${column.color}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
          <span style={{ color:column.color, fontWeight:700 }}>{column.label}</span>
          <span className="kanban-count"
            style={{ background:column.bg, color:column.color }}>
            {tasks.length}
          </span>
          {/* WIP limit badge */}
          {column.wipLimit && (
            <span className="kanban-wip-badge"
              style={{
                background: isOverWip ? "rgba(239,68,68,0.15)" : isAtWip ? "rgba(245,158,11,0.15)" : "var(--gray-100)",
                color: isOverWip ? "#ef4444" : isAtWip ? "#f59e0b" : "var(--gray-400)",
                border: `1px solid ${isOverWip ? "rgba(239,68,68,0.3)" : isAtWip ? "rgba(245,158,11,0.3)" : "var(--border)"}`,
              }}>
              WIP {tasks.length}/{column.wipLimit}
            </span>
          )}
        </div>
        {isOverWip && (
          <span className="kanban-wip-warning">⚠ WIP limit exceeded</span>
        )}
      </div>
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div className="kanban-cards-list">
          {tasks.map(task => (
            <TaskCard key={task.id} task={task} getProjectName={getProjectName} isDragging={activeId === task.id} />
          ))}
          {tasks.length === 0 && <div className="kanban-empty">Drop tasks here</div>}
        </div>
      </SortableContext>
    </div>
  );
}

// C-4: Swimlane wrapper
function SwimlaneLane({ label, color, children }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="kanban-swimlane">
      <div className="kanban-swimlane-header" onClick={() => setCollapsed(v => !v)}
        style={{ borderLeft:`3px solid ${color || "#6366f1"}` }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setCollapsed(v => !v))?.(e); } }}>
        <span className="kanban-swimlane-chevron">{collapsed ? "▶" : "▼"}</span>
        <span className="kanban-swimlane-label">{label}</span>
      </div>
      {!collapsed && <div className="kanban-swimlane-body">{children}</div>}
    </div>
  );
}

export default function Kanban() {
  const [tasks,    setTasks]    = useState([]);
  const [projects, setProjects] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [filterProject,  setFilterProject]  = useState("");
  const [swimlaneMode,   setSwimlaneMode]   = useState("none");
  const [editingWip, setEditingWip] = useState(false);
  const [wipLimits,  setWipLimits]  = useState(
    Object.fromEntries(COLUMNS.map(c => [c.id, c.wipLimit]))
  );
  const navigate = useNavigate();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint:{ distance:8 } }));

  const load = async () => {
    const [tr, pr] = await Promise.all([getTasks(), getProjects()]);
    setTasks(unwrapList(tr));
    setProjects(unwrapList(pr));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern
    load();
  }, []);

  const getProjectName = (id) => projects.find(p => p.id === id)?.name || "";

  const getTasksByStatus = (status, taskSubset) => {
    const list = taskSubset || tasks;
    return list.filter(t => {
      if (t.status !== status) return false;
      if (filterProject && t.projectId !== filterProject) return false;
      return true;
    });
  };

  const findTaskStatus = (taskId) => tasks.find(t => t.id === taskId)?.status;

  const handleDragStart = (e) => setActiveId(e.active.id);

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const activeTask = tasks.find(t => t.id === active.id);
    if (!activeTask) return;
    let newStatus = COLUMNS.find(c => c.id === over.id)?.id || findTaskStatus(over.id);
    if (newStatus && newStatus !== activeTask.status) {
      setTasks(prev => prev.map(t => t.id === activeTask.id ? { ...t, status:newStatus } : t));
      await updateTask(activeTask.id, { ...activeTask, status:newStatus });
    }
  };

  const activeTask = tasks.find(t => t.id === activeId);

  // Build columns config with current WIP limits
  const columns = COLUMNS.map(c => ({ ...c, wipLimit: wipLimits[c.id] || null }));

  // Swimlane grouping logic
  const getSwimlaneGroups = () => {
    const filtered = tasks.filter(t => !filterProject || t.projectId === filterProject);
    if (swimlaneMode === "project") {
      const groups = {};
      filtered.forEach(t => {
        const key = t.projectId || "no-project";
        const label = getProjectName(t.projectId) || "No Project";
        if (!groups[key]) groups[key] = { label, color:"#6366f1", tasks:[] };
        groups[key].tasks.push(t);
      });
      return Object.values(groups);
    }
    if (swimlaneMode === "priority") {
      const order = ["HIGH","MEDIUM","LOW"];
      const colors = { HIGH:"#ef4444", MEDIUM:"#f59e0b", LOW:"#10b981" };
      return order.map(p => ({
        label: p, color: colors[p],
        tasks: filtered.filter(t => t.priority === p),
      })).filter(g => g.tasks.length > 0);
    }
    if (swimlaneMode === "assignee") {
      const groups = {};
      filtered.forEach(t => {
        const key = t.assigneeIds?.[0] || "unassigned";
        if (!groups[key]) groups[key] = { label: key === "unassigned" ? "Unassigned" : key, color:"#8b5cf6", tasks:[] };
        groups[key].tasks.push(t);
      });
      return Object.values(groups);
    }
    return null;
  };

  const swimlaneGroups = getSwimlaneGroups();

  return (
    <div>
      <PageHeader
        icon="🗂️"
        title="Kanban Board"
        description="Drag-and-drop with WIP limits and swimlanes"
        action={
          <div style={{ display:"flex", gap:"8px" }}>
            <button className="btn-secondary" onClick={() => navigate("/sprints")}>🏃 Sprints</button>
            <button className="btn-secondary" onClick={() => navigate("/tasks")}>☰ List View</button>
          </div>
        }
      />

      {/* Toolbar */}
      <div className="kanban-toolbar">
        <select value={filterProject} onChange={e => setFilterProject(e.target.value)}>
          <option value="">All Projects</option>
          {projects.filter(p => !p.parentProjectId).map(p => (
            <optgroup key={p.id} label={p.name}>
              <option value={p.id}>{p.name}</option>
              {projects.filter(sp => sp.parentProjectId === p.id).map(sp => (
                <option key={sp.id} value={sp.id}> ↳ {sp.name}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {/* C-4: Swimlane picker */}
        <div className="kanban-swimlane-picker">
          <span className="kanban-toolbar-label">Swimlanes</span>
          {SWIMLANE_OPTIONS.map(o => (
            <button key={o.value}
              className={`sprint-filter-btn${swimlaneMode === o.value ? " active" : ""}`}
              onClick={() => setSwimlaneMode(o.value)}>
              {o.label}
            </button>
          ))}
        </div>

        {/* C-4: WIP limit editor */}
        <button className="btn-secondary" style={{ fontSize:"12px", padding:"5px 10px" }}
          onClick={() => setEditingWip(v => !v)}>
          ⚙ WIP Limits
        </button>
      </div>

      {/* WIP limit editor panel */}
      {editingWip && (
        <div className="kanban-wip-editor">
          <span className="kanban-toolbar-label">WIP Limits per column (blank = unlimited):</span>
          {columns.map(col => (
            <div key={col.id} className="kanban-wip-field">
              <label style={{ fontSize:"12px", color:col.color, fontWeight:700 }}>{col.label}</label>
              <input type="number" min={0} placeholder="∞"
                value={wipLimits[col.id] || ""}
                onChange={e => setWipLimits(v => ({
                  ...v, [col.id]: e.target.value ? Number(e.target.value) : null
                }))}
                style={{ width:"60px", padding:"4px 8px", borderRadius:"6px",
                  border:"1px solid var(--border)", background:"var(--bg-card)", color:"var(--gray-700)" }}
              />
            </div>
          ))}
          <button className="btn-secondary" style={{ fontSize:"11px" }} onClick={() => setEditingWip(false)}>Done</button>
        </div>
      )}

      {/* Board */}
      <DndContext sensors={sensors} collisionDetection={closestCorners}
        onDragStart={handleDragStart} onDragEnd={handleDragEnd}>

        {swimlaneGroups ? (
          /* Swimlane mode */
          <div className="kanban-swimlanes">
            {swimlaneGroups.map(group => (
              <SwimlaneLane key={group.label} label={group.label} color={group.color}>
                <div className="kanban-board">
                  {columns.map(col => (
                    <KanbanColumn key={col.id} column={col}
                      tasks={getTasksByStatus(col.id, group.tasks)}
                      getProjectName={getProjectName} activeId={activeId} />
                  ))}
                </div>
              </SwimlaneLane>
            ))}
          </div>
        ) : (
          /* Normal board */
          <div className="kanban-board">
            {columns.map(col => (
              <KanbanColumn key={col.id} column={col}
                tasks={getTasksByStatus(col.id)}
                getProjectName={getProjectName} activeId={activeId} />
            ))}
          </div>
        )}

        <DragOverlay>
          {activeTask && (
            <div className="kanban-card kanban-card-dragging">
              <div className="kanban-card-title">{activeTask.title}</div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}