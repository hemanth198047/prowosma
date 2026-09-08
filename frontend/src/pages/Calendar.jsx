import { useState, useEffect } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { useNavigate } from "react-router-dom";
import { getTasks } from "../api/tasks";
import { getProjects } from "../api/projects";
import { getGoals } from "../api/goals";
import PageHeader from "../components/PageHeader";

export default function Calendar() {
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState("all");
  const navigate = useNavigate();

  const loadEvents = async () => {
    const [taskRes, projRes, goalRes] = await Promise.all([
      getTasks(),
      getProjects(),
      getGoals(),
    ]);

    const taskEvents = taskRes.data
      .filter((t) => t.dueDate)
      .map((t) => ({
        id: `task-${t.id}`,
        title: `✅ ${t.title}`,
        date: t.dueDate,
        backgroundColor:
          t.status === "DONE"
            ? "#10b981"
            : t.status === "IN_PROGRESS"
              ? "#f59e0b"
              : "#6366f1",
        borderColor: "transparent",
        textColor: "#fff",
        extendedProps: {
          type: "task",
          itemId: t.id,
          status: t.status,
          priority: t.priority,
        },
      }));

    const projectEvents = projRes.data
      .filter((p) => p.dueDate)
      .map((p) => ({
        id: `project-${p.id}`,
        title: `📁 ${p.name}`,
        date: p.dueDate,
        backgroundColor: p.color || "#6366f1",
        borderColor: "transparent",
        textColor: "#fff",
        extendedProps: { type: "project", itemId: p.id, status: p.status },
      }));

    const goalEvents = goalRes.data
      .filter((g) => g.targetDate)
      .map((g) => ({
        id: `goal-${g.id}`,
        title: `🎯 ${g.title}`,
        date: g.targetDate,
        backgroundColor: g.status === "ACHIEVED" ? "#10b981" : "#8b5cf6",
        borderColor: "transparent",
        textColor: "#fff",
        extendedProps: { type: "goal", itemId: g.id, status: g.status },
      }));

    setEvents([...taskEvents, ...projectEvents, ...goalEvents]);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern
    loadEvents();
  }, []);

  const filteredEvents = events.filter((e) => {
    if (filter === "all") return true;
    return e.extendedProps.type === filter;
  });

  const handleEventClick = (info) => {
    const { type, itemId } = info.event.extendedProps;
    if (type === "task") navigate(`/tasks?highlight=${itemId}&hcolor=6366f1`);
    else if (type === "project") navigate(`/tasks?projectId=${itemId}`);
    else if (type === "goal")
      navigate(`/goals?highlight=${itemId}&hcolor=8b5cf6`);
  };

  const taskCount = events.filter(
    (e) => e.extendedProps.type === "task",
  ).length;
  const projectCount = events.filter(
    (e) => e.extendedProps.type === "project",
  ).length;
  const goalCount = events.filter(
    (e) => e.extendedProps.type === "goal",
  ).length;

  return (
    <div>
      <PageHeader
        icon="📅"
        title="Calendar"
        description="View all tasks, projects and goals on a calendar"
      />

      {/* Filter bar */}
      <div className="calendar-filter-bar">
        <button
          className={`calendar-filter-btn ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All ({events.length})
        </button>
        <button
          className={`calendar-filter-btn task ${filter === "task" ? "active-task" : ""}`}
          onClick={() => setFilter("task")}
        >
          ✅ Tasks ({taskCount})
        </button>
        <button
          className={`calendar-filter-btn project ${filter === "project" ? "active-project" : ""}`}
          onClick={() => setFilter("project")}
        >
          📁 Projects ({projectCount})
        </button>
        <button
          className={`calendar-filter-btn goal ${filter === "goal" ? "active-goal" : ""}`}
          onClick={() => setFilter("goal")}
        >
          🎯 Goals ({goalCount})
        </button>
      </div>

      {/* Legend */}
      <div className="calendar-legend">
        <span className="legend-item">
          <span className="legend-dot" style={{ background: "#6366f1" }} />
          Todo Task
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: "#f59e0b" }} />
          In Progress
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: "#10b981" }} />
          Done/Achieved
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: "#8b5cf6" }} />
          Goal
        </span>
      </div>

      {/* Calendar */}
      <div className="calendar-wrapper">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay",
          }}
          events={filteredEvents}
          eventClick={handleEventClick}
          eventMouseEnter={(info) => {
            info.el.style.opacity = "0.85";
            info.el.style.cursor = "pointer";
          }}
          eventMouseLeave={(info) => {
            info.el.style.opacity = "1";
          }}
          height="auto"
          dayMaxEvents={3}
          moreLinkText="more"
        />
      </div>
    </div>
  );
}