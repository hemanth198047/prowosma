import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus, MapPin, Video } from "lucide-react";
import { getTasks } from "../api/tasks";
import { getProjects } from "../api/projects";
import { getGoals } from "../api/goals";
import { getTeamMembers } from "../api/team";
import { createMeeting, deleteMeeting, getMeetingsInRange, updateMeeting } from "../api/meetings";
import { unwrapList } from "../api/client";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import MeetingEditor from "../components/calendar/MeetingEditor";
import EventPeek from "../components/calendar/EventPeek";
import MiniMonth from "../components/calendar/MiniMonth";
import { toServerDateTime } from "../utils/serverTime";
import {
  isLink, meetingEnd, meetingStart, meetingToEvent, minutesBetween,
  nextHalfHour, slotFromClick, slotFromSelection,
} from "../utils/calendarMeetings";
import "../styles/pages/calendar.css";

const VIEWS = [
  { id: "timeGridDay", label: "Day" },
  { id: "timeGridWorkWeek", label: "Work week" },
  { id: "timeGridWeek", label: "Week" },
  { id: "dayGridMonth", label: "Month" },
];
const VIEW_KEY = "prowosma.calendar.view";
const LAYER_KEY = "prowosma.calendar.layers";

const LAYERS = [
  { id: "meeting", label: "Meetings", color: "#5b5fee" },
  { id: "task", label: "Tasks", color: "var(--brand-500)" },
  { id: "project", label: "Projects", color: "var(--warning)" },
  { id: "goal", label: "Goals", color: "var(--purple)" },
];

function readStored(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

function taskColor(t) {
  if (t.status === "DONE") return "var(--success)";
  if (t.status === "IN_PROGRESS") return "var(--warning)";
  return "var(--brand-500)";
}

const inRect = (el, x, y, axis) => {
  const r = el.getBoundingClientRect();
  return axis === "x" ? x >= r.left && x < r.right : y >= r.top && y < r.bottom;
};

function localDay(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The day (and, in the time grid, the slot time) under a pointer position. */
function slotAtPoint(target, x, y) {
  const day = target.closest(".fc-daygrid-day[data-date]");
  if (day) return { date: localDay(day.dataset.date), allDay: true };
  const grid = target.closest(".fc-timegrid");
  if (!grid) return null;
  const col = [...grid.querySelectorAll(".fc-timegrid-col[data-date]")].find((c) => inRect(c, x, y, "x"));
  const lane = [...grid.querySelectorAll(".fc-timegrid-slot-lane[data-time]")].find((l) => inRect(l, x, y, "y"));
  if (!col || !lane) return null;
  const [hh, mm] = lane.dataset.time.split(":").map(Number);
  const date = localDay(col.dataset.date);
  date.setHours(hh, mm, 0, 0);
  return { date, allDay: false };
}

export default function Calendar() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const calRef = useRef(null);
  const meetingsReq = useRef(0);

  const [view, setView] = useState(() => {
    const v = readStored(VIEW_KEY, "timeGridWorkWeek");
    return VIEWS.some((x) => x.id === v) ? v : "timeGridWorkWeek";
  });
  const [title, setTitle] = useState("");
  const [range, setRange] = useState(null);
  const [current, setCurrent] = useState(() => new Date());
  const [layers, setLayers] = useState(() => ({ meeting: true, task: true, project: true, goal: true, ...readStored(LAYER_KEY, {}) }));

  const [meetings, setMeetings] = useState([]);
  const [meetingsBlocked, setMeetingsBlocked] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [goals, setGoals] = useState([]);
  const [team, setTeam] = useState([]);

  const [peek, setPeek] = useState(null);
  const [editor, setEditor] = useState(null); // { meeting | null, slot }

  const api = () => calRef.current?.getApi();

  // ── Data ────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      getTasks().catch(() => ({ data: [] })),
      getProjects().catch(() => ({ data: [] })),
      getGoals().catch(() => ({ data: [] })), // department access has no goals area
      getTeamMembers().catch(() => ({ data: [] })),
    ]).then(([t, p, g, tm]) => {
      setTasks(unwrapList(t));
      setProjects(unwrapList(p));
      setGoals(unwrapList(g));
      setTeam(unwrapList(tm));
    });
  }, []);

  const loadMeetings = useCallback(async (start, end) => {
    const req = ++meetingsReq.current;
    try {
      const res = await getMeetingsInRange(start, end);
      if (req !== meetingsReq.current) return;
      setMeetings(unwrapList(res));
      setMeetingsBlocked(false);
    } catch (e) {
      if (req !== meetingsReq.current) return;
      const status = e?.response?.status;
      if (status === 401 || status === 403) setMeetingsBlocked(true);
      else toast.show("Couldn't load meetings for this range.", "error");
      setMeetings([]);
    }
  }, [toast]);

  // ── Events ──────────────────────────────────────────────────────
  const events = useMemo(() => {
    const out = [];
    if (layers.meeting) meetings.forEach((m) => { const ev = meetingToEvent(m); if (ev) out.push(ev); });
    if (layers.task) tasks.filter((t) => t.dueDate).forEach((t) => out.push({
      id: `task-${t.id}`, title: t.title, start: t.dueDate.slice(0, 10), allDay: true, editable: false,
      backgroundColor: taskColor(t), borderColor: "transparent", textColor: "#fff",
      classNames: ["cal-ev-item", t.status === "DONE" ? "cal-ev-done" : ""].filter(Boolean),
      extendedProps: { type: "task", itemId: t.id, item: t },
    }));
    if (layers.project) projects.filter((p) => p.dueDate).forEach((p) => out.push({
      id: `project-${p.id}`, title: `📁 ${p.name}`, start: p.dueDate.slice(0, 10), allDay: true, editable: false,
      backgroundColor: p.color || "var(--warning)", borderColor: "transparent", textColor: "#fff",
      classNames: ["cal-ev-item"], extendedProps: { type: "project", itemId: p.id, item: p },
    }));
    if (layers.goal) goals.filter((g) => g.targetDate).forEach((g) => out.push({
      id: `goal-${g.id}`, title: `🎯 ${g.title}`, start: g.targetDate.slice(0, 10), allDay: true, editable: false,
      backgroundColor: g.status === "ACHIEVED" ? "var(--success)" : "var(--purple)", borderColor: "transparent", textColor: "#fff",
      classNames: ["cal-ev-item"], extendedProps: { type: "goal", itemId: g.id, item: g },
    }));
    return out;
  }, [meetings, tasks, projects, goals, layers]);

  const counts = useMemo(() => ({
    meeting: meetings.length,
    task: tasks.filter((t) => t.dueDate).length,
    project: projects.filter((p) => p.dueDate).length,
    goal: goals.filter((g) => g.targetDate).length,
  }), [meetings, tasks, projects, goals]);

  const busyDays = useMemo(
    () => new Set(meetings.map((m) => meetingStart(m)?.toDateString()).filter(Boolean)),
    [meetings],
  );

  const projectName = useCallback((id) => projects.find((p) => p.id === id)?.name, [projects]);
  const teamName = useCallback((who) => {
    if (!who) return "";
    const t = team.find((x) => x.email && x.email.toLowerCase() === String(who).toLowerCase());
    return t?.name ? `${t.name}` : who;
  }, [team]);

  // ── Opening things ─────────────────────────────────────────────
  const openNew = (slot) => {
    if (meetingsBlocked) {
      toast.show("You don't have access to create meetings.", "error");
      return;
    }
    setPeek(null);
    setEditor({ meeting: null, slot });
  };

  const openItem = (type, itemId) => {
    if (type === "meeting") navigate(`/meetings?open=${itemId}`);
    else if (type === "task") navigate(`/tasks?highlight=${itemId}&hcolor=6366f1`);
    else if (type === "project") navigate(`/tasks?projectId=${itemId}`);
    else if (type === "goal") navigate(`/goals?highlight=${itemId}&hcolor=8b5cf6`);
  };

  const openEvent = (event) => {
    const { type, itemId, meeting } = event.extendedProps;
    setPeek(null);
    if (type === "meeting") setEditor({ meeting, slot: null });
    else openItem(type, itemId);
  };

  // ── Calendar callbacks ─────────────────────────────────────────
  const onDatesSet = (info) => {
    setTitle(info.view.title);
    setView(info.view.type);
    writeStored(VIEW_KEY, info.view.type);
    setRange({ start: info.start, end: info.end });
    setCurrent(api()?.getDate() || info.start);
    loadMeetings(info.start, info.end);
  };

  const onDateClick = () => setPeek(null);

  const onEventClick = (info) => {
    info.jsEvent.preventDefault();
    const { type, meeting, item } = info.event.extendedProps;
    setPeek({
      key: `${info.event.id}-${Date.now()}`,
      type,
      item: type === "meeting" ? meeting : item,
      start: info.event.start,
      end: info.event.end,
      color: info.event.backgroundColor,
      rect: info.el.getBoundingClientRect(),
    });
  };

  // Outlook: double-click empty time to create, double-click an item to open it.
  const onDoubleClick = (e) => {
    const evEl = e.target.closest(".fc-event");
    if (evEl) {
      const ev = evEl.dataset.eventId && api()?.getEventById(evEl.dataset.eventId);
      if (ev) openEvent(ev);
      return;
    }
    if (e.target.closest(".fc-col-header, .fc-more-link, .fc-daygrid-day-number, .fc-popover")) return;
    // FullCalendar reports dateClick after the browser's dblclick, so read
    // the day/time straight from the cell under the pointer instead.
    const hit = slotAtPoint(e.target, e.clientX, e.clientY);
    if (hit) openNew(slotFromClick(hit.date, hit.allDay));
  };

  const onSelect = (info) => {
    api()?.unselect();
    openNew(slotFromSelection(info.start, info.end, info.allDay));
  };

  const persistMove = async (info) => {
    const { type, meeting } = info.event.extendedProps;
    if (type !== "meeting") { info.revert(); return; }
    const start = info.event.start;
    const end = info.event.end || new Date(start.getTime() + (meeting.durationMins || 30) * 60000);
    const patch = { meetingDate: toServerDateTime(start), durationMins: minutesBetween(start, end) };
    try {
      const res = await updateMeeting(meeting.id, patch);
      const saved = res?.data?.id ? res.data : { ...meeting, ...patch };
      setMeetings((list) => list.map((m) => (m.id === meeting.id ? saved : m)));
      toast.show(`Moved “${meeting.title}”`, "success");
    } catch {
      info.revert();
      toast.show("Couldn't move the meeting.", "error");
    }
  };

  // ── Save / delete ──────────────────────────────────────────────
  const handleSave = async (payload) => {
    const existing = editor?.meeting;
    let saved;
    if (existing) {
      const res = await updateMeeting(existing.id, payload);
      saved = res?.data?.id ? res.data : { ...existing, ...payload };
      setMeetings((list) => list.map((m) => (m.id === existing.id ? saved : m)));
    } else {
      const res = await createMeeting(payload);
      saved = res.data;
      const start = meetingStart(saved);
      const inView = range && start && start >= range.start && start < range.end;
      if (inView) setMeetings((list) => [...list, saved]);
    }
    setEditor(null);
    toast.show(existing ? "Meeting updated" : "Meeting scheduled", "success");
    if (!existing) {
      const start = meetingStart(saved);
      if (start && range && (start < range.start || start >= range.end)) api()?.gotoDate(start);
    }
  };

  const handleDelete = async (meeting) => {
    const ok = await confirm({
      title: "Delete this meeting?",
      message: `“${meeting.title}” will be removed from the calendar, along with its notes and action items.`,
      confirmText: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMeeting(meeting.id);
      setMeetings((list) => list.filter((m) => m.id !== meeting.id));
      setPeek(null);
      setEditor(null);
      toast.show("Meeting deleted", "success");
    } catch {
      toast.show("Couldn't delete the meeting.", "error");
    }
  };

  const toggleLayer = (id) => setLayers((l) => {
    const next = { ...l, [id]: !l[id] };
    writeStored(LAYER_KEY, next);
    return next;
  });

  const changeView = (id) => api()?.changeView(id);

  // Meetings in the time grid show title, time and place, like Outlook.
  const renderEvent = (arg) => {
    const { type, meeting } = arg.event.extendedProps;
    // `true` = let FullCalendar draw its default content.
    if (type !== "meeting" || !arg.view.type.startsWith("timeGrid")) return true;
    const loc = meeting.location?.trim();
    return (
      <div className="cal-ev-inner">
        <div className="cal-ev-title">{arg.event.title}</div>
        <div className="cal-ev-meta">{arg.timeText}</div>
        {loc && (
          <div className="cal-ev-meta cal-ev-loc">
            {isLink(loc) ? <Video size={11} aria-hidden="true" /> : <MapPin size={11} aria-hidden="true" />}
            {isLink(loc) ? "Online meeting" : loc}
          </div>
        )}
      </div>
    );
  };

  const today = new Date();
  const todayInView = range && today >= range.start && today < range.end;

  return (
    <div className="cal-page">
      <aside className="cal-side" aria-label="Calendar navigation">
        <button type="button" className="btn btn-primary cal-new" onClick={() => openNew(nextHalfHour())} disabled={meetingsBlocked}>
          <Plus size={16} /> New meeting
        </button>
        <MiniMonth
          selected={current}
          rangeStart={range?.start}
          rangeEnd={range?.end}
          busyDays={busyDays}
          firstDay={0}
          onPick={(d) => api()?.gotoDate(d)}
        />
        <div className="cal-layers">
          <div className="cal-layers-title">My calendars</div>
          {LAYERS.map((l) => (
            <label key={l.id} className={`cal-layer${l.id === "meeting" && meetingsBlocked ? " cal-layer-off" : ""}`}>
              <input
                type="checkbox"
                checked={!!layers[l.id] && !(l.id === "meeting" && meetingsBlocked)}
                disabled={l.id === "meeting" && meetingsBlocked}
                onChange={() => toggleLayer(l.id)}
              />
              <span className="cal-layer-swatch" style={{ background: l.color }} aria-hidden="true" />
              <span className="cal-layer-name">{l.label}</span>
              <span className="cal-layer-count">{counts[l.id]}</span>
            </label>
          ))}
          {meetingsBlocked && <p className="cal-layers-note">Meetings aren&apos;t part of your access.</p>}
        </div>
        <p className="cal-tip">
          <strong>Tip:</strong> double-click a time to schedule a meeting, or drag across times to pick a range.
          Drag a meeting to move it; drag its bottom edge to change its length.
        </p>
      </aside>

      <section className="cal-main" aria-label="Calendar">
        <div className="cal-toolbar">
          <button type="button" className="btn btn-primary cal-new cal-new-compact" onClick={() => openNew(nextHalfHour())} disabled={meetingsBlocked} aria-label="New meeting">
            <Plus size={16} /><span>New</span>
          </button>
          <button type="button" className="btn btn-secondary cal-today" onClick={() => api()?.today()} disabled={todayInView}>Today</button>
          <div className="cal-nav">
            <button type="button" className="cal-icon-btn" onClick={() => api()?.prev()} aria-label="Previous"><ChevronLeft size={18} /></button>
            <button type="button" className="cal-icon-btn" onClick={() => api()?.next()} aria-label="Next"><ChevronRight size={18} /></button>
          </div>
          <h2 className="cal-title" aria-live="polite">{title}</h2>
          <div className="cal-views" role="tablist" aria-label="Calendar view">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={view === v.id}
                className={`cal-view-btn${view === v.id ? " active" : ""}`}
                onClick={() => changeView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <select className="cal-views-select" aria-label="Calendar view" value={view} onChange={(e) => changeView(e.target.value)}>
            {VIEWS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>

        {/* Double-click is a mouse shortcut; "New meeting" is the keyboard path. */}
        <div className="cal-grid" onDoubleClick={onDoubleClick}>
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={view}
            headerToolbar={false}
            views={{ timeGridWorkWeek: { type: "timeGridWeek", weekends: false } }}
            firstDay={0}
            height="100%"
            events={events}
            datesSet={onDatesSet}
            dateClick={onDateClick}
            eventClick={onEventClick}
            eventContent={renderEvent}
            eventDidMount={(info) => { info.el.dataset.eventId = info.event.id; }}
            selectable={!meetingsBlocked}
            selectMirror
            selectMinDistance={6}
            unselectAuto
            select={onSelect}
            editable
            eventStartEditable
            eventDurationEditable
            eventAllow={(drop) => !drop.allDay}
            eventDrop={persistMove}
            eventResize={persistMove}
            snapDuration="00:15:00"
            slotDuration="00:30:00"
            slotLabelInterval="01:00"
            scrollTime="08:00:00"
            nowIndicator
            businessHours={{ daysOfWeek: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "18:00" }}
            navLinks
            dayMaxEvents={3}
            allDayText="All day"
            eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
            slotLabelFormat={{ hour: "numeric", meridiem: "short" }}
          />
        </div>
      </section>

      {peek && (
        <EventPeek
          key={peek.key}
          peek={peek}
          projectName={projectName}
          teamName={teamName}
          onClose={() => setPeek(null)}
          onEdit={() => { setEditor({ meeting: peek.item, slot: null }); setPeek(null); }}
          onDelete={() => handleDelete(peek.item)}
          onOpen={() => { const { type, item } = peek; setPeek(null); openItem(type, item.id); }}
        />
      )}

      {editor && (
        <MeetingEditor
          meeting={editor.meeting}
          slot={editor.slot || (editor.meeting ? { start: meetingStart(editor.meeting), end: meetingEnd(editor.meeting) } : nextHalfHour())}
          projects={projects}
          team={team}
          meetings={meetings}
          onSave={handleSave}
          onDelete={() => handleDelete(editor.meeting)}
          onClose={() => setEditor(null)}
          onOpenFull={editor.meeting ? () => { const id = editor.meeting.id; setEditor(null); navigate(`/meetings?open=${id}`); } : null}
        />
      )}
    </div>
  );
}
